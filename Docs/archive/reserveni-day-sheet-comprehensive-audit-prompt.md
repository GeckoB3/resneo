# ReserveNI - Day Sheet: Comprehensive Functionality Audit & Implementation

**Prompt Type:** Codebase Audit + Bug Fix + Full Feature Implementation  
**Scope:** Day Sheet screen - complete functionality for the simple covers-based booking system  
**Mode:** Simple Mode only (Table Management toggle OFF)  
**Reference Standard:** ResDiary Day Sheet, OpenTable Front-of-House View, Resy Service View

---

## Context & Objective

The Day Sheet is the primary operational screen for venues using ReserveNI's simple covers-based system. It is what front-of-house staff look at throughout the day - before service to prepare, during service to manage arrivals and status, and after service to review. It must be fast, clear, and actionable under pressure.

This prompt defines every feature the Day Sheet must support, asks the agent to audit what is currently built, fix all bugs, and implement everything that is missing. The Day Sheet must be the best possible tool for a busy restaurant manager who does not need or want table management complexity.

**Critical design constraint:** The Day Sheet must contain zero references to tables, table assignments, floor plans, or table-level thinking. That complexity belongs exclusively to Advanced Table Management mode. The Day Sheet operates entirely in terms of covers, bookings, service periods, and guest management.

---

## Step 1 - Full Codebase Audit

Read all components, hooks, utilities, and API routes related to the Day Sheet screen. For every item in the checklist below, record its current state:

**✅ Built & Working | ⚠️ Built but Broken | 🔶 Partially Built | ❌ Not Built**

Record your findings in a gap report (format defined at end of Step 1) before writing any code.

---

### 1.1 - Page Structure & Layout

- [ ] Day Sheet is only accessible when Table Management toggle is OFF
- [ ] Route is guarded - if Table Management is ON, redirects to Floor Plan or Table Grid
- [ ] Day Sheet is the default operational view in simple mode
- [ ] Page loads with today's date by default
- [ ] Page layout is clean and optimised for fast scanning - not cluttered
- [ ] Page is usable on tablet (768px+) as well as desktop
- [ ] Page renders correctly on screens from 768px to 1920px wide

---

### 1.2 - Date Navigation

- [ ] Previous day arrow button present and functional
- [ ] Next day arrow button present and functional
- [ ] Today button returns to current date
- [ ] Date picker allows selecting any date
- [ ] Selected date is clearly displayed in the page header
- [ ] Day of week is shown alongside the date (e.g. "Thursday 12 March 2026")
- [ ] Navigating to a date with no bookings shows an empty state (not an error)
- [ ] Navigating to a past date shows historical booking data correctly
- [ ] Date navigation does not cause a full page reload - fetches new data in place

---

### 1.3 - Service Period Grouping

- [ ] Bookings are grouped by service period (e.g. Lunch, Dinner, Brunch)
- [ ] Service period groups are ordered chronologically
- [ ] Each service period group has a header showing the period name and time range
- [ ] Each service period header shows a cover count summary (booked / capacity)
- [ ] If no service periods are configured, bookings are displayed as a single ungrouped list
- [ ] Service periods with no bookings for the selected date are displayed with an empty state message (not hidden entirely - staff need to see that a period is empty)

---

### 1.4 - Booking List - Display

- [ ] All bookings for the selected date are displayed
- [ ] Bookings within each service period are sorted chronologically by start time
- [ ] Each booking entry displays: booking time, guest name, party size, status
- [ ] Each booking entry displays deposit status (Paid / Unpaid / Waived / N/A)
- [ ] Each booking entry displays special requests / dietary notes visibly - not hidden behind a click
- [ ] Special requests with allergy flags are visually highlighted (e.g. red border or warning icon) - allergies must never be easy to miss
- [ ] Each booking entry displays booking source (Online / Phone / Walk-in / Staff)
- [ ] Each booking entry displays a returning guest indicator if the guest has previous bookings
- [ ] Each booking entry displays a notes indicator icon if internal staff notes exist
- [ ] Cancelled bookings are visible but visually de-emphasised (greyed out, struck through, or collapsed)
- [ ] No-show bookings are visible but visually de-emphasised
- [ ] Completed bookings are visible but de-emphasised
- [ ] Active bookings (Pending, Confirmed, Seated) are visually prominent
- [ ] Booking status is indicated by a colour-coded badge consistent with the rest of the application
- [ ] Party size is displayed prominently - it is one of the most-scanned fields during service

---

