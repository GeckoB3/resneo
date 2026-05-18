# ReserveNI: Linked-Calendar Grid Integration — Scope

**Status:** Partly implemented.
**Parent spec:** `Docs/reserveni-linked-accounts-spec.md` §8.2
**Depends on:** Linked Accounts Phase 1 (shipped — PRs #28, #30, plus the action-tier /
create-endpoint / RLS-test follow-up)
**Last updated:** 2026-05-18

---

## 1. Why this is a separate piece of work

Linked Accounts Phase 1 is functionally complete: links can be created, accepted, edited,
reduced and unlinked; cross-venue RLS is enforced and tested; linked calendars are visible.
Today that visibility is delivered by the `LinkedCalendarView` component, which renders as a
**separate "Linked calendars" section below** the native staff calendar on `/dashboard/calendar`
and `/dashboard/day-sheet`, with its own date picker and its own per-practitioner layout.

Spec §8.2 asks for something stronger: linked-in practitioners should appear **as columns
inside the native calendar grid**, desaturated and labelled with their source venue, toggleable
in the existing column picker, and following the page's own date. That is not a bug fix — it is
a UI redesign of a 4,180-line component (`PractitionerCalendarView.tsx`). It carries real
regression risk to the core booking surface, so it is scoped and sequenced on its own.

The current separate-section view is a correct, shippable interim state. This work *replaces*
it on the appointments calendar; it does not block anything.

---

## 2. Goal and non-goals

**Goal.** On `/dashboard/calendar` (and, where it applies, `/dashboard/day-sheet`):

- Linked-in practitioners render as extra columns in the same grid as the venue's own
  practitioners, visually desaturated and badged with the source venue name.
- Linked columns are toggleable in the existing `CalendarColumnsChecklist`, persisted
  alongside the venue's own column preferences.
- Linked bookings render as blocks on those columns, follow the page's selected date and
  view mode (day/week/month), and obey the link's permission grant:
  - `time_only` → bare time blocks, no detail, not clickable for edit.
  - `full_details` + `act = none` → detail visible, read-only.
  - `edit_existing` / `create_edit_cancel` → clickable, routed to the cross-venue edit/
    create flow already built in Phase 1.
- The standalone `LinkedCalendarView` section is removed from `/dashboard/calendar` once the
  grid integration is live.

**Non-goals.**

- No change to cross-venue RLS, the `account_links` model, or the Phase 1 API routes
  (`/api/venue/linked-calendar`, `/api/venue/linked-calendar/booking`,
  `/api/venue/linked-calendar/guests`). This work is presentation-layer only.
- No Phase 2 collective work.
- The orphan `/dashboard/linked-calendar` page and `LinkedCalendarView` component are kept
  for now (still used as a fallback / by `day-sheet` if day-sheet integration is deferred) —
  removal is a cleanup task at the end, not a prerequisite.

---

## 3. Current state — integration surface

`src/app/dashboard/practitioner-calendar/PractitionerCalendarView.tsx` (used by
`/dashboard/calendar`):

- **Columns** derive from the `Practitioner` roster (`columnPractitioners`, ~line 2042),
  each keyed by `practitioner_id` (legacy) or `unified_calendars.id` (unified scheduling).
  `resolveBookingColumnId()` (~line 223) normalises a booking onto its column.
- **Column picker:** `CalendarColumnsChecklist` (`CalendarColumnsFilter.tsx`); selection in
  `calendarFilterIds` (`null` = all), persisted under the session key
  `reserve:dashboard:calendar:{venueId}:preferences`.
- **Data fetch:** parallel calls to `/api/venue/practitioners?roster=1`,
  `/api/venue/bookings/list`, `/api/venue/appointment-services`,
  `/api/venue/practitioner-calendar-blocks`, `/api/venue/schedule`, `/api/venue`. Date range
  comes from the memoised `listFromTo` (~line 1831): single day, 7-day week, or month grid.
- **Booking blocks:** styled by `BookingBlockPalette` (~line 319); rendered through
  `DraggableBookingShell` (~line 1390). `canDrag` (~line 3519) is already gated — resource
  bookings render with `canDrag={false}`, which is the existing **read-only column/booking
  precedent** to reuse.
- **Date state:** component `useState` (`date`, `weekStart`, `monthAnchor`, `viewMode`),
  persisted to sessionStorage. `DaySheetView.tsx` holds a single `date` state.
- **Interaction:** `openBookingDetail()` (~line 2880) → `BookingDetailPanel`;
  `CalendarStaffBookingModal` (~line 4095) for creation.

The Phase 1 endpoint `/api/venue/linked-calendar?date=` / `?from=&to=` already returns, per
linked venue: `venueId`, `venueName`, `visibility`, `action`, `practitioners[]`,
`services[]`, and `bookings[]` (PII redacted server-side per grant). It supports both single
day and ranges, so it already covers day/week/month fetching.

---

## 4. Proposed approach

Keep linked data **adjacent to** the native data structures rather than merged into them, so
the core booking paths stay untouched and there is no risk of a linked booking being treated
as an editable own-venue row.

### 4.1 Columns

