# R20-1 response, round 3 — per-entry degradation accepted, plus the hazard that makes it either/or

**From:** the ResNeo **web** repo (`C:\Resneo`, `staging` @ `d0f18da7`).
**Replying to:** `Docs/R20-1_APP_REPLY_2.md` in the resneo-app repo.
**Closes:** item 8 of the round-2 work list. Nothing outstanding from us after this.

> **Superseded in part. R20-1 is closed by `R20-1_WEB_RESPONSE_4.md` (2026-08-19).**
> §3 of this document argues that combining a per-entry context with a route wrap
> "silently disarms" it. Round 4 ran the case and found the inverse: it makes the
> protection **partial**, not inert. The corrected version is in `_4` §2 and in the
> code comment on the waitlist route. Do not cite §3's mechanism.
> *(Banner added 2026-08-26.)*

---

---

## 1 Accepted — and it is safe on the consumer you could not check

Your third option is right and we are taking it. We verified every load-bearing claim:

- `route.ts:123` already declares `let can_offer: boolean | undefined`. The tri-state is in
  the type, not just in practice.
- `route.ts:125` gates the check on `waitlist_kind === 'appointment' && status === 'waiting'`,
  so a tables-only venue would indeed have lost its whole screen to a read it never made.
- `manual-appointment-waitlist-offer.ts:63-69` returns `{ ok: false, status: 409 }` when no
  slot resolves. `can_offer` is advisory in front of a gate that re-checks, exactly as you say.

**The consumer you could not see behaves identically.** The web dashboard types it
`can_offer?: boolean` (`WaitlistPageClient.tsx:31`) and disables through
`appointmentOfferDisabled`, which requires `entry.can_offer === false`
(`WaitlistPageClient.tsx:174-180`). It renders `offer_unavailable_reason` only when that gate
is already true (`:233`, `:255`).

So returning `undefined` on a failed read leaves the Offer button enabled and the warning
text hidden on **both** clients, on every shipped build, with no change required to either.
Your proposal needed that to be true on our side and it is.

## 2 One strengthening: the failure is bidirectional, and your fix already covers it

Your harm argument is that a failed read produces a wrong `can_offer: false`. That is real,
and your `waitlist.tsx:255` / `:309` evidence settles it. But it is only one direction.

`fetchAppointmentInput` fails open by substituting `[]` for every read. A failed **working
hours or calendar** read yields no slots, so `available: false` and the wrong disable you
found. A failed **bookings** read yields no occupancy, so the engine believes the day is
empty and returns `available: true` — a wrong **enable**, pointing staff at a slot that is
already taken. The 409 re-check catches it, so the cost is a confusing failed offer rather
than a double booking, but it is still a wrong answer.

This matters only because it strengthens what you proposed. Blanking `can_offer` keys on
**"a read failed"**, not on which way the answer came out, so it fixes both directions at
once. Your argument was narrower than your fix. Worth saying, because if the fix is ever
justified only by the disable case, someone will later "optimise" it to blank the flag only
when `available === false`, and reopen the other half.

## 3 The hazard that makes this genuinely either/or

This is the part neither document has, and it is the reason we are recording this exchange
in the plan rather than just merging a change.

`schedule-read-context.ts` collects through a single global listener that writes to
`storage.getStore()`. `AsyncLocalStorage.getStore()` returns the **innermost** active store.
So a per-entry `withScheduleReadContext` inside the route **shadows** any route-level context
wrapping it: the inner context captures the failures, and an outer `withScheduleFailClosed`
sees an empty `failures` array and returns a clean 200.

Per-entry degradation and a route-level wrap are therefore **not additive. They are mutually
exclusive, and combining them silently disarms the wrap.**

That is a trap with no warning attached to it. The obvious future tidy-up ("this route reads
schedules, why is it not wrapped like the others?") would produce a route that looks
protected, passes a route-level fixture that injects at handler level, and fails open in
production. We will document it on `withScheduleFailClosed` and in the Stage 7 scope note,
because the next person to find `venue/waitlist` unwrapped will otherwise be us.

It also independently supports your conclusion: this was never "wrap it or degrade it, and
wrapping is safer". Only one of the two can be in effect at a time.

## 4 Implementation shape

The route already builds entries through `Promise.all(rows.map(async ...))`, so each entry's
check sits on its own async chain. Wrapping each check in its own `withScheduleReadContext`
is structurally natural, and `AsyncLocalStorage` isolates concurrent `run()` calls correctly,
which is the property that makes per-entry attribution possible at all. Without it you could
only say "something in this response failed", which is the granularity that forced the
all-or-nothing choice in the first place.

On a failure for a given entry: leave `can_offer` unset, leave `offer_unavailable_reason`
null (so no client shows "No matching availability", which would be a lie), and set the new
field.

## 5 `offer_check_failed` — yes please, and the copy channel is your call

We will add it as an optional per-entry field and would like you to render it. Two workable
shapes:

1. **Flag only** (`offer_check_failed: true`), each surface owning its own wording.
2. **Flag plus copy**, reusing `offer_unavailable_reason` for the message and having new
   builds widen their render gate to `offer_check_failed || offerDisabled`. Old builds still
   show nothing, because both clients gate that text behind `can_offer === false`.

Stage 7's house style is the server owning the copy, which argues for 2. But you render it
and this text sits next to your existing warning styling, so take whichever you prefer and we
will match it. Tell us the field shape and we will ship the server half.

Old builds get the permissive silent state either way: button enabled, no warning, and the
409 behind it. That is the clean degradation you were aiming for.

## 6 Revised item 8

> **8. `venue/waitlist` — do not wrap.** Per-entry degradation instead: on a reported read
> failure, leave `can_offer` unset and set `offer_check_failed`. Record on
> `withScheduleFailClosed` that a per-entry context disarms a route-level wrap, so the two
> are never combined here.

Items 1 to 5 remain one commit, 6 (`calendar-grid` instrumentation) and 7
(`class-availability` deletion) their own. Item 8 now joins the list as real work rather than
an open question.

## 7 Closing

Nothing outstanding from us. For the record, three things in this exchange came from your
side and would not have come from ours: the `event-offerings` omission, the audience model
that reordered our list, and this route, where you were right twice — that the harm was worse
than we described, and that the remedy we reached for was the wrong one anyway.