### 1.5 - Booking List - Inline Status Actions

- [ ] Each booking has a clearly visible primary action button appropriate to its current status
- [ ] PENDING → primary action: "Confirm"
- [ ] CONFIRMED → primary action: "Seat" (mark as seated)
- [ ] SEATED → primary action: "Complete" (table clear)
- [ ] COMPLETED → no primary action (terminal)
- [ ] NO_SHOW → no primary action (terminal)
- [ ] CANCELLED → no primary action (terminal)
- [ ] "Mark as No Show" is accessible from CONFIRMED status (secondary action - not primary, requires confirmation)
- [ ] "Cancel Booking" is accessible from PENDING and CONFIRMED status (secondary action, requires confirmation)
- [ ] Status transitions respect the shared state machine - no invalid transitions are possible from the UI
- [ ] Status changes apply immediately to the UI (optimistic update)
- [ ] Status changes write to the database and trigger appropriate communications
- [ ] Failed database writes roll back the optimistic update with an error notification
- [ ] Confirming a PENDING booking sends the confirmation SMS/email (if not already sent)
- [ ] Cancelling sends the cancellation SMS/email (if guest has contact details)

---

### 1.6 - Cover Count Summary

- [ ] A summary section is displayed at the top of the page (above service period groups)
- [ ] Summary shows total covers booked for the full day
- [ ] Summary shows total covers remaining for the full day (venue capacity minus booked covers)
- [ ] Summary shows total number of bookings for the day
- [ ] Summary shows number of pending bookings requiring confirmation
- [ ] Summary updates in real time as statuses change
- [ ] Each service period header shows covers booked / total capacity for that period
- [ ] A visual fill indicator (progress bar or similar) shows what percentage of capacity is booked per service period
- [ ] The fill indicator changes colour as capacity fills: green → amber (75%+) → red (90%+)

---

### 1.7 - Hourly / Time-slot Cover Breakdown

- [ ] A timeline or table showing cover counts at each time slot across the day
- [ ] Time slots in 30-minute increments (sufficient for covers-based system)
- [ ] Each slot shows: number of covers arriving in that slot, cumulative covers in-house
- [ ] The breakdown helps staff decide whether to accept walk-ins at a given time
- [ ] Current time is highlighted when viewing today
- [ ] The breakdown is collapsible - some staff will not need it during service

---

### 1.8 - Booking Detail Expansion

- [ ] Clicking a booking entry expands it to show full detail (accordion or slide-out panel)
- [ ] Expanded view shows: full guest name, phone number, email, party size, time, duration, source, created at
- [ ] Expanded view shows: special requests in full (not truncated)
- [ ] Expanded view shows: internal staff notes (editable inline - click to edit, saves on blur)
- [ ] Expanded view shows: deposit details (amount, status, paid at timestamp if applicable)
- [ ] Expanded view shows: deposit action buttons appropriate to deposit state (same spec as Table Grid Booking Detail Panel - see below)
- [ ] Expanded view shows: previous visit count ("3rd visit" or "First visit")
- [ ] Expanded view shows: communication log (all SMS/email messages sent for this booking, collapsible)
- [ ] Expanded view shows: [Send Custom Message] button
- [ ] Expanded view shows: [Edit Booking] button
- [ ] Phone number is click-to-call on mobile, click-to-copy on desktop
- [ ] Collapsing a booking entry returns to the compact list view without scrolling jump

---

### 1.9 - Deposit Management (within Booking Detail)

Display the correct deposit state and actions. These must match the spec used in the Table Grid Booking Detail Panel for consistency:

**No deposit required:**
- Display: "No deposit required"
- Action: [Request Deposit] - allows requesting a deposit after the fact

**Deposit pending / unpaid:**
- Display: "Deposit of £[amount] requested - not yet paid"
- Actions: [Send Payment Link] · [Mark as Waived] (with confirmation) · [Record Cash Deposit]

**Deposit paid:**
- Display: "Deposit of £[amount] paid ✓" with paid timestamp
- Action: [Issue Refund] - opens refund confirmation, defaults to full amount, allows partial

**Deposit waived:**
- Display: "Deposit waived"
- No further actions

**Deposit refunded:**
- Display: "Deposit of £[amount] refunded"
- No further actions

---

### 1.10 - Edit Booking (from Day Sheet)

