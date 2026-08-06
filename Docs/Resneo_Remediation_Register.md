# ResNeo Remediation Register

**Status:** Open. 51 findings: 5 closed, 46 open, of which 3 are live today (see §3A). `G11c` in the closed table below came from the portal plan, not this register, so it is not in that count.
**Created:** 2026-08-06
**Last reconciled against the code:** 2026-08-06
**Supersedes as primary artifact:** `Resneo_Customer_Portal_World_Class_Plan.md` (see §9)

> Read §3A before acting on anything below. Sections 4 to 6 rank findings by severity *if triggered*, and most of them cannot currently be triggered. §3B records the ones this document originally over-stated.

---

## 1. What this is

A register of verified defects in the ResNeo customer-facing surfaces, produced while specifying a customer portal rebuild. The specification work stopped because the surface the portal would be built on turned out to have live defects in money handling, data protection and access control.

This document is the work queue. The portal plan is deferred behind it.

Findings are grouped by class and tiered by urgency, not by which part of the codebase they live in, because the fixes cut across the portal, the tokenised `/manage` page, the staff dashboard and the database.

---

## 2. How this was produced, and how far to trust it

Nine adversarial review passes were run against the code and the plan, each with a distinct mandate and each given the previous passes' findings as an exclusion list so effort went to new ground rather than re-derivation.

Every finding below carries a verification status:

| Status | Meaning |
| --- | --- |
| **VERIFIED** | Traced directly against the code or executed, by the author of this register, not only reported |
| **CLOSED** | Fixed and pushed. The description is kept as a record of what was wrong; the *Closed by* line states what actually shipped, which in several cases differs from the fix originally proposed |
| **REPORTED** | Found by a review pass with a specific file and line, but not independently re-traced. Treat the mechanism as credible and the exact blast radius as unconfirmed |

Where a claim was checked and did **not** survive, it is recorded in §8 rather than silently dropped. One reported open-redirect variant needed re-testing before it held, and several plan claims turned out to be wrong; both are recorded.

**Nothing in this register should be fixed without first writing a test that fails.** Several findings are in code paths that move money, and §7 lists the characterisation tests that must exist before the largest refactor is attempted.

---

## 3. Severity scale

| Severity | Definition |
| --- | --- |
| **Critical** | Money leaves incorrectly, personal data is exposed to a third party, or the system tells a customer something untrue about their rights |
| **High** | A customer or venue suffers a materially wrong outcome, or a legal obligation is unmet |
| **Medium** | Wrong or confusing behaviour with a workaround |
| **Low** | Quality, consistency and polish |

---

## 3A. Status, and what actually gates each finding

Since this register was written, three facts changed what is urgent. None of the findings went away; most of them stopped being reachable.

**No venue takes deposits or payments, and none uses class credits.** Every money finding needs one of those to fire. `M-01` needs a shared PaymentIntent, `M-03` needs a purchase, `M-04` and `M-05` need credits. Current exposure is zero. They are not live losses, they are landmines that arm the day payments are switched on.

**Almost nobody uses the customer portal.** Most of `C-*` and all of `Q-*` describe a surface with no traffic.

**Confirm email is off in the production Supabase project.** This was unknown when the register was written. It makes `S-03` live rather than latent, and it makes the fix recorded against `S-03` actively wrong. See the corrected entry.

**Linked accounts go live imminently.** This is why `P-03` through `P-05` were done first.

### Closed

| Finding | Closed by |
| --- | --- |
| `P-01` Deletion request was not cancellable | `a07a0813`, verified against staging |
| `P-02` GDPR erasure stalled silently | `a07a0813` |
| `P-03` Linked venue could enumerate a client book | `b2c70c3f` |
| `P-04` PII redaction defeated in the same response | `48185536` |
| `P-05` Audit log retained client PII after unlink | `47ad782a`, verified against staging |
| `G11c` Magic-link endpoint unthrottled | `42eff027` |

Also delivered, and **not** originally in this register: reminder and confirmation delivery reconciliation (`83b4997d`). `communication_logs` can only account for sends that were attempted; this detects bookings that generated nothing at all, which was the failure mode with no observer.

### Open, grouped by the decision that makes them real

| Gate | Findings |
| --- | --- |
| **Live now** | `S-02` open redirect. `Q-17` stale staff calendar cache. `C-07` guest merge silently discarding `user_id`, which accumulates irreversible damage while latent. |
| **Before enabling deposits or payments** | `M-01` to `M-05`, plus the characterisation tests in §7. `M-02` is the one that will bite first: it needs no race and customers find it by accident. |
| **Before promoting the customer portal** | `C-01` to `C-06`, `C-08` to `C-12`, and all of `Q-*`. |
| **Before enabling memberships** | `Q-13`. Now more pressing: `a07a0813` made `deleteUser` genuinely run, so a deleted account with a live subscription keeps being billed. |
| **Needs a decision, not a fix** | `S-03`. See the corrected entry below. |
| **Scale-triggered, not urgent** | `S-01`, `Q-24`. See §3B. |

