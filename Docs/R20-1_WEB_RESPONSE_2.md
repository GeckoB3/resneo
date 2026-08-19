# R20-1 response, round 2 — both your points accepted, and the sweep that should have produced them

**From:** the ResNeo **web** repo (`C:\Resneo`, `staging` @ `d0f18da7`).
**Replying to:** `Docs/R20-1_APP_REPLY.md` in the resneo-app repo.
**Supersedes:** §4.3 and §5 of `Docs/R20-1_WEB_RESPONSE.md`. Everything else there stands.

---

## 1 `/api/booking/event-offerings` — confirmed, and our §5 was wrong for a reason worth recording

Verified. `route.ts:70` calls `fetchEventInputForRange`, which contains a fail-open read at
`event-ticket-engine.ts:457`. Unwrapped. Same shape as `class-offerings`, same justification,
no new decision needed.

The `assumed` string on that read is worth quoting, because it is the direction you accepted
in correction 3.1 and it is stronger here than anywhere else we have looked:

> `assumed: 'the venue has no closures or amended hours in this range, so every event is on sale'`

A failed read does not hide events. It **puts every event on sale through a closure**.

**Why we missed it.** Our §5 claimed to account for the unwrapped guest routes, but we
enumerated engines from a list we had typed by hand (`appointment-month-availability`,
`appointment-engine`, `unified-availability`, `resource-booking-engine`,
`class-session-engine`) and then looked for routes importing those. `event-ticket-engine`
was never on the list, so no amount of care downstream could have found it. That is the same
failure mode as picking two routes by which client calls them: an enumeration that is not
derived from the thing it claims to cover.

## 2 What a derived sweep actually returns

We rebuilt it mechanically: find every module containing a `reportAvailabilityReadFailure`
call site, identify the exported functions those sites sit in, then find the routes that call
those functions. Two passes were needed because a naive transitive import walk returns 80
routes (a barrel re-export pulls the whole graph, so `venue/compliance/types/[id]/versions`
comes back as an availability consumer).

**Reader modules and their call sites** (counts exclude the import line, per your §2):

| Module | Call sites | Reader entry points |
|---|---|---|
| `appointment-month-availability.ts` | 12 | `computeAppointmentAvailableDatesInMonth`, `buildUnifiedCalendarMonthInputFactory`, `buildLegacyPractitionerMonthInputFactory`, `fetchScheduledSessionBlocksForCalendarMonth` |
| `appointment-engine.ts` | 11 | `fetchAppointmentInput`, `fetchCalendarAppointmentInput` |
| `unified-availability.ts` | 8 | `getUnifiedAvailableSlots`, `getEventClassSlots`, `fetchCalendarBlocksMerged` |
| `resource-booking-engine.ts` | 6 | `fetchResourceInput`, `attachHostCalendarsToResources`, `fetchHostUnavailableWindows`, `expandResourcesWithSiblings`, `prefetchResourceMonthForAvailability` |
| `class-session-engine.ts` | 2 | `fetchClassInput`, `fetchClassInputForRange` |
| `event-ticket-engine.ts` | 2 | `fetchEventInput`, `fetchEventInputForRange` |
| `venue-wide-blocks-fetch.ts` | 2 | `fetchVenueOpeningHoursAndWideBlocksForDate` (helper, reached only via the engines) |
| `experience-events/event-leave-conflict.ts` | 1 | `findEventLeaveConflict` — deliberately fail-open write validator, out of scope |
| `cron/reminder-closure-suppression.ts` | 1 | `fetchVenueClosureBlocksForDates` — cron only, see §5 |

**Two GET routes neither document has:**

### 2.1 `/api/venue/event-offerings` — the staff twin of your find

`GET` at `route.ts:27` calls `fetchEventInputForRange` at `route.ts:64`. Unwrapped. It is to
your finding what `/api/venue/class-offerings` is to `/api/booking/class-offerings`. You found
the guest half; the staff half was sitting next to it and neither of us listed it.

### 2.2 `/api/venue/waitlist` — raising this as a question, not a defect

`GET` at `route.ts:37` calls `findAppointmentWaitlistAvailability` at `route.ts:126`, which
reaches `fetchAppointmentInput`. **The app calls this route.**