- [ ] [Edit Booking] is accessible from the expanded booking detail
- [ ] Edit mode opens inline (not a full page navigation) - either an edit modal or inline form
- [ ] Editable fields: guest name, party size, date, time, duration, special requests, internal notes
- [ ] Party size change re-validates against service period cover capacity - warns if exceeding capacity
- [ ] Time change re-validates availability - warns if the new time conflicts with capacity limits
- [ ] [Save Changes] writes to database and updates the day sheet entry immediately
- [ ] [Cancel] discards changes and returns to read-only view
- [ ] The shared New Booking / Edit Booking component is used - not a separate implementation

---

### 1.11 - New Booking from Day Sheet

- [ ] A prominent [+ New Booking] button is present in the toolbar or page header
- [ ] Clicking it opens the New Booking modal with the current Day Sheet date pre-filled
- [ ] The New Booking modal is the shared application component - not a separate implementation
- [ ] On successful creation, the new booking appears in the correct position in the day sheet list immediately

---

### 1.12 - Walk-in Flow from Day Sheet

- [ ] A [Walk-in] button is present in the toolbar - visually distinct from New Booking
- [ ] Walk-in modal is streamlined for speed - party size field is auto-focused on open
- [ ] Walk-in modal fields: party size (required), guest name (optional), phone number (optional), notes (optional)
- [ ] Walk-in modal shows current remaining capacity for the current time period to help the decision
- [ ] If remaining capacity is zero or near-zero, a warning is shown - but the walk-in can still be created (staff override)
- [ ] On confirm: booking is created with status SEATED immediately
- [ ] Source is recorded as "Walk-in"
- [ ] No confirmation SMS/email is sent for walk-ins (guest is present)
- [ ] New walk-in booking appears in the day sheet immediately
- [ ] Walk-in can be created in under 10 seconds from button click to confirmation

---

### 1.13 - Filters & Search

- [ ] Filter by service period (dropdown or tab - "All", "Lunch", "Dinner" etc.)
- [ ] Filter by booking status (multi-select: Pending / Confirmed / Seated / Completed / No Show / Cancelled)
- [ ] Default filter: show Pending, Confirmed, Seated - hide Completed, No Show, Cancelled
- [ ] Show/hide cancelled bookings toggle (quick access - staff frequently want to check cancelled bookings)
- [ ] Show/hide no-show bookings toggle
- [ ] Search by guest name (live search - filters the list as the user types)
- [ ] Search by party size (e.g. entering "6" shows only bookings of 6 covers)
- [ ] Clear all filters button - resets to default view
- [ ] Active filters are visually indicated so staff know the list is filtered
- [ ] Filter state persists for the session (does not reset on date navigation)

---

### 1.14 - Toolbar: Full Specification

The toolbar sits at the top of the page above the booking list:

**Left section:**
- Previous day arrow (‹)
- Date display (day, date - e.g. "Thu 12 Mar")
- Next day arrow (›)
- Today button

**Centre section:**
- Service period filter tabs or dropdown
- Status filter
- Search field (guest name)

**Right section:**
- [Walk-in] button (primary - prominent)
- [+ New Booking] button (secondary)
- [Print Day Sheet] button
- Real-time connection status indicator (subtle green/amber dot)
- Manual refresh button

---

### 1.15 - Print Day Sheet

- [ ] [Print Day Sheet] button in toolbar
- [ ] Triggers browser print dialog with a print-optimised layout
- [ ] Print layout hides all toolbar, navigation, filter, and interactive elements
- [ ] Print layout shows: venue name, date, day of week at the top
- [ ] Print layout shows: cover count summary for each service period
- [ ] Print layout shows: all bookings grouped by service period, sorted by time
- [ ] Each printed booking row shows: time, guest name, party size, status, special requests
- [ ] Allergies and dietary requirements are printed in bold or highlighted
- [ ] Cancelled and no-show bookings are either excluded from print or printed with clear strikethrough
- [ ] Print layout fits on A4 / US Letter in portrait orientation
- [ ] Font size is legible when printed - minimum 10pt for booking rows
- [ ] Print CSS is scoped to the day sheet route - does not affect print behaviour on other pages

---

### 1.16 - Real-Time Updates

- [ ] New bookings made via the hosted booking page appear on the day sheet without page refresh
- [ ] New bookings made from the Reservations list appear without page refresh
- [ ] Status changes made from the Reservations list reflect on the day sheet without page refresh
- [ ] Deposit payment received (Stripe webhook) updates the deposit status badge without page refresh
- [ ] Cover count summary updates in real time as bookings are added or cancelled
- [ ] Supabase Realtime subscription is scoped to the current venue and current date
- [ ] Subscription is cleaned up on navigation away from the day sheet
- [ ] When Realtime connection drops, falls back to polling every 30 seconds
- [ ] Reconnection indicator shown when connection is dropped ("Live updates paused")
- [ ] Indicator clears when connection is restored
- [ ] On reconnection, performs a full re-fetch to catch any missed changes

