# R20-1 response — staff read routes fail closed: accepted, with four corrections and five more routes

**From:** the ResNeo **web** repo (`C:\Resneo`, `staging` @ `d0f18da7`).
**Replying to:** `Docs/R20-1_WEB_HANDOVER.md` in the resneo-app repo, and R20-1 in
`Docs/APP_GAP_REPORT_R20_WEB_DELTA.md`.
**Date:** 2026-08-19.

---

## 1 Answer to the question you asked

You asked whether Stage 7's scope note had considered and excluded the staff read
routes. **It had not.** You read it correctly.

The scope note (`Docs/Resneo_Scheduling_Resolver_Plan_August_2026.md`, §4 Stage 7) says
the decision "covers the GUEST booking path, which is what `SA-C3` is about", and then
justifies exactly one staff exclusion: the two named write validators. Staff **read**
routes appear nowhere in Stage 7, in any form. They fell outside the frame rather than
being decided against.

So: **in scope, and we will do it.** Your framing of it as a question rather than a
defect was the right call, and asking it is what surfaced four further things below.

## 2 What we verified before agreeing

Everything mechanical in your handover checks out:

- Both routes are bare single-`GET` exports with one top-level `try`/`catch` and no
  partial-response paths: `src/app/api/venue/appointment-calendar/route.ts:40`,
  `src/app/api/venue/appointment-availability/route.ts:43`.
- The **twelve** fail-open reads in `appointment-month-availability.ts` is exact. The
  staff slot route's engine (`appointment-engine.ts`) carries **eleven** more.
- `withScheduleFailClosed` replaces a response only when `status < 400`, and the 401
  staff guard runs before any schedule read, so the guard cannot become a 503.
- The collector is `AsyncLocalStorage`-based (`schedule-read-context.ts`) and is
  route-agnostic and per-request isolated. It needs no change to serve staff routes.
- `/api/venue/appointment-calendar` already sends `private, no-store`
  (`VENUE_CATALOG_CACHE_CONTROL`), so there is no header conflict with the 503.
- **`/api/venue/appointment-availability` has no internal pooling branch**, as you asked
  us to confirm. Its `any_available` fan-out is entirely client-side. The *calendar*
  route does pool server-side, inside the shared module, so the wrapper sees those
  failures. See correction 4 for why that distinction matters more than it looks.

