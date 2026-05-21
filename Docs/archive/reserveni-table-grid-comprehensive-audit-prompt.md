# ReserveNI - Table Grid: Comprehensive Functionality Audit & Implementation

**Prompt Type:** Codebase Audit + Bug Fix + Full Feature Implementation  
**Scope:** Table Grid screen - every feature, interaction, and behaviour required for professional live service operation  
**Prerequisite:** Floor Plan & Table Grid Full Functionality prompt and Automatic Table Combination Engine prompt must be complete before running this one.  
**Reference Standard:** ResDiary, OpenTable, SevenRooms, Resy

---

## Context & Objective

The Table Grid is the primary operational surface for restaurant staff running a live service in Advanced Table Management mode. It must function as a complete, professional booking management tool - equivalent in capability to the diary grid view in ResDiary or the grid view in OpenTable. This prompt defines every feature the Table Grid must support, asks the agent to audit what is currently built against that definition, fix all bugs, and implement everything that is missing.

Work methodically. Complete the audit and produce the gap report before writing any new code. Address bugs in existing functionality before building new features.

---

## Step 1 - Full Codebase Audit

Read all components, hooks, utilities, and API routes related to the Table Grid screen. For every item in the checklist below, record its current state:

**✅ Built & Working | ⚠️ Built but Broken | 🔶 Partially Built | ❌ Not Built**

Record your findings in a gap report (format defined at the end of Step 1) before proceeding to any implementation work.

---

### 1.1 - Grid Structure & Layout

- [ ] Grid renders with tables as rows on the y-axis and time slots as columns on the x-axis
- [ ] Time slots are in 15-minute increments
- [ ] Time range covers the full operational day for the venue (first service period start to last service period end)
- [ ] Table rows are grouped by area/room if areas are configured
- [ ] Each table row has a fixed left column showing table name/number and capacity
- [ ] The fixed left column does not scroll horizontally with the grid
- [ ] The time header row is fixed and does not scroll vertically with the grid
- [ ] Current time is indicated by a vertical line or highlight on the grid when viewing today
- [ ] The grid scrolls horizontally to show the full day without horizontal page scroll
- [ ] The grid scrolls vertically to show all tables without vertical page scroll
- [ ] Row heights are sufficient to display booking block content legibly
- [ ] Column widths are proportional to time (each 15-minute slot = equal width)
- [ ] The grid renders correctly at viewport widths from 900px to 2560px
- [ ] The grid does not cause layout overflow on the page

---

### 1.2 - Date & Navigation

- [ ] A date selector is present at the top of the screen
- [ ] Previous day / Next day arrow buttons are present and functional
- [ ] A "Today" button returns to the current date
- [ ] Changing the date fetches and renders the correct bookings for that day
- [ ] The current time indicator is only shown when viewing today's date
- [ ] The date selector supports keyboard input and calendar picker
- [ ] Navigation to a date with no bookings renders an empty grid (not an error)
- [ ] Navigation to a date in the past renders correctly with historical booking data

---

### 1.3 - Booking Blocks - Rendering

- [ ] Each confirmed, pending, seated, and completed booking renders as a block on the correct table row
- [ ] Booking blocks span the correct number of columns based on booking duration
- [ ] Booking blocks are positioned at the correct start time column
- [ ] Overlapping bookings on the same table (data error) render visibly rather than silently overwriting each other
- [ ] Booking blocks display guest surname and party size at minimum
- [ ] Booking blocks display booking start time
- [ ] Booking blocks display deposit status indicator (paid / unpaid / waived icon)
- [ ] Booking blocks display a special requests indicator if notes exist (small icon)
- [ ] Booking block colour reflects booking status - consistent with floor plan colour convention
- [ ] Cancelled and no-show bookings are hidden from the grid by default (but accessible via filter)
- [ ] Very narrow booking blocks (under 30 minutes) show a condensed view with tooltip on hover
- [ ] Multi-table (combination) bookings show a linked block on each assigned table row with a link indicator icon
- [ ] Blocks render correctly after page load without a flash of unstyled content
- [ ] Blocks render correctly on refresh without positional drift or misalignment

---

### 1.4 - Booking Blocks - Click Interaction

- [ ] Clicking a booking block opens the Booking Detail Panel
- [ ] The Booking Detail Panel opens as a side panel (not a full page navigation)
- [ ] The Booking Detail Panel can be closed without losing grid position
- [ ] Clicking a different block while the panel is open updates the panel to the new booking
- [ ] The Booking Detail Panel displays all booking fields (defined in full in Section 2.3)
- [ ] The Booking Detail Panel is scrollable if content exceeds viewport height

