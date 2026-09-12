# R36 web response: a visit counts once, closure Labels reach the diary, the last visit is the visit's day (2026-09-12)

Reply to the app's R36 handover (app repo `C:\Resneo-app`). Web repo `C:\Resneo`, `staging` working
tree on top of `c4deb24e` (#195, which contains #194).

All three findings are confirmed, and item 4 is now built on the web too. One correction to item 1,
and two more defects found while fixing item 3, are recorded below.

## 1. A visit counts once

**Answer: once, per day.** The product already defines it that way: "A visit is one booking made of
independent services" (`Docs/visit-services-independent-plan.md`, Decision 1). That is why Confirm,
Arrived, Cancel and No-Show apply to the whole visit. The home page's row count predates the visit
work, so it was the odd one out.

**A correction that does not change the answer.** `stats` on the appointments list does not count
what survives the collapse. `statsBookings` is built from `allStatusBookings` before
`collapseMultiServiceVisits` runs, so it counted rows as well. It made no visible difference: that
toolbar is `compact` + `hideTitle` and never renders those chips. The number staff see on that page
is the line count ("2 bookings"), which is collapsed. So on the web the disagreement was between the
home tile (rows) and the list's lines (visits), exactly as you saw.

**The rule now.** Anything that counts appointments counts a multi-service visit once per day, and a
visit spread over two days counts on each. Anything about time still uses every service, because
each service starts at its own time. A party's people (`person_label`) and a class cart's sessions
still count one by one, by the same rule as the list and the C12 cascade.

| Surface | Before | Now |
| --- | --- | --- |
| `GET /api/venue/dashboard-home`: `today.bookings`, `confirmed`, `pending`, `seated` | rows | visits, using the visit's derived status (`visitLifecycleStatus`) |
| `today_by_booking_model`, `forecast[].bookings`, the "N pending appointments awaiting payment" alert | rows | visits |
| `recent_bookings` | one entry per service | one entry per visit per day: its earliest service that day, carrying the visit's status, with a new `group_booking_id` field |
| Appointments list `stats` (not rendered today) | rows | visits |
| Calendar month cell ("N team appointments") | rows | visits |
| Calendar month linked marker (`linkedBookingCountByDate`) | rows | a visit once per day, even across two visible linked columns |
| `guests.visit_count` | one per started service | one per visit per day (see item 3) |

Unchanged on purpose: `today.covers`, `today.revenue`, `next_booking`, the in-house, arriving-soon and
heatmap figures, `cde_today`, the day and week grids (one bar per service, Decision 2), and the
reports' per-staff, per-service and revenue figures, where one service is the unit.

Also fixed on the way: `recent_bookings` looked up guest names for the first ten rows in query
order, but listed the first ten in time order. On a day with more than ten appointments, some listed
rows read "Guest".

Verified against the dev/staging database. It is the one your pass used: the guest directory reads
2,001 contacts with details and 2,004 in all, as in your item 4. Plus 1 Staging and Light 3 each have
one two-service visit today:

| Venue, 12 Sep | Rows today | `today.bookings` now |
| --- | --- | --- |
| Plus 1 Staging | 2 | 1 (`recent_bookings` has one entry, with `group_booking_id` set) |
| Light 3 | 2 | 1 (`seated` is 1: one of its services is started) |

The signed-in home page for Plus 1 Staging reads "Appointments today" 1, "0/1 confirmed", with one
row under Today's appointments.

**For the app.** From this deploy, `today.bookings`, `today_by_booking_model` and `forecast[].bookings`
are visit counts. `recent_bookings` arrives already collapsed, with `group_booking_id` for any client
that wants to mark a row as a visit. If your month counts are computed on the device, the rule to
match is `collapseMultiServiceVisits` (`src/lib/booking/booking-list-row-schedule.ts`): rows sharing a
`group_booking_id` on the same `booking_date`, none with a `person_label` and none with a
`class_instance_id`, count once. For linked rows, key on venue, group and date.

## 2. A closure's Label reaches the diary

Confirmed. `GET /api/venue/practitioner-leave` already returned `leave_type`. The diary built its
leave stripes without it and labelled every one "On leave". (One pointer correction: `:148` is the
linked-venue builder. Leave stripes are pushed at the end of `buildPractitionerScheduleClosureBlocks`,
also with a null reason, so the conclusion stands.)

**We made your change, with your words**, so you have nothing to revert: `annual` reads "Closed",
`sick` reads "Unavailable" and `other` reads "On leave". A missing or unrecognised `leave_type` also
reads "On leave". The editor keeps its "Label (optional)" field and its three options.

Three details only show when closures overlap. You may want to match them:

- Full-day closures cover the day as one stripe. If two full-day closures on the same day carry
  different Labels, the stronger one wins, in this order: Closed, Unavailable, On leave.
- Part-day windows with different Labels never fuse into one stripe, even when they touch. For
  example, 10:00 to 12:00 Unavailable next to 12:00 to 13:00 Closed stays two stripes. Where two
  windows overlap, the same order decides.
- Touching windows with the same Label join into one stripe.

Code: `labelledLeaveForPractitionerOnDate` and `leaveStripeLabel` in
`src/lib/calendar/schedule-closure-blocks.ts`, and each stripe now carries `leave_type`. The help
centre matches: the band table in "Using the Appointment Calendar", and the Label step in "Working
hours, breaks, and closures" and "Business & calendar hours".

Verified on the signed-in diary: David's closure on Thursday 10 September, labelled Closed, now reads
"Closed 09:00 to 22:00".

## 3. `last_visit_date` is the visit's day

Confirmed, both halves. Fixing it turned up two more defects in the same function:

- **Undoing a service's start never took the visit back off the count.** The per-service "Undo start"
  moves Seated to **Confirmed** (`segmentLifecycleActions`), and only Seated to Booked was treated as
  a revert. Every Start followed by Undo start on a service raised `visit_count` permanently. Your
  "an unseat decrements" holds only for Seated to Booked.
- **`visit_count` counted services, not visits.** Each service of a visit is started on its own, so a
  two-service appointment scored two visits.

The rules now (`applyBookingLifecycleStatusEffects` in `src/lib/table-management/lifecycle.ts`):

| Change | `visit_count` | `last_visit_date` |
| --- | --- | --- |
| Start (to Seated, except from Completed) | +1, unless another service of the same visit on the same day is already Seated or Completed | the booking's own `booking_date`, when that day has arrived in the venue's timezone and is later than the stored date |
| Undo start (Seated to Booked, or Seated to Confirmed) | minus 1, unless another service of that visit on that day is still Seated or Completed | if the stored date is this booking's date: the latest other Seated or Completed booking dated up to today. With none, cleared when the count is now 0, otherwise kept (imported history) |
| Complete (Seated to Completed) | unchanged | as for Start, so a visit started early by mistake still records its day when it is completed on it |
| Reopen (Completed to Seated) | unchanged | unchanged |

So the date is the booking's day. It is venue-local, because `booking_date` already is. It never moves
backwards when an older booking is marked late, and a day that has not arrived is never recorded. The
walk-in route's own write follows the same date rule.

Your reported case, from this deploy: marking a 21 Sep booking Arrived on 12 Sep sets the count to 1
and leaves the date where it was (null for a new guest). Undoing it returns both.

Checked against the real visit on Light 3 today (one service Seated, one Booked). Every read went to
the database; the guest write was captured instead of executed:

| Simulated change | The guest write it would make |
| --- | --- |
| Start the second service | count stays 2; date 11 Sep becomes 12 Sep |
| Undo start on the started service | count 2 becomes 1; date stays 11 Sep, which is not this booking's date |

**Nothing is corrected retroactively.** Dates stamped by the old rule, and counts it inflated, stay as
they are. Neither can be safely recomputed from bookings, because imported history has no bookings
behind it.

**Display.** The web booking panel cited itself the same way you softened ("Last visit Today" once a
booking was started). It now names no date while this visit is under way or done and the stored date
is this visit's own day. It says "First visit" only when this visit is the only one counted. Verified
on a completed booking from 11 Sep whose guest's stored date is 11 Sep: the line reads "1 hr 55 min ·
Fri 11 Sept". The Day Sheet's visit pill had the same fault (a first-timer's seated booking read "2nd
visit") and is fixed the same way.

Your softening is still right. With this deploy it can be narrowed: a future day is never stored now,
so a stored date EARLIER than this booking's date cannot be this booking's own, and the panel can
name it. That is the web rule: hide the date only when it equals this visit's day. And take a
multi-service visit out of the totals once, not once per service.

## 4. A client booked in by name alone

Built on the web as you described. When the scope is "Saved contact details" and the list comes back
empty, or a search is active, the page asks the same question again at `filter=all&page=0&limit=1`
and subtracts the two totals. When nothing is found:

> **No matches**
> 1 client matches “Alpha” but has no saved email or phone. The “Saved contact details” filter is hiding them.
> [Show them] [Clear search]

With no search, the title reads "No clients with saved contact details". When a search finds some
contacts and the scope hides others, the same sentence appears above the list with its own "Show
them". "Show them" switches the scope to "All identified guests".

Verified with your guest: a search for "Alpha" shows the sentence above, and "Show them" lists
ZZTest Alpha. The wording matches yours except for the filter's name, which is "Saved contact
details" on the web and "With contact details" in the app. If they are meant to be the same filter,
one of the two labels should change.

One thing to know if you compare the two: while the search popover is open, the first click anywhere
else only closes it (`use-dismissible-layer.ts` swallows that click by design), so "Show them" takes a
second click in that state. The existing "Clear search" button has always behaved the same way.

## Smaller things

- The no-show grace refusal no longer contains an em-dash. It now reads "Cannot mark as no-show yet:
  the grace period of N minutes after the start time has not elapsed". If the app matches on that
  string, update it.
- A contact row with one visit read "1 visits". It now reads "1 visit".
- `isCascadingVisitGroup` moved to `src/lib/booking/visit-status-scope.ts`, so the visit count uses the
  same visit rule without an import cycle. No behaviour change.

## Status

Built on the web `staging` working tree on 2026-09-12. `tsc --noEmit` passes, eslint reports no new
warnings, and the full vitest suite passes (564 files, 5,475 tests). That includes the new
`lifecycle.guest-visits.test.ts` (14 tests) and `dashboard-home-payload.visits.test.ts` (5), plus new
cases in the closure-stripe and linked-count suites. The live checks above were read-only: no
booking, closure or guest was written. No migration. Not yet committed or deployed; it goes out with
the owner's next staging push.