- Extend `columnPractitioners` with linked columns. Give every column a discriminated
  `source: { kind: 'own' } | { kind: 'linked'; venueId; venueName; linkId; visibility; action }`.
- Linked column IDs must not collide with own IDs — prefix them, e.g. `linked:{venueId}:{practitionerId}`. `resolveBookingColumnId()` and the booking mapping
  must use the same prefixed key for linked bookings.
- `CalendarColumnsChecklist` gains a grouped section ("Linked venues", grouped by venue name)
  below the venue's own calendars. Linked columns default to **off** so existing users see no
  change until they opt in.
- Persist linked column selections in the same `PractitionerCalendarPreferences` blob (extend
  the type + `isPractitionerCalendarPreferences()` validator). Stale linked IDs (link since
  broken) must be ignored gracefully on load.

### 4.2 Data

- Add a parallel fetch to `/api/venue/linked-calendar` keyed off the same `listFromTo` range
  so day/week/month all work. Gate it on `isLinkFeatureVenue` (already imported by the page).
- Map linked bookings into the existing booking-block layout model but tag each with
  `linkedVenueId` / `linkId` / `visibility` / `action`. Do **not** push them into the array
  consumed by drag/drop, conflict detection, or availability maths.

### 4.3 Rendering

- Linked column header: desaturated background + a "Linked · {venue}" badge.
- Linked booking blocks: a distinct desaturated palette (reuse the resource-booking visual
  treatment as the precedent). `time_only` blocks show only "{venue} — busy".
- `canDrag={false}` for **all** linked bookings (reschedule-by-drag is out of scope; edits go
  through the modal).
- Click behaviour by grant:
  - `time_only` or `act = none` → open a read-only detail popover (no edit controls).
  - `edit_existing` / `create_edit_cancel` → open the Phase 1 `EditLinkedBookingModal`
    (already enforces the cancel-tier rule), not `BookingDetailPanel`.
- An empty slot on a linked column with `act = create_edit_cancel` → open the Phase 1
  `CreateLinkedBookingModal` pre-filled with that practitioner/date/time.

### 4.4 Date sync

- Linked fetch is driven by the page's `listFromTo`, so linked data follows the native date
  and view mode automatically — this resolves the "two date pickers" UX problem.
- Remove `<LinkedCalendarView>` from `/dashboard/calendar` once the grid path is verified.

### 4.5 Day-sheet

- `DaySheetView` is a simpler single-day list. Decide during build whether to give it the
  same column treatment or keep its `LinkedCalendarView` section. Recommended: **keep the
  section for day-sheet in this iteration**, integrate only the appointments grid first.

---

## 5. Work breakdown

1. **Types + column model** — `source`-discriminated columns, prefixed linked IDs, extend
   `PractitionerCalendarPreferences`. No visual change yet.
2. **Linked data fetch** — parallel `/api/venue/linked-calendar` call on `listFromTo`;
   adjacent state, not merged.
3. **Column picker** — grouped "Linked venues" section in `CalendarColumnsChecklist`;
   default-off; stale-ID tolerance.
4. **Grid rendering** — linked columns + desaturated booking blocks + `time_only` bare
   blocks; `canDrag={false}` throughout.
5. **Interaction** — wire click → read-only popover vs `EditLinkedBookingModal`; empty-slot →
   `CreateLinkedBookingModal`, by grant.
6. **Remove the standalone section** from `/dashboard/calendar`; decide day-sheet treatment.
7. **QA pass** — see §6.

---

## 6. Risks and test focus

- **Regression to the core calendar.** `PractitionerCalendarView` is the primary booking
  surface. Mitigation: linked data stays in adjacent state; the existing booking array,
  drag/drop, conflict detection and availability maths are not touched. Verify own-venue
  drag/drop, create, edit, week/month rendering after each step.
- **ID collisions** between own and linked columns/bookings — enforced by the `linked:` key
  prefix; assert in tests.
- **Permission drift.** The grid must never expose more than the link grants. The server
  already redacts (`time_only` → no PII; PII gated). The client must additionally never show
  edit/create affordances above the grant. RLS is the backstop, but the UI must not invite a
  403.
- **Broken-link mid-session.** A link revoked while the page is open: stale linked columns/
  preferences must degrade silently (empty fetch, ignored IDs), never error.
- **Performance.** Linked fetch is one extra parallel request per range; acceptable. Watch
  the week/month grid with several linked venues.

Manual QA matrix: own-venue calendar unaffected · linked column toggle on/off persists ·
`time_only` shows bare blocks only · `full_details`+`none` read-only · `edit_existing` opens
edit modal, cancel blocked · `create_edit_cancel` create-on-empty-slot works · day/week/month
all follow one date · revoked link mid-session degrades cleanly.

---

## 7. Open questions

- **Day-sheet:** integrate columns now, or keep its `LinkedCalendarView` section this round?
  (Recommendation: keep the section; appointments grid first.)
- **Week/month density:** with many linked venues the column count can grow large — do we
  cap, or rely on the column picker (default-off) to keep it manageable? (Recommendation:
  rely on the picker; revisit only if it bites.)
- **Drag-to-reschedule for linked bookings:** explicitly out of scope here. Possible future
  enhancement once the read-only integration is proven.