---

## 3B. Findings this register over-stated

Recorded honestly, because a register that cries wolf gets ignored.

**`S-01`, guessable manage links.** Ranked critical on the assumption of roughly 100,000 live short codes. At current volume there are a few hundred, so expected work per hit is around `62^6 / 300` ≈ 190 million requests: three weeks of sustained attack for one random cancellation. Not a realistic problem now. It becomes one at perhaps 50 to 100 times current volume, which is the trigger to watch.

**`C-01`, short-link collision breaking the bookings list.** Requires two concurrent creates for the same booking and purpose. The reminder cron loops sequentially, the two calls in its `Promise.all` use different purposes so they cannot collide with each other, and the select-then-renew path handles expired rows. Real, but rare at this volume, and caught per booking.

**`Q-24`, appointment reschedule capacity race.** Needs two people choosing the identical slot inside the cache window. Uncommon at current volume. Note the related mechanism was also mis-described: `Q-17`'s cache is `private`, so two staff members never share it. The real scenario is one person returning to a view they loaded up to 165 seconds earlier.

---

## 4. Tier 0: live exposure

Fix before any feature work. Each is small in isolation. Several are one-line changes.

**Tiering below reflects severity if triggered. See §3A for what currently triggers each one.**

### Money

**M-01. Cancelling one line of a shared-PaymentIntent booking refunds the whole thing.** Critical. **VERIFIED**

`src/app/api/confirm/route.ts:589` calls `stripe.refunds.create({ payment_intent })` with no `amount`, so Stripe refunds the entire PI. One PI spans every row of a class cart (`src/lib/class-commerce/orchestrate-class-cart-checkout.ts`, `.in('id', piLinkedBookingIds)`) and of a multi-service visit (`src/app/api/booking/create-multi-service/route.ts`, `.in('id', bookingIds)`).

A customer books three classes on one PI, cancels one before its deadline, and receives 100 percent of the money while keeping two live bookings. The `charge.refunded` webhook then marks the survivors `Refunded` while they stay `Booked`. No attack skill is involved; an ordinary customer can do this by accident.

The staff path already guards this: `src/lib/booking/staff-cancel-booking.ts` collects every row sharing the `group_booking_id`, cancels them together, and sums the deposits. The guest path does none of it, which is why this reads as an oversight rather than a policy.

*Fix:* pass `amount: booking.deposit_amount_pence` and a deterministic idempotency key, or refuse single-row online cancellation on a shared PI and cancel the unit. Decide which explicitly; they are different products.

**M-02. Rescheduling resets the cancellation deadline, so deposit and no-show protection is bypassable.** Critical. **VERIFIED**

All three modify branches recompute `cancellation_deadline` from the new slot (`src/app/api/confirm/route.ts:1025`, `:1214`, `:1464`) and write it (`:1040`, `:1233`, `:1521`). Nothing checks the *current* deadline before permitting a modify.

One hour before an appointment, with a forfeitable deposit, a guest reschedules to next month and immediately cancels. The refund is now eligible. For card holds, `settleCardHoldsOnCancellation` sees `now <= deadline` and releases instead of keeping the fee. This defeats the entire deposit and card-hold product that ResNeo sells to venues as protection, and it is available to anyone holding a manage link, gated only by `guest_self_reschedule` which defaults on.

*Fix:* refuse modify once past the current deadline, or carry the earlier of the old and new deadline forward. This is a product decision as much as a code one and should be written down.

**M-03. Failed fulfilment is swallowed and the payment is marked complete.** Critical. **VERIFIED**

`src/app/api/webhooks/stripe/route.ts:193-207` calls the credit and course fulfillers, discards the returned `{ fulfilled, reason }`, and returns `received: true`. The event is then stamped `completed_at`, so Stripe never redelivers. The client-side fulfil routes and the UI sections behave the same way.

The customer is charged, receives nothing, is shown a success message, and there is no retry, no alert and no reconciliation path.

*Fix:* throw on any `fulfilled: false` reason other than the already-fulfilled cases so the webhook claim is released and Stripe retries; return a non-200 from the client fulfil routes and surface it.

**M-04. Credit restore can double-credit.** High. **REPORTED**

