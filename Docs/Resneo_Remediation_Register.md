# ResNeo Remediation Register

**Status:** Open
**Created:** 2026-08-06
**Supersedes as primary artifact:** `Resneo_Customer_Portal_World_Class_Plan.md` (see §9)

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

## 4. Tier 0: live exposure

Fix before any feature work. Each is small in isolation. Several are one-line changes.

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

**P-01. "Cancel deletion request" does nothing, and the email says otherwise.** Critical. **VERIFIED**

`request_account_deletion` (`supabase/migrations/20260810120000_guest_first_last_names.sql:250-286`) anonymises at request time: it overwrites `first_name`, `last_name` and `email`, nulls `phone`, and sets `user_id = NULL` on every guest row. `cancel_account_deletion` (`supabase/migrations/20260629120000_user_accounts_foundation.sql:466-482`) clears `user_profiles.deleted_at` and restores nothing.

The confirmation email tells the customer they can cancel before the deletion date. By the time they try, their identity is gone at every venue, the account link is severed, the portal is empty, and the salon they are booked with next week can no longer contact them.

This is both a data-integrity defect and a statement to data subjects that is not true.

*Fix:* move all anonymisation out of the RPC into the hard-delete cron. The RPC should set `deleted_at` only.

**P-02. GDPR erasure stalls silently and permanently.** High. **VERIFIED**

`src/app/api/cron/account-hard-delete/route.ts:52` writes `name: 'Deleted User'`. `guests.name` was dropped at `supabase/migrations/20260810120000_guest_first_last_names.sql:117`. This is the only remaining writer of that column anywhere in the codebase.

Currently masked because P-01 already nulled `user_id`, so the query returns no rows. It becomes live as soon as a customer books again during the 30-day window and their `user_id` is re-linked: the update then fails with `PGRST204`, the cron skips `deleteUser`, and the request fails on every subsequent run, visible only in logs. Erasure never completes and nobody is told.

*Fix:* remove the `name` write. Then fix P-01, which is what actually makes this path reachable.

**P-03. A linked venue can enumerate the other venue's entire client list.** Critical. **REPORTED**

`src/app/api/venue/linked-calendar/guests/route.ts:38-49` filters on `venue_id` alone, with no requirement that the guest has any relationship to the calling venue. Prefix searching walks the whole book. The backing RLS policy grants SELECT on all of the other venue's guest rows.

Two salons link so a stylist can rent a chair; one exports the other's client list with email addresses. None of those clients visited the second venue, were told about the link, or consented.

*Fix:* restrict to guests with a booking on a calendar in scope for the caller, or require an exact email or phone match rather than substring search.

**P-04. The linked-venue PII gate is defeated in the same response that applies it.** High. **REPORTED**

`src/app/api/venue/bookings/[id]/route.ts:380` redacts the `guest` object for a `pii = false` linked viewer and then spreads the raw booking row into the same JSON, returning `guest_first_name`, `guest_last_name`, `guest_email`, `guest_phone`, `special_requests`, `dietary_notes` and `internal_notes`. `src/app/api/venue/linked-calendar/route.ts:404-405` returns `special_requests` and `internal_notes` gated on `fullDetails` only, nine lines above correctly gating email and phone on `canSeePii`.

Dietary and health notes are special-category data.

*Fix:* project explicitly rather than spreading; gate free-text fields on the PII flag alongside contact details.

**P-05. Booking snapshots including PII are retained permanently and survive unlinking.** High. **REPORTED**

`supabase/migrations/20260919120000_linked_accounts.sql:356-375` stores `to_jsonb(NEW)` and `to_jsonb(OLD)` of the booking row into `account_link_audit_log`, which is append-only, explicitly retained after link termination, and readable by staff of both venues. Because bookings carry guest name, email, phone and free text, each audit row is a permanent copy of the customer's identity and notes, still readable by the other venue after the relationship ends. No erasure path touches this table.

*Fix:* store a redacted diff rather than whole rows, and add the table to the erasure manifest.

### Security

**S-01. Manage links are guessable and unthrottled, and the portal manufactures them.** Critical. **VERIFIED**

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

Where confirmations are off, signing up as someone else's address inherits their full cross-venue history, phone number and spend on first login. **The production setting lives in the Supabase dashboard and is not in this repository**, so the production posture is unknown from the code and must be checked directly.

This also matters beyond takeover: `guests.user_id` is the sole key behind every access-control decision in the portal, and it is set by unverified string equality. A receptionist's typo assigns a booking to whoever owns the mistyped address.

*Fix:* add the `email_confirmed_at` condition to the claim, and assert the confirmation setting per environment.

**S-04. Staff RLS policies ignore revocation and apply to every command.** High. **VERIFIED**

`staff_manage_bookings` and `staff_manage_guests` (`supabase/migrations/20260301000007_rls_policies.sql:52-66`) are `FOR ALL`, carry no `TO` clause, and have no `revoked_at IS NULL` filter. Never redefined since. Because permissive policies OR together, any current or former staff member reads and writes every booking and guest row at that venue through any authenticated session.

*Fix:* add `revoked_at IS NULL`, add `TO authenticated`, split `FOR ALL` into per-command policies. Prerequisite for any customer policy on `bookings` meaning anything.

---

## 5. Tier 1: portal correctness

Cheap, high user impact, no dependency on Tier 0.

**C-01. A short-link collision 500s the entire bookings list.** High. **VERIFIED**

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
| Q-13 | Stripe subscriptions and connected-account customers survive account deletion; a live subscription keeps billing after the local pointer is deleted | High | REPORTED |
| Q-14 | No retention policy or purge exists anywhere, while `/privacy` tells data subjects retention follows venue settings that do not exist | Medium | REPORTED |
| Q-15 | Raw Stripe and database enum values rendered to consumers (`past_due`, `trialing`), plus "the nightly cron will start materialising bookings" and "Connect customer" | Medium | VERIFIED |
| Q-16 | The Locale setting is written to the database and never read; the section promises it affects date display | Medium | VERIFIED |
| Q-17 | `venue/appointment-calendar` still returns `max-age=45` on an authenticated response while the rest of the catalog migrated to `no-store`. Same class as the known staleness incident | Medium | VERIFIED |
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