---

### 1.17 - Empty States & Edge Cases

- [ ] No bookings for selected date: clear empty state message ("No bookings for Thursday 12 March. Add a booking or check a different date.")
- [ ] No bookings for a service period: show period header with empty state message ("No lunch bookings yet.")
- [ ] Venue capacity not configured: show a banner prompting the owner to set capacity in Settings ("Set your venue capacity to see cover availability.")
- [ ] Service periods not configured: bookings display as a flat chronological list with a banner suggesting the owner configure service periods in Settings
- [ ] All bookings cancelled for the day: show the cancelled bookings de-emphasised with an empty state for active bookings
- [ ] Date very far in the future (more than 90 days): still works correctly - no artificial date limits

---

### 1.18 - Communication Triggers

Every status change made from the Day Sheet must trigger the correct communication. Verify each:

| Action | Communication | Condition |
|---|---|---|
| PENDING → CONFIRMED | Confirmation SMS + email | Only if not already sent |
| Any → CANCELLED | Cancellation SMS + email | Only if guest has contact details |
| CONFIRMED → NO_SHOW | No outbound message | Log no-show on guest record |
| [Send Payment Link] | Payment link SMS | On demand |
| [Send Custom Message] | Free-text SMS/email | On demand |

Duplicate prevention: before firing any communication, check the communication log. If a confirmation has already been sent, do not send another automatically. Show "Confirmation sent on [date]" with an explicit [Resend] option.

---

### 1.19 - Gap Report Format

After completing the audit, produce a structured gap report:

```
GAP-[N]
Category: [Layout | Date Navigation | Service Periods | Booking List | Status Actions | 
           Cover Summary | Timeline Breakdown | Booking Detail | Deposits | Edit Booking |
           New Booking | Walk-in | Filters | Search | Toolbar | Print | Real-time |
           Empty States | Communications | Performance]
Current State: [Built but Broken | Partially Built | Not Built]
Description: [Precise description of what is wrong or missing]
Affected Component/File: [File path or component name if known]
Priority: [P1 - Blocks live service use | P2 - Major gap vs competitors | P3 - Polish & edge cases]
Estimated Complexity: [Low | Medium | High]
```

Sort the gap report: P1 first, then P2, then P3. Within each priority, Low complexity before High.

**Do not begin any implementation until the gap report is complete and presented.**

---

## Step 2 - Implementation: Full Feature Specification

Work through all gaps identified. The sections below define complete target behaviour for every feature. Where a feature is already working correctly, skip it. Where it is broken or missing, implement to this specification.

---

### 2.1 - Page Layout & Visual Hierarchy

The Day Sheet has a clear visual hierarchy. From top to bottom:

```
┌─────────────────────────────────────────────────────┐
│ TOOLBAR                                             │
│ Date nav · Filters · Search · Walk-in · New · Print │
├─────────────────────────────────────────────────────┤
│ DAY SUMMARY BAR                                     │
│ Total covers · Remaining · Bookings · Pending       │
├─────────────────────────────────────────────────────┤
│ TIMELINE BREAKDOWN (collapsible)                    │
│ 30-min slots · covers per slot · current time mark  │
├─────────────────────────────────────────────────────┤
│ SERVICE PERIOD: LUNCH  12:00–15:00                  │
│ 24/40 covers · ████████░░ 60%                       │
│ ─────────────────────────────────────────────────── │
│ 12:00  Smith       ●●●●  Confirmed  £20 paid  ✓    │
│        Dietary: Vegetarian (2), Gluten free (1)     │
│ 12:30  Jones       ●●    Seated     No deposit      │
│ 13:00  Williams    ●●●●●●  Pending  £30 unpaid  ⚠  │
│ ...                                                 │
├─────────────────────────────────────────────────────┤
│ SERVICE PERIOD: DINNER  18:00–22:00                 │
│ 18/60 covers · ████░░░░░░ 30%                       │
│ ...                                                 │
└─────────────────────────────────────────────────────┘
```

**Design principles:**
- The booking list must be scannable at speed - a manager should be able to read the full service at a glance
- Party size should be visually prominent - it drives every operational decision
- Allergy and dietary information must never require an extra click to see - print it beneath the booking row always
- Status badges should use colour consistently with the rest of the application
- Actions should be accessible in one tap/click - no dropdowns that require two interactions for the most common actions