`src/lib/class-commerce/restore-class-credits.ts` increments the balance before inserting the keyed ledger row, so a failed insert leaves the increment standing and a retry increments again. Separately, the idempotency key is prefixed with the acting path (`guest_self_cancel:`, `staff_cancel:`, `stripe_refund:`), so two different actors cancelling the same booking each pass the duplicate check and each restore.

*Fix:* insert the ledger row first and let the unique index be the claim, then apply the balance delta; drop the actor prefix so the key is the ledger row alone. `consume_class_credits_atomically` already demonstrates the correct pattern in SQL.

**M-05. Credit restore failure after a committed cancel loses the credits permanently.** High. **REPORTED**

Restore runs after the booking is cancelled, inside a `catch` that only logs (`src/app/api/confirm/route.ts:690-733`). A failure leaves the cancellation committed and the credits spent. A second cancel fails the status transition, and no job re-derives missed restores.

*Fix:* restore before the cancel commits and fail the cancel on restore failure, matching how the refund is handled, or write a durable "restore owed" marker for a sweeper.

### Data protection

**P-01. "Cancel deletion request" does nothing, and the email says otherwise.** Critical. **CLOSED** (`a07a0813`)

`request_account_deletion` (`supabase/migrations/20260810120000_guest_first_last_names.sql:250-286`) anonymises at request time: it overwrites `first_name`, `last_name` and `email`, nulls `phone`, and sets `user_id = NULL` on every guest row. `cancel_account_deletion` (`supabase/migrations/20260629120000_user_accounts_foundation.sql:466-482`) clears `user_profiles.deleted_at` and restores nothing.

The confirmation email tells the customer they can cancel before the deletion date. By the time they try, their identity is gone at every venue, the account link is severed, the portal is empty, and the salon they are booked with next week can no longer contact them.

This is both a data-integrity defect and a statement to data subjects that is not true.

*Closed by:* the RPC now marks intent only and no longer touches identity. It deliberately **keeps** the marketing opt-out, which the original fix note missed: asking to be deleted is an unambiguous objection to marketing, and keeping it there means the existing consent checks keep suppressing during the grace period without a second gate, while operational messages about a live booking continue. `cancel_account_deletion` is unchanged and deliberately does not restore marketing consent.

*Not fixed, and unfixable:* rows anonymised by the old behaviour are unrecoverable.

**P-02. GDPR erasure stalls silently and permanently.** High. **CLOSED** (`a07a0813`)

`src/app/api/cron/account-hard-delete/route.ts:52` writes `name: 'Deleted User'`. `guests.name` was dropped at `supabase/migrations/20260810120000_guest_first_last_names.sql:117`. This is the only remaining writer of that column anywhere in the codebase.

It was masked because P-01 already nulled `user_id`, leaving the loop with no rows. It would have become live the moment a customer booked again during the 30-day window and their `user_id` was re-linked: the update fails with `PGRST204`, the cron skips `deleteUser`, and the request fails on every subsequent run, visible only in logs.

*Closed by:* the write is now `first_name` / `last_name`. Because fixing P-01 made this path genuinely execute for the first time, the cron also gained a per-user recheck of `deleted_at` immediately before anonymising, since a batch of 100 takes time to work through and anonymisation is irreversible. Cancellations racing the cron are now reported rather than silent. Nine tests added; the path previously had none.

**P-03. A linked venue can enumerate the other venue's entire client list.** Critical. **CLOSED** (`b2c70c3f`)

`src/app/api/venue/linked-calendar/guests/route.ts` filtered on `venue_id` alone, with no requirement that the guest had any relationship to the calling venue, and an empty query returned the first 20 clients alphabetically.

**Two corrections to the original entry.** First, the access gate was stronger than recorded: the route already required a live link with `create_edit_cancel` **and** `pii`, not merely any link. Second, and more importantly, the exposure was not reachable, because both linked-calendar routes selected `guests.name`, a column dropped in `20260810120000`. Neither query could succeed, so the cross-venue booking form had never worked and the UI rendered the failure as an empty result list.

That made the obvious repair the worst available option: fixing the dead column alone would have armed the enumeration.

*Closed by:* both changes together. Queries below two characters now return empty without touching the database, and email matches on prefix rather than substring, since a leading wildcard is the enumeration primitive. The scoping option recorded in the original fix note was **rejected**: restricting to guests with an existing booking would break the legitimate case of booking a client the renting venue has not seen before.

**P-04. The linked-venue PII gate is defeated in the same response that applies it.** High. **CLOSED** (`48185536`)