---

### 1.5 - Booking Blocks - Drag Interactions

- [ ] Booking blocks are draggable
- [ ] Dragging a block to a different table row reassigns the booking to that table
- [ ] Dragging a block to a different time column reschedules the booking to that time
- [ ] A drag preview shows the block's new position during the drag operation
- [ ] Invalid drop targets (occupied slots, blocked slots, wrong capacity) are visually indicated during drag
- [ ] Dropping on an invalid target snaps the block back to its original position
- [ ] A confirmation prompt appears before committing a drag-and-drop change
- [ ] Drag-and-drop updates the database and reflects immediately on the grid
- [ ] Drag-and-drop updates the floor plan in real time (other tab/screen)
- [ ] Dragging a combined booking block prompts whether to move the full combination or just that table
- [ ] Drag interactions work correctly with both mouse and touch input

---

### 1.6 - Booking Blocks - Resize Interaction

- [ ] A drag handle is visible on the right edge of each booking block
- [ ] Dragging the right edge extends or shortens the booking duration
- [ ] Duration snaps to 15-minute increments during resize
- [ ] A tooltip shows the new end time during resize
- [ ] Resizing is blocked if the new duration would overlap a booking on the same table
- [ ] Minimum duration is enforced (suggest 15 minutes - or the venue's minimum booking duration if configured)
- [ ] Resizing updates the booking end time in the database on release
- [ ] Resizing updates the floor plan in real time

---

### 1.7 - Empty Cell Interactions

- [ ] Clicking an empty cell opens the New Booking modal
- [ ] The New Booking modal is pre-filled with the table from the clicked row
- [ ] The New Booking modal is pre-filled with the time from the clicked column
- [ ] The New Booking modal is pre-filled with the current grid date
- [ ] Right-clicking an empty cell opens a context menu
- [ ] Context menu option: New Booking (same as click)
- [ ] Context menu option: Walk-in (opens walk-in modal pre-filled with table and time)
- [ ] Context menu option: Block This Slot (opens block form pre-filled with table and time)
- [ ] Context menu closes when clicking elsewhere on the grid

---

### 1.8 - Right-Click Context Menu on Booking Blocks

- [ ] Right-clicking a booking block opens a context menu
- [ ] Context menu option: Edit Booking (opens Booking Detail Panel in edit mode)
- [ ] Context menu option: Change Status (submenu with valid next statuses only)
- [ ] Context menu option: Move to Table (enters table reassignment mode)
- [ ] Context menu option: Reschedule (opens time picker to change booking time)
- [ ] Context menu option: Send Message to Guest (opens message compose panel)
- [ ] Context menu option: Block Table After This Booking (pre-fills block start = booking end time)
- [ ] Context menu option: Cancel Booking (with confirmation)
- [ ] Context menu only shows status options valid for the booking's current status (respects state machine)
- [ ] Context menu closes when clicking elsewhere

---

### 1.9 - Table Blocks (Holds & Closures)

- [ ] Blocked time ranges render on the grid as visually distinct from bookings (hatched or striped fill recommended)
- [ ] Blocks display the block reason if one was recorded
- [ ] Blocks display the block time range
- [ ] Clicking a block opens a block detail popover
- [ ] Block popover shows: table, time range, reason, created by (if stored)
- [ ] Block popover action: Remove Block (with confirmation)
- [ ] Block popover action: Edit Block (opens block edit form)
- [ ] Blocks prevent new bookings being created in the blocked slot (cell appears non-interactive or shows rejection if clicked)
- [ ] Blocks created on the floor plan appear on the grid in real time

---

### 1.10 - Toolbar & Controls

- [ ] Date navigator: previous day / date picker / next day / Today button
- [ ] Walk-in button in toolbar (primary operational shortcut)
- [ ] New Booking button in toolbar (opens modal without pre-selected table or time)
- [ ] View filter: filter grid to show a specific area/room (if areas are configured)
- [ ] Show/hide cancelled bookings toggle
- [ ] Show/hide no-show bookings toggle
- [ ] Status legend: colour key visible or accessible from toolbar (hover tooltip or collapsible panel)
- [ ] Manual refresh button (fallback for real-time disconnection)
- [ ] A real-time connection status indicator (subtle - green dot when live, amber when reconnecting)
- [ ] Print / Export button (see Section 2.7)

---

### 1.11 - Real-Time Synchronisation

- [ ] New bookings created from the Reservations list appear on the grid without page refresh
- [ ] New bookings created from the Floor Plan appear on the grid without page refresh
- [ ] Status changes made on the Floor Plan reflect on the grid without page refresh
- [ ] Status changes made on the grid reflect on the Floor Plan without page refresh
- [ ] Status changes made on the Reservations list reflect on the grid without page refresh
- [ ] Booking cancellations from any screen remove the block from the grid without page refresh
- [ ] New table blocks created on the floor plan appear on the grid without page refresh
- [ ] Supabase Realtime subscription is scoped to the current venue and current date
- [ ] Subscription is cleaned up correctly when navigating away from the grid
- [ ] When Realtime connection drops, the grid falls back to polling every 30 seconds
- [ ] A "Live updates paused - reconnecting" indicator is shown when connection drops
- [ ] The indicator clears when connection is restored

---

### 1.12 - Performance

- [ ] Grid renders without perceptible lag for venues with up to 30 tables and 100 bookings per day
- [ ] Table rows are virtualised if more than 20 tables are present (only visible rows rendered)
- [ ] Status updates from Realtime do not re-render the full grid - only the affected booking block updates
- [ ] Date navigation does not cause a full component remount - fetches new data and updates in place
- [ ] Drag interactions maintain 60fps - no jank during drag
- [ ] The grid does not make redundant Supabase calls on re-render

---

### 1.13 - Gap Report Format

After completing the audit, produce a structured gap report before writing any code:

```
GAP-[N]
Category: [Grid Structure | Date Navigation | Booking Blocks | Drag | Resize | 
           Context Menu | Table Blocks | Toolbar | Real-time | Performance | 
           Booking Detail Panel | Walk-in | New Booking | Communication | Deposits]
Current State: [Built but Broken | Partially Built | Not Built]
Description: [Precise description of what is wrong or missing]
Affected Component/File: [File path or component name if known]
Priority: [P1 - Blocks live service use | P2 - Major gap vs competitors | P3 - Polish & edge cases]
Estimated Complexity: [Low | Medium | High]
```

Sort the gap report: P1 items first, then P2, then P3. Within each priority, sort Low complexity before High.

**Do not begin any implementation until the gap report is complete and presented.**

---

## Step 2 - Implementation: Full Feature Specification

Work through all gaps identified. The sections below define the complete target behaviour for every feature area. Where a feature is already working correctly, skip it. Where it is broken or missing, implement to the specification below.

---

### 2.1 - Grid Structure Requirements

The grid must use a **CSS Grid or absolutely-positioned canvas layout** - not a table element. A `<table>` HTML element will not handle the required interactions (drag, resize, virtual scrolling) adequately.

**Layout architecture:**

```
┌─────────────────────────────────────────────────────────────────┐
│ TOOLBAR (fixed height, full width, above grid)                  │
├──────────┬──────────────────────────────────────────────────────┤
│          │ TIME HEADER (fixed, scrolls horizontally with grid)  │
│  TABLE   ├──────────────────────────────────────────────────────┤
│  LABEL   │                                                      │
│  COLUMN  │  BOOKING GRID (scrolls both axes)                   │
│  (fixed) │                                                      │
│          │                                                      │
└──────────┴──────────────────────────────────────────────────────┘
```

The table label column and time header must remain fixed (sticky) as the user scrolls. The grid body scrolls freely in both directions. Implement using CSS `position: sticky` on the label column and time header.

**Time slot width:** Each 15-minute slot should be a minimum of 40px wide. This ensures booking blocks are wide enough to display content. Allow the venue to adjust this via a zoom control in the toolbar (see Section 2.6).

**Current time indicator:** A red vertical line positioned at the current time, updating every minute. Only render when viewing today's date. The grid should auto-scroll to centre on the current time when the page first loads for today's date.

---

### 2.2 - Booking Status State Machine

Confirm the shared status state machine from the Floor Plan prompt is being used. If the Table Grid has its own local status definitions, consolidate them to use the shared constants. The valid status transitions are:

```
PENDING    → CONFIRMED | CANCELLED
CONFIRMED  → SEATED | NO_SHOW | CANCELLED
SEATED     → COMPLETED | CANCELLED
COMPLETED  → (terminal)
NO_SHOW    → (terminal)
CANCELLED  → (terminal)
```

The context menu "Change Status" submenu must only show valid next statuses for the booking's current status. It must never show terminal statuses as options when the booking is already terminal. It must never show backwards transitions.

**Status colours (apply consistently - match floor plan):**

| Status | Recommended colour treatment |
|---|---|
| PENDING | Amber / yellow |
| CONFIRMED | Teal / green |
| SEATED | Deep blue or dark green |
| COMPLETED | Light grey (muted - service is done) |
| NO_SHOW | Muted red |
| CANCELLED | Hidden by default; if shown, strikethrough + grey |

---

### 2.3 - Booking Detail Panel

This is the primary booking management interface on the Table Grid. It slides in from the right when a booking block is clicked. It must be comprehensive enough that staff can manage every aspect of a booking without leaving the grid.

**Panel sections:**

#### Header
- Guest full name (large, prominent)
- Booking reference number (small, copyable)
- Current status badge (coloured, matches grid colour)
- Close button (×) - closes panel, grid remains in place

#### Booking Summary (read-only by default, editable on click)
- Date
- Start time and end time
- Duration (auto-calculated, displayed)
- Party size
- Assigned table(s) - shows combination if multi-table, with link icon
- Service period (if applicable)
- Source (how the booking was made: Online / Phone / Walk-in / Staff)

#### Guest Details
- First name, last name
- Phone number - clickable to dial on mobile, click-to-copy on desktop
- Email address - clickable to open email client
- Previous visits: derive count from booking history for this phone number/email ("2nd visit", "5th visit" etc.). Show "First visit" if no prior bookings found.
- Guest tags or notes from previous visits (if stored on a guest profile record)

#### This Booking
- Special requests / dietary requirements (displayed prominently - staff need this immediately)
- Internal staff notes (editable inline - click to edit, auto-save on blur)
- Booking channel / source
- Created at timestamp and created by (staff member name if available)

#### Deposit Section
Display one of the following states with appropriate actions:

**Deposit not required:**
> No deposit required for this booking.
> [Request Deposit] button - allows staff to request a deposit post-booking if needed

**Deposit pending / unpaid:**
> Deposit of £[amount] requested - not yet paid
> [Send Payment Link] - resends the Stripe payment link via SMS/email
> [Mark as Waived] - with confirmation ("Are you sure? This cannot be undone.")
> [Record Cash Deposit] - opens a form to manually record a cash deposit amount

**Deposit paid:**
> Deposit of £[amount] paid ✓
> Paid at: [timestamp]
> [Issue Refund] - opens refund confirmation with amount field (defaults to full deposit, allows partial)

**Deposit waived:**
> Deposit waived by [staff name] on [date]

**Deposit refunded:**
> Deposit of £[amount] refunded on [date]

#### Status Action Bar
Primary CTA buttons based on current status - shown prominently at the top of the panel, not buried at the bottom:

| Current Status | Primary CTA | Secondary Actions |
|---|---|---|
| PENDING | Confirm Booking | Cancel |
| CONFIRMED | Mark as Seated | No Show · Cancel |
| SEATED | Mark as Completed | Cancel |
| COMPLETED | (none - terminal) | - |
| NO_SHOW | (none - terminal) | - |
| CANCELLED | (none - terminal) | - |

All status changes must:
1. Apply optimistically to the UI immediately
2. Write to the database
3. Trigger the appropriate communication (see Section 2.5)
4. Roll back the optimistic update with an error notification if the database write fails

#### Communication Log
A collapsible section at the bottom of the panel:
- List of all SMS and email messages sent for this booking
- Each entry: message type, channel (SMS/Email), sent at, delivery status
- [Send Custom Message] button - opens a free-text SMS/email composer within the panel
- Delivery status should reflect Twilio/SendGrid webhook updates where available

#### Edit Mode
An [Edit Booking] button in the panel header opens all booking fields for editing:
- Guest name
- Party size (re-validates table capacity on change - warns if party exceeds table capacity)
- Date and time (re-validates table availability on change - warns if new time conflicts)
- Duration
- Special requests / notes
- Assigned table(s) - opens the combination suggestion UI (from the combination engine prompt) if party size has changed

[Save Changes] and [Cancel] buttons - Save writes to database, closes edit mode. Cancel discards changes, closes edit mode.

---

### 2.4 - New Booking Modal

The New Booking modal opened from the Table Grid must be the same shared component used across the application - not a separate implementation. Verify it is shared. If it is duplicated, consolidate.

When opened from an empty grid cell, pre-fill:
- Table: from the clicked row
- Date: from the current grid date
- Time: from the clicked column, rounded to the nearest valid slot start time

The time selector must show only valid slot start times for the selected table - slots already occupied or within a blocked range must not be selectable. The table selector must show availability indicators for the selected date and time.

If the party size entered exceeds any single table's capacity, trigger the automatic combination suggestion UI from the combination engine.

On successful booking creation:
- Close the modal
- The new booking block must appear on the grid immediately (optimistic update)
- If a deposit is required, the payment link is sent automatically per venue settings

---

### 2.5 - Walk-in Flow

The Walk-in button in the toolbar opens a streamlined modal optimised for speed. During a busy service, staff need to create a walk-in in under 10 seconds.

**Walk-in modal fields:**
- Party size - large number input, prominent, auto-focused on modal open
- Guest name - optional (labelled as optional clearly)
- Phone number - optional (labelled as optional)
- Table assignment - auto-suggested based on party size and current availability; staff can override

**Table suggestion for walk-ins:**
- Highlight the single best available table for the party size on a mini floor plan preview within the modal
- Show alternative available tables in a list below
- If no single table is available, show the best combination (from the combination engine)
- If nothing is available, show: "No tables currently available for a party of [N]. You can add this guest to the waitlist instead." with a [Add to Waitlist] button

**On confirmation:**
- Create a booking with status SEATED immediately (walk-ins skip PENDING and CONFIRMED)
- Record source as "Walk-in"
- The table block must appear on the grid immediately
- No confirmation message is sent (guest is already in the restaurant)

---

### 2.6 - Toolbar: Full Specification

The toolbar sits above the grid at all times and contains:

**Left section:**
- Previous day arrow (‹)
- Date picker (shows selected date, opens calendar on click)
- Next day arrow (›)
- Today button

**Centre section:**
- Service period filter - if the venue has multiple service periods (lunch, dinner), allow filtering the grid to show only one period's time range. Default: show all.
- Area/room filter - if areas are configured, filter the grid to show only tables in one area. Default: show all.
- Status filter - show/hide bookings by status. Checkboxes or multi-select dropdown. Default: show Pending, Confirmed, Seated. Hide Cancelled and No-show by default.

**Right section:**
- Walk-in button (primary - always visible)
- New Booking button (secondary)
- Zoom control - a slider or +/- buttons that adjust the time slot column width between a minimum of 30px and maximum of 80px per 15-minute slot. Default: 40px. Persist zoom preference per user in localStorage.
- Print / Export button (see Section 2.7)
- Real-time status indicator (green dot = live / amber dot = reconnecting)
- Manual refresh button (circular arrow icon)

---

### 2.7 - Print & Export

From the Print/Export button in the toolbar, offer:

**Print Day Sheet:**
Generates a print-optimised view of the current grid date - a formatted list of all bookings for the day, grouped by service period and table, showing guest name, party size, time, status, and special requests. This is the equivalent of ResDiary's printable day sheet. Use `window.print()` with a print-specific CSS stylesheet that hides the toolbar and renders the booking list clearly.

**Export to CSV:**
Downloads a CSV file of all bookings for the current grid date with columns: Booking Reference, Guest Name, Party Size, Table, Start Time, End Time, Duration, Status, Deposit Status, Special Requests, Phone, Email, Source, Created At.

Do not implement PDF export at this stage - the CSV and print view cover the immediate need.

---

### 2.8 - Drag & Drop: Full Implementation

Drag and drop is the most technically complex feature on the Table Grid. Implement it carefully and test thoroughly.

**Library:** Use the canvas/drag library already in place in the codebase. Do not introduce a second drag library. If the existing implementation cannot support the required behaviour, flag this before proceeding.

**Drag to reassign table (vertical drag):**
1. User begins dragging a booking block downward or upward
2. A ghost/preview element follows the cursor
3. As the cursor moves over different table rows, the target row highlights
4. Rows that cannot accept the booking (table too small for party, slot occupied, table blocked) render with a red/unavailable highlight and a tooltip: "Table [X] is occupied at this time" or "Table [X] capacity ([N]) is too small for a party of [N]"
5. Rows that can accept the booking render with a green/available highlight
6. On drop over a valid row: show a confirmation dialog - "Move [Guest Name]'s booking from [Table A] to [Table B]?" - Confirm / Cancel
7. On confirm: update `table_assignments` in database, update grid immediately
8. On cancel or drop over invalid row: snap back to original position

**Drag to reschedule (horizontal drag):**
1. User begins dragging a booking block left or right
2. Ghost element follows cursor along the same table row
3. Time slots that would cause a conflict (overlapping another booking on the same table) are highlighted as invalid
4. On drop over a valid time: show confirmation dialog - "Move [Guest Name]'s booking to [New Time]?" - Confirm / Cancel
5. On confirm: update booking start time and end time in database (preserving duration), update grid
6. On cancel or invalid drop: snap back

**Drag for combined bookings:**
1. Dragging any block of a combined (multi-table) booking shows a prompt before drag begins: "Move just this table's assignment, or move the full booking to a new table combination?"
2. Option A - Move full booking: all table assignments update together
3. Option B - Move this table only: only the dragged table's assignment changes (the booking becomes partially reassigned - flag this as a potentially unusual state and log it)
4. Implement Option A fully. Implement Option B as a confirmation that writes the partial reassignment without additional logic - this edge case can be handled manually by staff.

---

### 2.9 - Resize: Full Implementation

**Drag handle:**
A visually distinct handle on the right edge of each booking block - a thin vertical bar or resize cursor indicator. The handle should be 8px wide and span the full height of the block. It must be visually distinct from the block itself so staff know it is interactive.

**Resize behaviour:**
1. User clicks and drags the right edge handle
2. The block's right edge follows the cursor, snapping to 15-minute column boundaries
3. A tooltip above the handle shows the new end time (e.g. "21:30") updating in real time
4. If the new end time would overlap the next booking on the same table row, the block stops expanding at the start time of that booking
5. Minimum duration: 15 minutes (or the venue's configured minimum - whichever is greater)
6. On release: if duration has changed, update the booking end time in the database immediately (no confirmation required for resize - it is low-risk compared to reassignment)
7. If the database update fails: roll back the visual resize and show an error notification

---

### 2.10 - Table Blocks: Full Implementation

**Rendering:**
Table blocks must render as a visually distinct element that is clearly not a booking. Use a diagonal hatching pattern or a distinct background texture. Use a neutral colour (grey or slate) that does not suggest a booking status. Show the block reason text if it fits; otherwise show on hover tooltip.

**Creating a block from the grid:**
Two entry points:
1. Right-click empty cell → "Block This Slot" → form opens pre-filled with table and time
2. Right-click booking block → "Block Table After This Booking" → form opens pre-filled with table, start time = booking end time

**Block form fields:**
- Table (pre-filled, editable)
- Start time (pre-filled, editable - time picker)
- End time (required - time picker, must be after start)
- Reason (optional free text - e.g. "Private event setup", "Staff meal", "Maintenance")
- Repeat options: None (default) / Every day this week / Custom dates - implement None and "Every day this week" only; custom dates can be a future feature

**Block detail popover (click existing block):**
- Table name
- Time range
- Reason (if recorded)
- Created by and created at (if stored)
- [Edit Block] → opens edit form with same fields
- [Remove Block] → confirmation: "Remove this block? This will make the slot available for bookings again." → Confirm / Cancel

**Blocks and availability:**
Confirm that the availability engine treats blocked slots as unavailable. A blocked table should not be offered in the New Booking time selector or in the combination engine for the blocked period.

---

### 2.11 - Real-Time: Full Implementation

Refer to the shared Supabase Realtime hook built in the Full Functionality prompt. Confirm the Table Grid is using this shared hook. If it has its own subscription implementation, consolidate.

The grid must subscribe to the following Supabase Realtime events, scoped to the current venue ID and current date:

| Table | Events | Grid Action |
|---|---|---|
| `bookings` | INSERT | Add new booking block |
| `bookings` | UPDATE | Update affected booking block (status, time, party size) |
| `bookings` | DELETE | Remove booking block |
| `table_assignments` | INSERT / UPDATE / DELETE | Reassign booking block to correct table row |
| `table_blocks` | INSERT | Add block element to grid |
| `table_blocks` | UPDATE | Update block element |
| `table_blocks` | DELETE | Remove block element |

**Optimistic updates:**
All actions initiated by the current user (status changes, drag-and-drop, resize, block creation) must apply optimistically to the local grid state before the database write completes. On database write failure: roll back the optimistic update and display a non-blocking error notification (toast) that does not lose the user's place on the grid.

**Reconnection:**
If the Supabase Realtime connection drops:
1. Show a subtle amber indicator in the toolbar ("Live updates paused")
2. Begin polling for changes every 30 seconds using a standard Supabase query
3. When connection is restored: switch back to Realtime, stop polling, clear the indicator
4. On reconnection: perform a single full re-fetch of bookings for the current date to catch any changes missed during the disconnection window

---

### 2.12 - Communication Triggers from Table Grid

Every status change made from the Table Grid must trigger the correct communication via the existing Twilio/SendGrid communication engine. Confirm each trigger is firing correctly:

| Action | Communication Triggered | Condition |
|---|---|---|
| PENDING → CONFIRMED | Booking confirmation SMS + email | Only if confirmation not already sent |
| Status → CANCELLED | Cancellation notification SMS + email | Only if guest has contact details |
| CONFIRMED → NO_SHOW | No outbound message | Log no-show against guest record |
| Deposit payment link sent | Payment link SMS | On demand from Booking Detail Panel |
| [Send Custom Message] | Free-text SMS/email | On demand |

**Duplicate prevention:** Before firing any communication, check the communication log for this booking. If a confirmation has already been sent, do not send another. Show a note in the panel: "Confirmation already sent on [date]" with an option to [Resend] if the staff member explicitly wants to.

---

### 2.13 - Performance Requirements

The grid must meet the following performance targets. Test against these after implementation:

- **Initial load (today's date, 20 tables, 60 bookings):** Grid fully rendered and interactive within 1.5 seconds of page load
- **Date navigation:** New date's bookings rendered within 800ms of clicking next/previous day
- **Drag initiation:** Drag ghost appears within 16ms of mousedown (one frame)
- **Realtime update:** A status change made on another screen appears on the grid within 2 seconds
- **Resize:** Block edge follows cursor without visible lag

**If row virtualisation is not yet implemented:**
Implement it now if the venue has more than 20 tables. Use a virtualisation approach that only renders table rows currently visible in the scrollable viewport, plus a buffer of 3 rows above and below. The fixed table label column must still render all row labels for the scroll container height to be correct.

---

## Step 3 - Bug Fixes

After producing the gap report and before building new features, fix all bugs identified as "Built but Broken" or "Partially Built." Common issues to check specifically:

**Grid alignment bugs:**
- Booking blocks misaligned with time header columns (off by one slot, or drifting at certain zoom levels)
- Booking blocks overlapping row boundaries
- Fixed header/label column not staying sticky on all browsers

**Data bugs:**
- Bookings appearing on wrong table row (table_id mismatch)
- Booking duration calculated incorrectly (timezone issues - confirm all times are stored and displayed in the venue's local timezone)
- Bookings from previous days appearing on today's grid (date filter not applied correctly)
- Completed or cancelled bookings appearing when they should be hidden

**Interaction bugs:**
- Drag ghost element persisting after drop
- Resize handle not appearing on short booking blocks
- Context menu not closing when clicking grid background
- Booking Detail Panel not updating when a different block is clicked while panel is open

**Real-time bugs:**
- Subscription not being cleaned up on unmount (visible as duplicate events on returning to the grid)
- Optimistic update not rolling back on database failure
- Grid not re-fetching on reconnection after dropped connection

---

## Step 4 - Final Validation Checklist

Work through every item. Do not mark as complete until manually tested.

### Grid Structure
- [ ] Fixed label column stays sticky during horizontal scroll
- [ ] Fixed time header stays sticky during vertical scroll
- [ ] Current time line renders on today, at correct position, updates every minute
- [ ] Grid auto-scrolls to current time on load for today's date
- [ ] Grid renders correctly at 900px, 1280px, 1440px, and 1920px viewport widths

### Date Navigation
- [ ] Previous/next day navigation fetches correct data
- [ ] Today button returns to current date and scrolls to current time
- [ ] Date picker allows typing a date and navigating to it
- [ ] Date with no bookings renders empty grid without errors

### Booking Blocks
- [ ] All booking statuses render with correct colour
- [ ] Deposit status icon renders on all blocks
- [ ] Special requests icon renders when notes exist
- [ ] Combined booking blocks show link icon on all assigned table rows
- [ ] Very narrow blocks show condensed view with tooltip
- [ ] Cancelled/no-show bookings hidden by default, visible when filter enabled

### Booking Detail Panel
- [ ] Opens on block click with correct data
- [ ] Previous visits count renders correctly
- [ ] Internal notes save automatically on blur
- [ ] All status actions work with correct communication triggers
- [ ] Deposit section shows correct state and actions for all deposit states
- [ ] Communication log shows all messages for the booking
- [ ] Edit mode: party size change triggers combination suggestion if needed
- [ ] Edit mode: time change validates availability before saving

### Drag & Drop
- [ ] Vertical drag: valid rows highlighted green, invalid rows highlighted red with tooltip
- [ ] Vertical drag: confirmation prompt before committing
- [ ] Vertical drag: snap-back on cancel or invalid drop
- [ ] Horizontal drag: time conflict zones highlighted red
- [ ] Horizontal drag: confirmation prompt before committing
- [ ] Combined booking drag: prompt for full vs partial move

### Resize
- [ ] Drag handle visible and cursor changes on hover
- [ ] Block resizes in 15-minute increments
- [ ] Tooltip shows new end time during resize
- [ ] Block stops expanding at next booking boundary
- [ ] Database updates on release
- [ ] Rolls back on database failure

### Empty Cell Interactions
- [ ] Click opens New Booking modal with table, date, time pre-filled
- [ ] Right-click opens context menu with all three options
- [ ] All context menu options work correctly

### Right-Click on Booking
- [ ] Context menu shows only valid next statuses
- [ ] All context menu options open the correct modal or action
- [ ] Context menu closes on outside click

### Table Blocks
- [ ] Blocks render with hatched/distinct visual style
- [ ] Block reason displays in block and tooltip
- [ ] Click opens popover with remove/edit options
- [ ] Remove block frees the slot immediately
- [ ] Block creation from right-click context menu works
- [ ] Block created on floor plan appears on grid in real time

### Toolbar
- [ ] Service period filter correctly narrows the time range shown
- [ ] Area filter correctly narrows rows shown
- [ ] Status filter correctly shows/hides booking statuses
- [ ] Zoom control adjusts column width and persists on reload
- [ ] Walk-in modal: auto-focuses party size field, suggests correct table
- [ ] Walk-in: creates SEATED booking immediately, appears on grid

### Print & Export
- [ ] Print day sheet renders correctly in print preview
- [ ] Print view hides toolbar and interactive elements
- [ ] CSV export downloads correctly with all required columns
- [ ] CSV contains correct data for the current grid date

### Real-Time
- [ ] Booking created on floor plan appears on grid within 2 seconds
- [ ] Status change on floor plan reflects on grid within 2 seconds
- [ ] Subscription cleaned up on navigation away (no duplicate events on return)
- [ ] Reconnection indicator appears when connection drops
- [ ] Full re-fetch occurs on reconnection

### Performance
- [ ] Initial load under 1.5 seconds for 20 tables / 60 bookings
- [ ] Date navigation under 800ms
- [ ] Drag initiation under 16ms
- [ ] No redundant Supabase calls on re-render

---

## Implementation Sequencing

Work in this order:

1. Produce gap report - do not skip
2. Fix all P1 bugs identified in gap report
3. Grid structure fixes (sticky columns, alignment, timezone)
4. Booking block rendering (all statuses, icons, combined blocks)
5. Booking Detail Panel - complete implementation
6. Status change actions + communication triggers
7. Empty cell click → New Booking modal integration
8. Right-click context menus (empty cells and booking blocks)
9. Walk-in flow
10. Table blocks - rendering, creation, editing, removal
11. Drag to reassign table (vertical)
12. Drag to reschedule time (horizontal)
13. Combined booking drag behaviour
14. Resize implementation
15. Toolbar - service period filter, area filter, status filter, zoom control
16. Print day sheet + CSV export
17. Real-time - audit shared hook, fix subscription cleanup, implement reconnection logic
18. Optimistic updates + rollback on all actions
19. Performance - virtualisation, memoisation, redundant call elimination
20. Fix all P2 and P3 gaps from gap report
21. Full validation checklist

---

## Scope Notes

**Do not** rebuild the availability engine, Stripe integration, Twilio/SendGrid sending infrastructure, or the combination detection algorithm. These exist - integrate with them correctly.

**Do not** build a mobile layout for the Table Grid. Below 900px, show a clear message directing staff to use the Floor Plan or Reservations list.

**Do** raise a flag immediately if any dependency (availability engine, communication engine, Stripe webhook handling) is not functioning correctly and is blocking Table Grid functionality. Resolve the dependency issue before building the UI that depends on it.

**Do** ensure every database write from the Table Grid goes through the same API routes or server actions used by the rest of the application. Do not write to Supabase directly from client components where server-side validation should occur.