---

### 2.2 - Booking Entry Component

Each booking in the list renders as a compact card or row with two visual states: **collapsed** (default) and **expanded** (on click).

**Collapsed state - always visible:**

```
[STATUS BADGE]  TIME  GUEST NAME  [PARTY INDICATOR]  [DEPOSIT BADGE]  [PRIMARY ACTION]
                      Special requests / dietary (always shown if present)
```

- Status badge: coloured pill - Pending (amber), Confirmed (teal), Seated (blue), Completed (grey), No Show (red), Cancelled (grey/strikethrough)
- Time: 12:00 format
- Guest name: surname prominent, first name secondary
- Party indicator: visual dots or a number - party size must be immediately clear
- Deposit badge: small coloured tag - Paid (green), Unpaid (red/amber), Waived (grey), N/A (none)
- Special requests: shown in a muted secondary line directly beneath the booking row - never hidden
- Allergy flag: if special requests contain allergy-related keywords (allergy, allergic, anaphylactic, intolerant, coeliac, nut, gluten, dairy, shellfish) - show a red warning icon and bold the dietary text
- Primary action button: one tap, labelled clearly ("Confirm", "Seat", "Complete")
- Secondary actions: accessible via a "⋯" overflow menu on the right of the row - No Show, Cancel, Edit, Send Message

**Expanded state - on click:**

The row expands to show the full booking detail as specified in Section 1.8. The expansion is an accordion - it pushes other rows down rather than overlaying them. This keeps context - staff can see the surrounding bookings while viewing the detail of one.

---

### 2.3 - Cover Count Summary Bar

A persistent summary bar below the toolbar showing totals for the selected date:

```
[48 covers booked]  [32 covers remaining]  [12 bookings]  [3 pending confirmation]
```

Each figure should be a tappable/clickable shortcut:
- "3 pending confirmation" → applies the Pending filter to show only pending bookings
- "32 covers remaining" → shows the timeline breakdown
- Numbers update in real time as bookings change

---

### 2.4 - Service Period Headers

Each service period group header shows:

```
LUNCH  ·  12:00 – 15:00  ·  24 / 40 covers  ████████░░░░░  60%
```

- Period name and time range
- Covers booked / period capacity
- Visual fill bar that changes colour: green (under 75%), amber (75–89%), red (90%+)
- The fill bar and cover count update in real time

If the venue has not configured service period capacities separately, fall back to a proportional share of total venue capacity. Show a subtle note: "Set service period capacity in Settings for accurate tracking."

---

### 2.5 - Timeline Breakdown

A collapsible section between the summary bar and the booking list. Collapsed by default - a "Show capacity timeline ▾" toggle reveals it.

**Layout:** A horizontal series of time slots at 30-minute increments from the first service period start to the last service period end.

**Each slot shows:**
- Time label (12:00, 12:30, 13:00 etc.)
- Number of covers arriving in that 30-minute window (new bookings starting in that slot)
- Estimated covers in-house at that time (cumulative - accounts for bookings that started earlier and are still within their duration)
- A small bar showing in-house covers as a proportion of total capacity

**Current time marker:** A vertical indicator at the current 30-minute slot when viewing today. The slot containing the current time should be visually highlighted.

**Purpose:** This gives the front-of-house manager an immediate answer to "can I take this walk-in?" - they can see at a glance whether the next slot is near capacity.

---

### 2.6 - Walk-in Modal: Full Specification

The walk-in modal must be optimised for speed above all else. A walk-in guest is standing at the door. The modal must be completable in under 10 seconds.

**Layout:**

```
WALK-IN

Party size:  [ - ]  [ 4 ]  [ + ]    ← large, prominent, touch-friendly

Remaining capacity now: 16 covers   ← shows current availability at the current time
                                       colour-coded: green / amber / red

Guest name (optional):  [           ]
Phone (optional):       [           ]
Notes (optional):       [           ]

[Cancel]                    [Seat Now →]
```

**Behaviour:**
- Auto-focus the party size field on modal open
- The party size +/- buttons should be large enough for easy touch input
- Remaining capacity shown updates based on the current time - not the full day
- If remaining capacity is 0: show warning "No capacity remaining - are you sure?" but do not block
- If remaining capacity is 1–3 and party size exceeds it: show warning "This may exceed your remaining capacity"
- [Seat Now] creates the booking with status SEATED, source Walk-in, timestamp = now
- No deposit flow for walk-ins
- No confirmation SMS for walk-ins
- Modal closes and the new booking appears in the day sheet immediately