One useful fact neither document states: **fail closed does not depend on `SENTRY_DSN`.**
`reportAvailabilityReadFailure` invokes the listener *before* the DSN guard, deliberately
("a request that wants to fail closed must learn about this even when no DSN is
configured"). The plan's `[R3-85]` warning about inert reporting applies to Sentry
visibility, not to this behaviour.

## 3 Four corrections

### 3.1 You argued the weaker half of your own case

Your harm model is dates *withheld*: staff see grey cells, conclude the venue is booked,
turn the customer away. That is real, but it is the less serious direction.

The more serious one is the opposite. A failed leave or closure read makes the engine
**offer** a time that is not free. That is the plan's own phrase, "the engine sells the
day", and on a staff route it produces a double-booked practitioner and a customer turned
away at the door.

That reframing matters because it makes this decision (J) verbatim with the audience
changed, rather than an extension of it that needs fresh justification. Lead with it.

### 3.2 The §5 deploy blocker is already written, in your working tree, uncommitted

`C:\Resneo-app` currently has uncommitted changes to four files:

```
 components/booking-wizard/MonthDatePicker.test.tsx | 60 ++++++++++
 components/booking-wizard/MonthDatePicker.tsx      | 39 ++++++-
 components/booking-wizard/ResourceBookingFlow.tsx  | 19 ++++-
 components/booking-wizard/ServiceBookingFlow.tsx   |  5 ++
```

`ServiceBookingFlow` now passes `isError` / `errorMessage` / `onRetry`, and
`MonthDatePicker` renders an `ErrorState` in place of the grid. R20-3 exists; it is not
shipped. The blocker is "commit, test and release", not "build it".

### 3.3 Mobile deploy order is not web deploy order, and it changes the rule

Old app installs will never receive R20-3. A web deploy reaches every client at once; an
app release does not. So "ship the app fix first, then deploy web" is not sufficient on
its own, because some staff will be on older builds indefinitely.

What rescues it is doing **both routes together**:

- Wrap the calendar route alone, and an old client gets your predicted second silent
  wrong answer: every date selectable, nothing said.
- Wrap **both**, and an old client degrades acceptably. The month picker becomes
  permissive rather than falsely restrictive, staff pick a date, and the failure surfaces
  one step later at `TimeSlotStep.tsx:310`, which already renders the server's own message
  with a Retry button on every shipped version.

**So the rule is both or neither.** That is a stronger reason to ship them in one commit
than the handover gives, and it means the web change is not strictly gated on the app
release, only improved by it.

### 3.4 The pooled path is not fail closed, and dismissing it was wrong

`lib/queries/useAppointmentAvailability.ts` aggregates the client-side fan-out as:

```ts
const isError = errors.length > 0 && errors.length === results.length;
```

A single practitioner's failure is therefore treated as success, and that practitioner's
slots are silently dropped from the merged list. Wrapping the route converts a silent
partial answer into a *different* silent partial answer for every "Any available" booking.

Your note says per-request 503s are "the right granularity" because the app "treats a
partial failure as success by design". That design is precisely what defeats fail closed
here. The web guest route pools **server-side**, so the guest path genuinely fails closed;
the app's client-side fan-out is a parity divergence, not an equivalent implementation.

This is app-side and we are not asking you to fix it before we deploy. We are asking you
to **track it**, because otherwise the web change will be believed to have closed a hole
it has not closed for that path. A visible "could not check every team member" partial
state is probably the right shape.

## 4 The other five staff read routes

Picking two routes by which client happens to call them reproduces the shape Stage 5 spent
its effort collapsing: identical by coincidence, free to drift. We looked at the whole
class. It is more differentiated than expected.

| Route | Consumers | Reachable fail-open reads | Decision |
|---|---|---|---|
| `venue/class-offerings` | web staff `ClassBookingFlow` | 2 | **Wrap** |
| `venue/resource-availability` | web staff `ResourceBookingFlow` | 6 (shared engine) | **Wrap** |
| `venue/resource-calendar` | web staff `ResourceBookingFlow` | 6 (shared engine) | **Wrap** |
| `venue/class-availability` | **none, in either repo** | 2 | **Do not wrap.** Confirm dead, delete |
| `venue/calendar-grid` | **the app, only** | **0** | **Do not wrap yet.** Instrument first |

All five are mechanically identical to your two: one `GET`, one `try`/`catch`, no partial
responses. Wrapping any of them costs one line.

### 4.1 `calendar-grid` — relevant to you, and not what it looks like

`getCalendarGrid` (`src/lib/unified-availability.ts:521`) contains **zero**
`reportAvailabilityReadFailure` calls. All eight sites in that file belong to
`getUnifiedAvailableSlots` and `getEventClassSlots`. **Wrapping this route today would be
a no-op**, and worse than a no-op, because it would read as covered.

What is actually there: the function destructures `{ data: ... }` and discards `error`
on five reads (`unified_calendars`, `bookings`, `calendar_blocks`, `event_sessions`,
`guests`). If the **bookings** read fails, your calendar screen renders an empty day and
staff conclude nobody is booked. Nothing logs it and nothing reaches Sentry, because
Stage 1's instrumentation never reached this path.

On severity we rank this above the two routes you raised. Two facts make it tractable:

- It is **app-only**. No web consumer; the web dashboard calendar is fed by
  `/api/venue/bookings/list?view=calendar`.
- **Your side is already correct.** `app/(app)/(tabs)/index.tsx:2182` renders an
  `ErrorState` with the server's own message on `gridQuery.isError`. Once we instrument
  and wrap, it works on every shipped version with no app change.

We will treat this as its own piece of work: add the reporting first, then wrap. Please
do not record it as covered by this change.

### 4.2 `class-availability` — dead

No consumer in `C:\Resneo` or `C:\Resneo-app`, and not in `Docs/MOBILE_API.md`. The only
textual match is a comment referring to "the class-availability engine", not the route.
Wrapping it would make dead code look maintained. We will confirm no external caller and
delete it. **If the app calls it from a path our grep missed, say so now.**

### 4.3 The three we will wrap

Staff twins of guest routes, switched by audience in `src/lib/booking/booking-flow-api.ts`.
Both web staff flows already surface a visible error, so a 503 will not vanish
(`ResourceBookingFlow.tsx:494` even has month-specific copy). Passing the server's own
wording through instead of the generic client string is a follow-up, not a blocker.

Production has zero resources, so the resource pair is latent exactly like Stage 7's own
`class-instances` and `resource-calendar`, provable only by the shared helper's fixtures.
That is an argument for doing it now while it is free.

## 5 A gap on your side of the line: Stage 7's guest list was not exhaustive

**`/api/booking/class-offerings` is a guest route, uses `class-session-engine`, and is not
wrapped.** It needs no new decision at all: it sits squarely inside the scope note as
written. It is the highest-confidence item on this entire list and we will fix it in the
same pass.

For completeness, the other two unwrapped guest routes are fine as they are:
`booking/resource-options` imports no engine, and `booking/table-calendar` uses
`table-month-availability`, which has zero report sites. That is consistent with them not
being wrapped, though `table-month-availability` is under-instrumented for the same reason
`getCalendarGrid` is.

## 6 What web will do

1. `/api/booking/class-offerings` — wrap. Closes a Stage 7 omission.
2. `/api/venue/appointment-calendar` and `/api/venue/appointment-availability` — wrap, in
   one commit, per correction 3.3.
3. `/api/venue/class-offerings`, `/api/venue/resource-availability`,
   `/api/venue/resource-calendar` — wrap in the same commit.
4. `/api/venue/calendar-grid` — separate work: instrument the five discarded errors, then
   wrap. Tracked, not silently deferred.
5. `/api/venue/class-availability` — confirm dead, delete.
6. Amend the plan's Stage 7 scope note to distinguish staff **reads** (now closed) from
   staff **write validators** (still open, deliberately), so this cannot be re-litigated
   from the same ambiguity.

Verification follows your suggested shape, which we agree with, plus one case you did not
list: **assert no false 503 on the calendar route's `any_available` branch**. That branch
pools server-side, so after the wrap one calendar's failed read blanks the whole month
rather than returning the other practitioners' dates. That is correct fail-closed
behaviour and it matches the guest route, but it is a real behaviour change and should be
asserted deliberately rather than discovered.

## 7 What we need from you

1. **Ship R20-3.** It is written and uncommitted. Not a hard gate given correction 3.3,
   but it is the difference between a good failure and a tolerable one.
2. **Track the pooled fan-out** (correction 3.4). Without it, "Any available" bookings stay
   silently partial no matter what we do server-side.
3. **Confirm `/api/venue/class-availability` is not called by any app version** before we
   delete it.
4. **Do not record `calendar-grid` as covered** by this change. It is instrumentation
   first, and until that lands the empty-calendar failure is still silent.