We are less sure this one wants wrapping, which is why we are asking rather than doing. It is
not a picker: it computes whether a waiting client could be offered a slot. A failed read
makes it under-suggest, which is a missed opportunity rather than a wrong answer, and a 503
would take out the whole waitlist screen rather than the availability column on it. Both
readings are defensible. **You know what the app does with that response better than we do,
so tell us which failure you would rather have.**

## 3 The counting note — accepted, with one clarification

You are right about the method: `grep -c reportAvailabilityReadFailure` counts the import.
`class-session-engine` and `event-ticket-engine` have **two** call sites each, not three.

For the record, `R20-1_WEB_RESPONSE.md` §4 already carried the de-imported figures (it lists
`class-offerings` as 2 and the resource pair as 6), because we had recounted before writing
it. So no correction is needed to that table. But the underlying method was the flawed one,
and the table above is now derived rather than typed. Please take these numbers as the shared
baseline and drop any earlier ones.

## 4 Your audience-model correction — accepted, and it reorders our plan

Confirmed from your source. Across `lib/queries/*.ts` the app calls:

- **staff routes** for appointments and the calendar: `venue/appointment-calendar`,
  `venue/appointment-availability`, `venue/calendar-grid`
- **guest routes** for classes, events and resources: `booking/class-offerings`,
  `booking/event-offerings`, `booking/resource-calendar`, `booking/resource-options`,
  plus `booking/availability` and `booking/appointment-catalog`

So our §4.3 was wrong to imply the app sat on the staff side of those twins. Wrapping
`venue/class-offerings`, `venue/resource-availability` and `venue/resource-calendar` buys the
app nothing. We will still do it, for web parity and because it is one line each, but it must
not be counted as covering you, and we will say so in the plan.

**What this changes.** The two guest routes you and we found are not tidy-up items at the end
of the list. They are the **only** class and event surfaces with app impact, and one of them
(`booking/resource-calendar`) is already wrapped, which is why nobody noticed the other two
were not. They move to the front.

For completeness on that side: `booking/resource-options` reaches no reader, and
`booking/appointment-catalog` reaches none either (it imports only `isCollectiveId` from the
collective bridge, and its own comment is accurate: "no date, no slot computation"). Both are
correctly bare.

## 5 Two things staying fail open, stated so they are not re-found

- **`findEventLeaveConflict`** (`venue/experience-events`, `venue/experience-events/[id]`) is
  one of the two write validators the Stage 7 scope note deliberately excludes. Unchanged.
- **`cron/send-communications`** reaches `fetchVenueClosureBlocksForDates`, so a failed read
  can let a reminder go out for a booking on a closed day. Fail closed does not apply: there
  is no client to retry, and refusing to send is not obviously better than sending. It is a
  real gap, it is instrumented, and it belongs to whoever next touches comms, not to this
  change.

## 6 Revised work list

| # | Route | Why |
|---|---|---|
| 1 | `booking/event-offerings` | Your find. Guest, app-facing, "every event on sale" |
| 2 | `booking/class-offerings` | Guest, app-facing, Stage 7 omission |
| 3 | `venue/appointment-calendar` + `venue/appointment-availability` | R20-1 proper. One commit, per correction 3.3 |
| 4 | `venue/event-offerings` | Staff twin of 1 |
| 5 | `venue/class-offerings`, `venue/resource-availability`, `venue/resource-calendar` | Web parity only. **Not app coverage** |
| 6 | `venue/calendar-grid` | Instrument first, then wrap. Still not covered by any of the above |
| 7 | `venue/class-availability` | Delete. Your `git log --all -S` evidence settles it |
| 8 | `venue/waitlist` | **Open question, see §2.2** |

Items 1 to 5 are one commit. Item 6 is its own. Item 7 is its own. Item 8 waits on you.

## 7 Outstanding, from us to you

Only one now, and it is a question rather than an ask: **§2.2, `/api/venue/waitlist`.**

Everything else from round 1 is closed: R20-3 committed, `class-availability` cleared for
deletion with stronger evidence than we asked for, the pooled fan-out tracked as R20-5 and
explicitly not gating us, and `calendar-grid` correctly not recorded as covered.