---

### 2.7 - Print Day Sheet: Full Specification

The print output must be clean and professional - something a venue manager would be comfortable handing to a member of staff.

**Print layout:**

```
[VENUE NAME]                         Day Sheet
Thursday 12 March 2026

─────────────────────────────────────────────
LUNCH  ·  12:00–15:00  ·  24 covers booked
─────────────────────────────────────────────
12:00   Smith, James         4 covers   Confirmed
        Dietary: Vegetarian x2, Gluten free x1  ⚠ ALLERGY
        
12:30   Jones, Sarah         2 covers   Confirmed
        No special requests

13:00   Williams, Robert     6 covers   Confirmed
        Internal note: Anniversary - champagne on arrival

─────────────────────────────────────────────
DINNER  ·  18:00–22:00  ·  18 covers booked
─────────────────────────────────────────────
18:00   ...
```

**Print rules:**
- Cancelled and no-show bookings excluded from print by default
- Allergies and dietary requirements bolded and prefixed with ⚠ ALLERGY
- Internal staff notes included (they are for staff)
- Deposit status NOT printed (irrelevant to front-of-house during service)
- Phone numbers NOT printed (GDPR consideration - limit what's on paper)
- Page break between service periods if they would otherwise split across pages
- Footer on each page: "Printed [timestamp] - ReserveNI" and page number
- Implement using a `@media print` CSS block - use `window.print()` not a PDF generation library

---

### 2.8 - Real-Time: Full Specification

Use the shared Supabase Realtime hook used by the rest of the application. The Day Sheet subscribes to:

| Table | Events | Day Sheet Action |
|---|---|---|
| `bookings` | INSERT | Add booking to correct service period group |
| `bookings` | UPDATE | Update booking entry (status, details) |
| `bookings` | DELETE | Remove booking from list |
| `deposits` / `payments` | UPDATE | Update deposit badge on booking entry |

**Insertion handling:** When a new booking is inserted, place it in the correct chronological position within its service period group - do not append to the bottom. Re-sort the group by start time after insertion.

**Update handling:** When a booking is updated, update only that booking entry in the DOM - do not re-render the full list. Preserve the expanded/collapsed state of the updated booking.

**Cover count updates:** Recalculate the cover count summary bar and service period headers whenever a booking is inserted, updated, or deleted. These must stay accurate in real time.

**Reconnection:** Same spec as the Table Grid - fall back to 30-second polling on Realtime disconnect, re-fetch on reconnection, show amber indicator while disconnected.

---

### 2.9 - Status Change Communication Triggers

Confirm these are all firing correctly from the Day Sheet:

**PENDING → CONFIRMED:**
- Check communication log for this booking - has a confirmation already been sent?
- If not: send confirmation SMS + email via existing communication engine
- If yes: do not send automatically. Show in the expanded booking detail: "Confirmation sent [date]" with optional [Resend] button
- Update booking status in database
- Update day sheet entry immediately (optimistic)

**Any status → CANCELLED:**
- Show confirmation dialog: "Cancel this booking? A cancellation message will be sent to the guest."
- On confirm: update status, send cancellation SMS + email if guest has contact details
- Move booking to de-emphasised cancelled state in the list - do not remove it

**CONFIRMED → NO_SHOW:**
- Show confirmation dialog: "Mark as no show? This cannot be undone."
- On confirm: update status, log no-show against guest record for future reference
- No outbound communication
- Move booking to de-emphasised no-show state in the list

**CONFIRMED → SEATED:**
- No confirmation dialog - this is the most frequent action, must be instant
- No outbound communication
- Update booking status immediately

**SEATED → COMPLETED:**
- No confirmation dialog
- No outbound communication
- Update status, move to de-emphasised completed state

---

### 2.10 - Guest History & Returning Visitor Detection

For each booking, check whether the guest's phone number or email matches any previous bookings in the database.

**Returning guest indicator:**
- In the collapsed booking row: a small icon (e.g. star or return arrow) indicating a returning guest
- In the expanded detail: "Xth visit" (e.g. "3rd visit", "5th visit")
- In the expanded detail: any guest notes from previous visits (if a guest profile record exists)
- "First visit" shown for guests with no prior booking history

**Previous visit data to show:**
- Total number of previous completed visits
- Date of last visit
- Any notes attached to the guest profile
- Number of previous no-shows (if any - shown discreetly, helps staff make informed decisions)

If guest matching is not yet implemented (matching by phone number or email), implement a simple matching function:

```javascript
// Match guests by normalised phone number first, then email
function findGuestHistory(phoneNumber, email, allBookings) {
  const normalise = (phone) => phone?.replace(/\D/g, '') // strip non-digits
  
  return allBookings.filter(booking => 
    booking.id !== currentBookingId &&
    booking.status === 'COMPLETED' &&
    (
      (phoneNumber && normalise(booking.phone) === normalise(phoneNumber)) ||
      (email && booking.email?.toLowerCase() === email?.toLowerCase())
    )
  )
}
```

Do not create a separate `guests` table at this stage unless one already exists - derive guest history from the `bookings` table directly.

---

## Step 3 - Bug Fixes

After producing the gap report and before building new features, fix all bugs identified as "Built but Broken" or "Partially Built". Common issues to check:

**Data bugs:**
- Bookings from other dates appearing on the day sheet (date filter not applied)
- Bookings grouped in the wrong service period (time zone mismatch or period boundary logic error)
- Cover counts incorrect (not accounting for cancelled or no-show bookings correctly)
- Deposit status not reflecting Stripe webhook updates

**Status action bugs:**
- Status change buttons firing without the correct database write
- Communication not triggered on status change
- Communication being triggered multiple times (duplicate sends)
- Invalid status transitions being possible from the UI

**Real-time bugs:**
- Subscription not scoped to current date - showing bookings from other dates in real time
- Subscription not cleaned up on navigation away - duplicate events on return
- Cover count summary not updating when real-time event fires

**Layout bugs:**
- Special requests not visible without expanding the booking
- Allergy information not visually distinguished from general dietary notes
- Party size not visually prominent enough
- Collapsed booking rows too tall - list not scannable at a glance
- Expanded state causing scroll jump

**Print bugs:**
- Interactive elements appearing in print preview
- Booking list cut off at page boundary without proper page-break handling
- Allergy warnings not appearing in print output

---

## Step 4 - Final Validation Checklist

Work through every item. Do not mark complete until manually tested.

### Page & Navigation
- [ ] Day Sheet hidden when Table Management is ON - route guard works
- [ ] Day Sheet accessible and loads for today's date by default
- [ ] Previous/next day navigation works, date display updates
- [ ] Today button returns to current date
- [ ] Date picker allows selecting any date
- [ ] Page renders correctly at 768px, 1024px, 1280px, 1440px

### Service Periods & Cover Counts
- [ ] Bookings grouped correctly by service period
- [ ] Service periods shown in chronological order
- [ ] Service period with no bookings shows empty state (not hidden)
- [ ] Cover count per service period is correct
- [ ] Fill bar colour correct: green / amber / red at correct thresholds
- [ ] Day summary bar totals are correct
- [ ] All cover counts update in real time on booking status change

### Booking List - Display
- [ ] All bookings visible for selected date
- [ ] Bookings sorted correctly within service periods
- [ ] Status badges correct colour and label
- [ ] Party size clearly visible in collapsed state
- [ ] Deposit badge correct for all deposit states
- [ ] Special requests visible in collapsed state without expanding
- [ ] Allergy warning icon and bold text appear for allergy-related dietary notes
- [ ] Returning guest indicator visible in collapsed state
- [ ] Cancelled/no-show/completed bookings de-emphasised but visible
- [ ] Active bookings visually prominent

### Status Actions
- [ ] Confirm (PENDING → CONFIRMED): one tap, sends confirmation SMS/email (if not already sent)
- [ ] Seat (CONFIRMED → SEATED): one tap, no message sent
- [ ] Complete (SEATED → COMPLETED): one tap, no message sent
- [ ] No Show: requires confirmation dialog, no message, logs no-show
- [ ] Cancel: requires confirmation dialog, sends cancellation message
- [ ] All transitions respect state machine - no invalid transitions possible
- [ ] Optimistic updates apply immediately, roll back on failure

### Expanded Booking Detail
- [ ] Expands on click, collapses on second click
- [ ] Expansion does not cause scroll jump
- [ ] All fields present: name, phone, email, party size, time, duration, source, created at
- [ ] Special requests shown in full
- [ ] Internal notes editable inline, saved on blur
- [ ] Deposit section shows correct state and all relevant actions
- [ ] Previous visit count correct
- [ ] Communication log present and accurate
- [ ] [Send Custom Message] opens composer correctly
- [ ] [Edit Booking] opens edit mode correctly

### Edit Booking
- [ ] Opens inline (not a full page navigation)
- [ ] All fields editable
- [ ] Party size change re-validates capacity
- [ ] Time change re-validates availability
- [ ] Save writes to database, updates day sheet entry
- [ ] Cancel discards changes

### New Booking & Walk-in
- [ ] [+ New Booking] opens shared modal with date pre-filled
- [ ] New booking appears in correct position in list on creation
- [ ] [Walk-in] button opens streamlined modal
- [ ] Walk-in modal: party size auto-focused on open
- [ ] Walk-in modal: remaining capacity shown for current time slot
- [ ] Walk-in creates SEATED booking immediately, appears in list
- [ ] Walk-in: no confirmation SMS sent

### Filters & Search
- [ ] Service period filter works correctly
- [ ] Status filter shows/hides correct bookings
- [ ] Default filter state: Pending, Confirmed, Seated visible; others hidden
- [ ] Show/hide cancelled toggle works
- [ ] Show/hide no-show toggle works
- [ ] Guest name search filters list in real time
- [ ] Party size search works
- [ ] Clear filters resets to default state
- [ ] Active filter state visually indicated

### Timeline Breakdown
- [ ] Collapsible toggle works
- [ ] Time slots at 30-minute increments
- [ ] Cover counts per slot correct
- [ ] Current time highlighted when viewing today
- [ ] Updates in real time

### Print
- [ ] Print layout triggered by button, browser print dialog opens
- [ ] Interactive elements hidden in print view
- [ ] Bookings grouped by service period in print
- [ ] Allergies bolded and flagged in print
- [ ] Internal notes present in print
- [ ] Cancelled bookings excluded from print
- [ ] Page breaks between service periods if needed
- [ ] Print footer with timestamp and page number

### Real-Time
- [ ] New online booking appears without page refresh
- [ ] Status change from Reservations list reflects without page refresh
- [ ] Deposit payment reflects without page refresh
- [ ] Cover count updates in real time
- [ ] Subscription cleaned up on navigation away
- [ ] Reconnection fallback polling works
- [ ] Amber indicator shown when disconnected

### Performance
- [ ] Day sheet renders fully within 1.5 seconds for a date with 50 bookings
- [ ] Status change (optimistic) applies within 100ms of tap/click
- [ ] Date navigation renders new date's data within 800ms
- [ ] Real-time update appears within 2 seconds of event
- [ ] No redundant Supabase queries on re-render

---

## Implementation Sequencing

Work in this order:

1. Produce gap report - do not skip
2. Fix all P1 bugs
3. Page route guard (hidden when Table Management ON)
4. Date navigation - fully functional
5. Booking status state machine - confirm shared constants used
6. Service period grouping and headers with cover counts
7. Booking entry component - collapsed state with all required fields
8. Allergy detection and visual flagging
9. Inline status action buttons - all transitions
10. Communication triggers for all status changes
11. Booking entry component - expanded state
12. Deposit management within expanded detail
13. Inline edit booking
14. Day summary bar with real-time cover counts
15. Timeline breakdown (collapsible)
16. Walk-in modal
17. New Booking modal integration (shared component)
18. Filters and search
19. Returning guest detection and visit count
20. Print day sheet (CSS @media print)
21. Real-time subscriptions - audit shared hook, fix cleanup, reconnection logic
22. Optimistic updates + rollback on all status changes
23. Empty states for all scenarios
24. Performance - redundant call elimination, list update optimisation
25. Fix all P2 and P3 gaps from gap report
26. Full validation checklist

---

## Scope Notes

**Do not** add any table assignment UI, table references, floor plan links, or table-level thinking to the Day Sheet. This screen is exclusively for the covers-based simple mode. Any table management concerns belong on the Floor Plan and Table Grid screens.

**Do not** rebuild the availability engine, Stripe integration, or Twilio/SendGrid infrastructure. Integrate with existing systems correctly.

**Do not** build a mobile app layout - the Day Sheet should be fully functional on tablet (768px+). On smaller screens, the layout can simplify but must remain usable.

**Do** use the shared booking status state machine, shared New Booking modal, and shared communication engine. If any of these shared components do not exist as shared components - they are duplicated per screen - flag this and consolidate before proceeding.

**Do** raise a flag immediately if any dependency is not functioning correctly and is blocking Day Sheet functionality. Fix the dependency before building the UI that relies on it.