`src/app/api/venue/bookings/[id]/route.ts:380` redacts the `guest` object for a `pii = false` linked viewer and then spreads the raw booking row into the same JSON, returning `guest_first_name`, `guest_last_name`, `guest_email`, `guest_phone`, `special_requests`, `dietary_notes` and `internal_notes`. `src/app/api/venue/linked-calendar/route.ts:404-405` returns `special_requests` and `internal_notes` gated on `fullDetails` only, nine lines above correctly gating email and phone on `canSeePii`.

Dietary and health notes are special-category data.

*Closed by:* a shared redaction helper covering the booking PII fields and `communications[].recipient`, which was also going out unredacted and is literally the email address or phone number. The sibling route's free-text fields now gate on `canSeePii`. The field list lives in one place because the root cause was drift between a redaction and the payload it guarded.

*Deliberately not decided:* whether a linked venue should see `internal_notes` even **with** the PII grant. It is the host venue's private staff commentary; that is a policy question, not a leak fix.

**P-05. Booking snapshots including PII are retained permanently and survive unlinking.** High. **CLOSED** (`47ad782a`)

`supabase/migrations/20260919120000_linked_accounts.sql:356-375` stores `to_jsonb(NEW)` and `to_jsonb(OLD)` of the booking row into `account_link_audit_log`, which is append-only, explicitly retained after link termination, and readable by staff of both venues. Because bookings carry guest name, email, phone and free text, each audit row is a permanent copy of the customer's identity and notes, still readable by the other venue after the relationship ends. No erasure path touches this table.

*Closed by:* a `BEFORE INSERT OR UPDATE` trigger on the audit table itself, projecting any booking snapshot through an allow-list. Enforcement sits on the table rather than in each of the three writers, so future writers are covered too, and it avoided reproducing a 140-line trigger body containing authorisation logic. Deliberately an allow-list, not the diff originally suggested: for a permanent cross-venue store a PII column added later must be excluded by default. Existing rows were projected in place, which is irreversible by design. Verified against the staging database.

### Security

**S-01. Manage links are guessable and unthrottled, and the portal manufactures them.** Critical if exploitable. **VERIFIED**, but **see §3B: not realistic at current volume.**

`generateBookingShortLinkCode(length = 6)` produces about 35.7 bits in one global namespace, with modulo bias from `BASE62[buf[i] % 62]` making eight characters 25 percent more likely. `src/app/b/[code]/route.ts` has no rate limiting and, on a hit, mints a fresh 30-day HMAC and redirects to `/manage/{id}?hmac=`, which grants cancel, reschedule and refund with no login.

The amplifier is the portal: `hydrateAccountBookingRow` mints a manage link for every row on every list render, so one `/account/bookings` load creates up to 100 guessable cancel codes for bookings the customer never opened, and returns them in the API response.

*Fix:* at least 12 characters with rejection sampling instead of modulo; rate limit `/b/[code]` per IP with backoff on miss; stop minting links during a read (see C-02).

**S-02. Open redirect off `/login`.** High. **VERIFIED** (executed)

`sanitizeAuthNextPath` (`src/lib/safe-auth-redirect.ts:62-67`) rejects `//` but not `/\` or control characters. Verified against the WHATWG URL parser:

```
"/\\evil.com"   -> https://evil.com/    OFF-ORIGIN
"/\t/evil.com"  -> https://evil.com/    OFF-ORIGIN
"/\n/evil.com"  -> https://evil.com/    OFF-ORIGIN
"//evil.com"    -> caught correctly
```

`src/middleware.ts:275` passes the result to `NextResponse.redirect`, so an authenticated victim is sent off-origin from a ResNeo URL. Two weaker variants exist at `src/app/login/page.tsx:19-21` (no sanitiser at all, currently shadowed by middleware) and `src/app/login/login-form.tsx:63-76`.

*Fix:* resolve against a placeholder origin and reject anything that changes origin, then return `pathname + search`. Apply at all three call sites.

**S-03. Guest rows are claimed by unverified email on every login.** High. **VERIFIED**

`claim_user_account()` (`supabase/migrations/20261101120500_claim_links_guests_by_email.sql`) links every unlinked guest row whose email matches the caller's, with no `email_confirmed_at` check. `ensureAuthUserForEmail` creates users with `email_confirm: false`. The committed `supabase/config.toml` has `enable_confirmations = false`.

**Confirmed 2026-08-06: "Confirm email" is OFF in the production Supabase project.** So this is live, not latent. Signing up as someone else's address inherits their full cross-venue history, phone number and spend on first login.

The exposed population is guests with an email and no `user_id`, which in practice means **CSV-imported clients**: online and staff bookings already provision an auth user, and an existing auth user makes the attacking signup fail. Size it before acting, with `SELECT count(*) FROM guests WHERE user_id IS NULL AND email IS NOT NULL`.

Impact is lower than it first reads. There are no saved cards and no payment history to take. What an attacker gets is someone's appointment history, phone number, and the ability to cancel their bookings. It also requires targeting a specific person known to be a client of a ResNeo venue, so it is not opportunistic.

This also matters beyond takeover, and this part is the more likely harm: `guests.user_id` is the sole key behind every access-control decision in the portal, and it is set by unverified string equality on every login. A receptionist mistyping a client's email assigns that booking to whoever owns the typo'd address. That is a data-entry error, not an attack, and those happen constantly. It is currently invisible only because nobody uses the portal.

**CORRECTION. The fix originally recorded here was wrong and must not be applied.** Adding an `email_confirmed_at` condition to `claim_user_account` would, with confirmations off, match zero users and **empty every customer's portal on their next login**. Three workable options instead:

1. **Require magic-link provenance in the claim.** Supabase access tokens carry an `amr` claim recording how the session was established. Linking guest rows demands proof of inbox ownership; a magic link is that proof and a password is not. Existing users are unaffected except that password-only sessions stop linking *new* venues. Preferred.
2. **Backfill existing users as confirmed, then require it.** Grandfathers everyone in, closes it for new signups.
3. **Turn "Confirm email" on.** Cleanest security-wise, but venue owners sign up with `supabase.auth.signUp` (password), so it inserts a confirmation step into the paid conversion funnel. That is a commercial decision, not an engineering one.

**S-04. Staff RLS policies ignore revocation and apply to every command.** High. **VERIFIED**

`staff_manage_bookings` and `staff_manage_guests` (`supabase/migrations/20260301000007_rls_policies.sql:52-66`) are `FOR ALL`, carry no `TO` clause, and have no `revoked_at IS NULL` filter. Never redefined since. Because permissive policies OR together, any current or former staff member reads and writes every booking and guest row at that venue through any authenticated session.

*Fix:* add `revoked_at IS NULL`, add `TO authenticated`, split `FOR ALL` into per-command policies. Prerequisite for any customer policy on `bookings` meaning anything.

---

## 5. Tier 1: portal correctness

Cheap, and no dependency on Tier 0. Note that "high user impact" would be wrong today: almost nobody uses the portal, so these gate promoting it rather than blocking anything now. `C-07` is the exception and is live, because it silently discards data on every guest merge.

**C-01. A short-link collision 500s the entire bookings list.** High. **VERIFIED**, but **see §3B: requires concurrency that current volume makes rare.**

The unique index is on `(booking_id, purpose) WHERE revoked_at IS NULL`, not on `code`. On a `23505` the retry loop in `src/lib/booking-short-links.ts:121-147` generates a fresh random *code* for the same `(booking_id, purpose)`, which collides identically. All twelve attempts fail and it throws, unguarded, inside two nested `Promise.all` calls in `src/lib/account/account-bookings.ts`. A link prefetch racing a click is enough. The customer loses their whole booking history to a link they never used.

*Fix:* on `23505`, re-select and return the winning row. Independently, degrade per-row hydration failures rather than failing the list.

**C-02. The bookings list writes to the database on a GET.** High. **VERIFIED**

`hydrateAccountBookingRow` calls `createOrGetBookingShortLink` per row, which is two selects plus an insert or update. At the default limit of 100 that is several hundred round trips and up to 100 writes while rendering a page. There is no `loading.tsx` on that route, so nothing streams until it all settles.

*Fix:* drop `manage_booking_link` from list hydration and mint on user intent. Batch the CDE context queries. This also removes the S-01 amplifier.

**C-03. A free-text timezone field hard-crashes four routes.** High. **VERIFIED**

`src/app/account/profile/ProfileClient.tsx:265-275` renders timezone as an unvalidated text input; `src/app/api/account/profile/route.ts:13` accepts any 2 to 64 character string. The value reaches `toLocaleDateString({ timeZone })`, which throws `RangeError` on anything that is not an IANA identifier. A customer typing `GMT+1`, `London` or `UK` permanently breaks their own bookings, events, resources and booking-detail pages, landing on the root error page with no portal chrome and no obvious escape.

The same field exists venue-side (`src/app/api/venue/route.ts`), where a bad value breaks those pages for every customer of that venue.

*Fix:* validate against `Intl.supportedValuesOf('timeZone')` in both schemas, replace the input with a select, and wrap the formatter in a fallback.

**C-04. Network failure is indistinguishable from having nothing.** High. **REPORTED**

None of the five section `load()` functions has a `try`/`catch`, and each parses JSON before checking `res.ok`. A rejected fetch or a non-JSON error response leaves the component in its initial empty state with no error and no retry. `AccountPaymentMethodsSection` is worst: on failure it renders "No linked venues yet. Book or buy credits at a venue first", telling a customer to make a purchase to fix a server error.

*Fix:* distinct `loading | ready | failed` states, a retry affordance, and a visual difference from the genuine empty state.

**C-05. Cancelling a paid membership takes one unguarded click.** High. **VERIFIED**

`src/components/account/AccountMembershipsSection.tsx:218` wires `onClick` straight to the cancel API. No dialog, no statement of consequence, no undo, and no route anywhere to reverse `cancel_at_period_end`. Courses and recurring rules at least use `window.confirm`.

*Fix:* a confirmation dialog naming the exact date access ends, plus an undo route. The undo is also the cheapest mitigation for accidental cancellation generally.

**C-06. Booking history truncates silently at 100.** Medium. **VERIFIED**

`loadAccountBookings(supabase, admin, 100)` with no pagination, no "load more" and no message. A class member attending three times a week passes 100 within a year and loses their past with no indication.

**C-07. Guest merge orphans the customer's account.** High. **VERIFIED**

`merge_guests_into` contains zero references to `user_id` and deletes the source rows. A venue merging a linked guest into an unlinked one silently severs the account link; every booking at that venue disappears from the portal with no error and no recovery path. It also omits `communication_logs`, `waitlist` and `booking_card_holds` from its re-point list.

*Fix:* carry a non-null `user_id` to the target before deleting, and raise if two different non-null user ids would be collapsed, because that is two real accounts.

**C-08. Deep-link checkout can charge the wrong venue and plan.** High. **VERIFIED** (mechanism) / **REPORTED** (live impact)

`startCheckout()` in the memberships and courses sections takes no arguments and reads state that the same render pass is still setting, then falls back to the first catalog entry. The credits section does it correctly, passing `startPurchase(deepLinkVenueId, deepLinkProductId)` explicitly.

The asymmetry is confirmed. Whether it mis-charges in production depends on render timing and should be reproduced before assuming it does.

**C-09. The bookings list cannot say what the appointment is.** High. **VERIFIED**

`ACCOUNT_BOOKING_COLUMNS` (`src/lib/account/account-bookings.ts:94`) selects no `service_item_id`, `appointment_service_id`, `service_variant_id` or `practitioner_id`. For appointment businesses, the core vertical, a booking renders as "Bella Hair, Appointment, Mon 4 August, 14:00" with no service and no practitioner. Customers navigate by "my colour with Jo".

*Fix:* add the columns and hydrate the names. One change in the function C-02 already rewrites.

**C-10. Venue preparation instructions never reach the portal.** High. **VERIFIED**

`service_items.pre_appointment_instructions` renders in confirmation and reminder emails via `src/lib/communications/renderer.ts:375` as "Before your appointment:". Nothing under `/account` reads it. This is the field carrying "patch test 48 hours prior", "fast for 12 hours" and "stop retinol 5 days before". A customer who deletes the email has no route to it.

**C-11. Status classification is wrong in three ways.** Medium. **REPORTED**

`src/lib/account/account-booking-filters.ts` treats only a hardcoded cancelled set as non-upcoming, so `Completed` bookings show as upcoming and never appear in Past until UTC midnight. The events and resources loaders apply `.limit()` before filtering cancellations in JavaScript, so a customer holding many cancelled future rows sees "no upcoming tickets" while valid ones exist, and they match only the exact string `Cancelled` while five variants exist elsewhere.

**C-12. Timezone-incorrect filtering.** Medium. **VERIFIED**

Filters compare `booking_date` against a UTC date string and ignore `booking_time` entirely. A booking earlier today still counts as upcoming; a Pacific venue lands in the wrong tab. The UI admits it in small print rather than fixing it.

---

## 6. Tier 2: quality and completeness

Real, but none blocks the others.

| ID | Finding | Severity | Status |
| --- | --- | --- | --- |
| Q-01 | Every emailed cancel link statically imports the 5,068-line `AppointmentBookingFlow` plus Stripe. `BookingFlowRouter` already wraps the same component in `dynamic()` | High | VERIFIED |
| Q-02 | Zero `metadata` exports across 13 account routes and `/manage`; every page is titled with the marketing headline. WCAG 2.4.2 Level A | High | VERIFIED |
| Q-03 | No skip link past roughly 15 tab stops of sticky header and nav, on every route. WCAG 2.4.1 Level A | High | REPORTED |
| Q-04 | Three unlabelled form controls on the `/manage` modify form, the highest-traffic customer page. WCAG 1.3.1, 3.3.2, 4.1.2 | High | REPORTED |
| Q-05 | Six routes server-render a false empty state, so a paying member reads "None yet." until a client fetch lands | High | REPORTED |
| Q-06 | No `aria-current` and no live region anywhere; every async outcome is silent to screen readers. WCAG 4.1.3 | High | VERIFIED |
| Q-07 | `text-slate-400` at 2.54:1, including the recovery instruction on the expired-link screen. Inline links at 1.75:1 against surrounding text with no underline | High | REPORTED |
| Q-08 | Primary list actions are 16 to 20px tall, including "Manage" which leads to cancellation. WCAG 2.5.8 | High | REPORTED |
| Q-09 | No `error.tsx` under `/account`, so a data error unwinds to the root boundary and destroys the portal chrome and navigation | High | REPORTED |
| Q-10 | Zero design-system primitive imports; 22 hand-rolled buttons; `window.confirm` in two places; three different confirmation models | Medium | VERIFIED |
| Q-11 | Saved cards can be added but never removed. No detach route exists | Medium | VERIFIED |
| Q-12 | No customer-facing data export route exists at all. The venue-side export misses compliance records, communication logs, booking free text and everything keyed on `user_id` | Medium | REPORTED |
| Q-13 | Stripe subscriptions and connected-account customers survive account deletion; a live subscription keeps billing after the local pointer is deleted. **Now reachable**: `a07a0813` made `deleteUser` genuinely run for the first time | High | REPORTED |
| Q-14 | No retention policy or purge exists anywhere, while `/privacy` tells data subjects retention follows venue settings that do not exist | Medium | REPORTED |
| Q-15 | Raw Stripe and database enum values rendered to consumers (`past_due`, `trialing`), plus "the nightly cron will start materialising bookings" and "Connect customer" | Medium | VERIFIED |
| Q-16 | The Locale setting is written to the database and never read; the section promises it affects date display | Medium | VERIFIED |
| Q-17 | `venue/appointment-calendar` still returns `max-age=45` on an authenticated response while the rest of the catalog migrated to `no-store`. The cache is `private`, so two staff never share it; the real case is one person returning to a view up to 165s stale. Endpoint is user-driven, not polled, so `no-store` will not materially raise load | Medium | VERIFIED |
| Q-18 | Zero explicit cache headers across 26 authenticated account routes, against a codebase convention with a named `NO_STORE_HEADERS` constant used in nine other route groups | Medium | VERIFIED |
| Q-19 | Loyalty is a shipped staff feature with no customer surface: staff award points via `/api/venue/guests/[guestId]/loyalty`, customers cannot see a balance | Medium | VERIFIED |
| Q-20 | No concept of booking for a dependant. `person_label` exists and is never rendered. Dominant pattern in clinics and class studios | Medium | VERIFIED |
| Q-21 | Cancelling a course means cancelling every session individually | Medium | REPORTED |
| Q-22 | Venue-cancelled and self-cancelled bookings are visually identical; `cancelled_by_staff_id` exists and is unused | Medium | VERIFIED |
| Q-23 | Two static navigation hubs plus a 12-item scroller, of which roughly 8 items are off-screen at 375px with no scroll cue | Medium | VERIFIED |
| Q-24 | Appointment reschedule has no database capacity guard; `enforce_cde_capacity` explicitly excludes appointment rows, and the appointment arm has no `23P01` handling | High | VERIFIED |
| Q-25 | No in-flight guard on eight portal mutation handlers; `/manage` guards all of its equivalents | Medium | REPORTED |

---

## 7. Prerequisites before the largest refactor

Any attempt to extract cancel, confirm and modify out of `src/app/api/confirm/route.ts` (1,770 lines) must be preceded by characterisation tests, because the existing guard is two end-to-end specs that are `test.skip` by default, sit behind an opt-in CI job, and never touch cancel or refunds.

The full case list produced by the money-path review runs to 41 cases across refunds, card-hold settlement, credit restoration, modify, the post-cancel cascade and webhook handling. It should be lifted into the refactor ticket. Two properties matter most:

- Several cases must **pin current buggy behaviour** (M-01 and M-04 especially) so that fixing them becomes a deliberate, reviewable change rather than an invisible side effect of a refactor.
- No money decision may be derived from the cached `bookings.amount_paid_pence` or `payment_state` columns, which are maintained by application code only, have several writers that never recompute, and are known to diverge from the `booking_payments` ledger.

Testing infrastructure that the plan assumed exists and does not: `axe` is absent from `package.json`, `vitest` runs with `environment: 'node'` and no React Server Component rendering path, and the e2e job is gated on a repository variable that is not set. Any acceptance criterion depending on these needs the tooling budgeted first.

---

## 8. Claims that did not survive verification

Recorded so they are not re-raised.

- **`guests_account_safe` leaking venue-private fields.** It does not. The projection correctly excludes `notes`, `tags`, `custom_fields` and `no_show_count`, and every portal loader derives its scope from it. The cross-tenant problem is in the staff-side linked-accounts surface, not the portal.
- **Cookie consent gating.** Correct. The analytics gate renders nothing without consent and is mounted globally, covering `/account`. The gap is email open and click tracking, which a cookie banner cannot govern.
- **Email change acquiring a staff row.** Blocked, in both the trigger and the API path.
- **HMAC manage tokens and confirm tokens.** Sound. Constant-time comparison, embedded expiry, hashed at rest, single-use where intended.
- **The `idx_guests_user_venue` index concern** raised in the portal plan. The index leads with `user_id`. It is the right index; the doubt was invented.
- **An open-redirect variant** initially reported did not reproduce until re-tested without shell escaping. It then held. Recorded because the first negative result was a testing artifact, not evidence of safety.
- **"There is no monitoring of communication delivery."** False, and stated more than once before it was checked. `/super/comms` already tracked email and SMS failure rates, a pending count, recent failures with error messages and a per-venue failure leaderboard; `/super/system` already surfaced `cron_runs`. The genuine gap was narrower: neither can see a send that was never attempted, because no row exists to count. That is what `83b4997d` addresses.
- **The `/api/venue/linked-calendar/guests` access gate.** Reported as "any linked venue", which overstated it. The route already required a live link with `create_edit_cancel` and `pii`. The enumeration was real; the population who could perform it was smaller than reported.
- **Two-controls framing in the deferred portal plan.** Its claim that an RLS policy plus the application filter gives two independent controls is false: both reduce to `guests.user_id = auth.uid()`, which `S-03` shows is set by unverified email equality. One control, implemented twice.

---

## 9. Relationship to the customer portal plan

`Resneo_Customer_Portal_World_Class_Plan.md` remains in the repository as a record of the intended end state and of the customer-journey analysis, which stands. It should **not** be executed as written. Three of its eight architecture decisions are wrong:

- **AD8** (customer RLS policy on `bookings`) fails closed. `public.guests` has RLS with its customer SELECT policy deliberately dropped, so the policy subquery returns zero rows. There is also no `GRANT` on `bookings` anywhere in version control, and the stated acceptance test passes on the broken policy because zero rows is a subset of "only that customer's rows". The correct shape is a zero-argument `SECURITY DEFINER` helper mirroring `current_staff_venue_ids()`, schema-qualified, granted to `authenticated` only, and explicitly not parameterised. Its claim of "two independent controls" is also false: both reduce to `guests.user_id = auth.uid()`, which S-03 shows is set by unverified email match.
- **AD1**'s actor union carries `guestIds`, which is authorisation data rather than proof. The correct actor is `{ kind: 'session'; userId: string }` with the helper resolving ownership itself.
- **AD7**'s scoped session cannot be carried in Supabase `app_metadata`, which is per user rather than per session, and enabling the custom access token hook to do it puts a Postgres function in the token issue path for every role on every refresh. Middleware also does not match `/api/account`.

Two further blockers: the mandated `customer_portal_v2` flag cannot be built, because flags are venue-scoped and the portal is account-scoped and cross-venue; and passkeys appear in the plan's definition of done with no implementation anywhere in the codebase.

When portal work resumes, the recommended shape is a strangler rather than a rebuild: extract the existing `ManageBookingView` into a presentational component over a booking DTO and mount it from both surfaces with different actors, rather than rebuilding to parity and policing drift with snapshot tests.

---

## 10. Change log

| Date | Change |
| --- | --- |
| 2026-08-06 | Created from nine adversarial review passes. Portal plan deferred behind Tier 0. |
| 2026-08-06 | Closed `P-01` to `P-05` and `G11c`. Added `§3A` (status and trigger gating) and `§3B` (findings this register over-stated). **Corrected `S-03`: the fix originally recorded would have emptied every customer portal, because Confirm email is off in production and no user carries `email_confirmed_at`.** Delivered reminder delivery reconciliation, which was not a register item. |
| 2026-08-06 | Accuracy pass. Rewrote every closed entry to record what actually shipped rather than the fix originally proposed; four of the five differed, `P-03` and `P-05` materially. Added `CLOSED` to the status key. Corrected the `Q-17` mechanism (the cache is `private`, so staff never share it) and flagged `Q-13` as now reachable. Extended §8 with three further claims that did not survive checking, including this document's own assertion that delivery monitoring did not exist. Fixed the finding count in the header. |
