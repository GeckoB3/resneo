# ReserveNI - Floor Plan & Table Grid: Full Functionality Implementation

**Prompt Type:** Codebase Audit + Full Feature Implementation  
**Scope:** Floor Plan screen and Table Grid screen - complete booking and table management functionality to competitive standard  
**Prerequisite:** System Harmony Audit and Table Management Consolidation prompts must be complete before running this one.  
**Reference Standard:** ResDiary, OpenTable, SevenRooms

---

## Context & Objective

ReserveNI now has a unified Floor Plan screen and a Table Grid screen, both gated behind the Advanced Table Management toggle. These screens currently exist structurally but may lack the full operational functionality that restaurant staff need to run a live service. The goal of this prompt is to audit what is currently built, identify every gap against the competitive standard, and implement complete functionality across both screens.

This is the most complex prompt in the ReserveNI build sequence. Work methodically. Complete and verify each section before moving to the next. Do not attempt to implement everything in a single pass.

---

## Step 1 - Codebase Audit: Map Current Functionality

Before writing any new code, read and document the current state of both screens. For each item below, note: **Built & Working / Built but Broken / Partially Built / Not Built**.

### 1.1 - Floor Plan Screen Audit

**Canvas & Layout**
- [ ] Tables render in correct positions from saved floor plan data
- [ ] Table status overlays render correctly (available, booked, seated, held)
- [ ] Date/time scrubber exists and updates status overlays reactively
- [ ] Multi-area/room support (if applicable)

**Operational Interactions**
- [ ] Clicking a table opens a contextual action panel or popover
- [ ] Popover shows current booking details (guest name, party size, time, notes)
- [ ] Ability to assign an existing unassigned booking to a table from the floor plan
- [ ] Ability to create a new booking directly from the floor plan (click table → new booking flow)
- [ ] Ability to mark a table as Seated from the floor plan
- [ ] Ability to mark a table as Available/Clear from the floor plan
- [ ] Ability to block/hold a table for a time period
- [ ] Ability to move a booking from one table to another (drag or reassign)

**Edit Mode**
- [ ] Tables draggable and repositionable
- [ ] Table properties editable (name, capacity, type, active status)
- [ ] New tables addable from shape picker
- [ ] Tables deletable with booking conflict warning
- [ ] Combinations creatable by multi-selecting tables
- [ ] Combinations editable and deletable
- [ ] Save/Discard flow works correctly
- [ ] Unsaved changes warning on navigation away

**Real-time**
- [ ] Floor plan status updates in real time when another user changes a booking status
- [ ] New bookings assigned to tables appear on the floor plan without page refresh

---

### 1.2 - Table Grid Screen Audit

**Grid Structure**
- [ ] Timeline renders correctly (x-axis = time slots, y-axis = tables)
- [ ] Time range covers full service hours for the selected date
- [ ] Tables are grouped correctly (by area/room if applicable)
- [ ] Date selector exists and switches the grid to the correct day

**Booking Blocks**
- [ ] Existing bookings render as blocks spanning the correct time range
- [ ] Booking blocks show guest name, party size, and status at a glance
- [ ] Booking block colour/styling reflects status (confirmed, seated, pending, no-show, cancelled)
- [ ] Clicking a booking block opens a full booking detail panel

**Booking Management from Grid**
- [ ] Ability to create a new booking by clicking an empty cell
- [ ] Ability to drag a booking block to a different table (same time)
- [ ] Ability to drag a booking block to a different time slot (same table)
- [ ] Ability to resize a booking block to extend or shorten the duration
- [ ] Booking detail panel allows editing all booking fields
- [ ] Booking detail panel allows status changes (Confirm, Seat, Complete, No Show, Cancel)
- [ ] Booking detail panel allows deposit management (view deposit status, issue refund)

**Table Management from Grid**
- [ ] Ability to block a table for a time range directly from the grid
- [ ] Blocked time ranges render visually distinct from bookings
- [ ] Ability to unblock a blocked range

**Real-time**
- [ ] New bookings appear on the grid without page refresh
- [ ] Status changes made on the floor plan are reflected on the grid in real time
- [ ] Status changes made on the grid are reflected on the floor plan in real time

---

### 1.3 - Shared Systems Audit

- [ ] Booking status state machine is consistently defined and used across both screens (and the Reservations list)
- [ ] Supabase Realtime subscriptions are correctly set up, scoped, and cleaned up on unmount
- [ ] Deposit status is accessible from both screens
- [ ] SMS/email communication triggers fire correctly when status changes are made from these screens (e.g. confirming a booking should trigger the confirmation message)
- [ ] Walk-in creation flow is accessible from both screens

---

### 1.4 - Produce a Gap Report

After completing the audit, produce a structured gap report:

```
GAP-[N]
Screen: [Floor Plan | Table Grid | Both]
Category: [Booking Management | Table Management | Real-time | Edit Mode | UI/UX]
Current State: [Not Built | Partially Built | Built but Broken]
Description: [What is missing or broken]
Priority: [P1 - Blocks live service | P2 - Major gap vs competitors | P3 - Polish]
```

Present this gap report before proceeding. Address all P1 gaps first, then P2, then P3.

---

## Step 2 - Floor Plan: Full Implementation

Implement all missing or broken functionality identified in the audit. The sections below define the complete target behaviour for each feature area.

---

### 2.1 - Booking Status State Machine

Before building any status-change interactions, confirm a single shared status state machine exists and is used consistently. If it does not exist as a shared definition, create it now as a constants/types file that both screens import.

**Booking statuses and valid transitions:**

```
PENDING      → CONFIRMED, CANCELLED
CONFIRMED    → SEATED, NO_SHOW, CANCELLED
SEATED       → COMPLETED, CANCELLED
COMPLETED    → (terminal - no further transitions)
NO_SHOW      → (terminal - no further transitions)
CANCELLED    → (terminal - no further transitions)
```

**Additional table-level states (not booking statuses - these are operational overlays):**

```
AVAILABLE    - no booking currently active
BOOKED       - confirmed booking exists for this time window, not yet seated
SEATED       - booking is currently marked as seated
HELD/BLOCKED - manually blocked by staff, no booking
PENDING      - unconfirmed booking exists for this time window
```

Implement a utility function `getTableStatus(tableId, datetime, bookings, blocks)` that derives the correct table-level state for any given moment. Both screens must use this same function for status overlays.

---

### 2.2 - Floor Plan Operational View

#### Table Status Overlays

Each table on the canvas must render with a clear visual status indicator. Use the following colour convention (adjust to match ReserveNI's existing colour palette if one is established, but maintain clear visual distinction):

- **Available:** neutral/light - no fill or very light grey
- **Booked/Confirmed:** green or teal
- **Seated:** deep green or blue - visually distinct from Booked
- **Pending:** amber/yellow
- **Held/Blocked:** grey with a distinct pattern or icon
- **No Show:** red or muted red

Each table should display:
- Table name/number
- If booked/seated: guest surname and party size (e.g. "Smith - 4")
- If booked: booking time (e.g. "19:30")
- A small status badge or colour band

#### Date/Time Scrubber

A date picker and time scrubber at the top of the screen. Changing the date or time reruns `getTableStatus()` for all tables and updates the canvas overlays. This must not trigger a new Supabase query on every scrub movement - debounce time changes by 300ms and derive status from already-fetched booking data where possible. Only re-fetch when the date changes.

#### Table Click - Action Popover

Clicking any table in Operational View opens a popover or slide-in panel. The content of this panel depends on the table's current status:

**If AVAILABLE:**
- "New Booking" button → opens the New Booking modal (see 2.3) pre-filled with this table
- "Assign Existing Booking" button → opens a searchable list of unassigned confirmed bookings for the current date, filtered to party sizes that fit this table
- "Block Table" button → opens a Block Table form (see 2.5)
- Table details: name, capacity, type

**If BOOKED or PENDING:**
- Guest name, party size, booking time, booking reference
- Deposit status badge (Paid / Unpaid / Partial / Waived)
- Special notes/dietary requirements
- "Mark as Seated" button (primary CTA) - transitions booking to SEATED, updates overlay immediately
- "Edit Booking" button → opens full booking edit modal
- "Move to Different Table" button → enters table-reassignment mode (see 2.4)
- "Mark as No Show" button (secondary, with confirmation)
- "Cancel Booking" button (destructive, with confirmation and deposit refund prompt)
- SMS/contact guest option

**If SEATED:**
- Guest name, party size, time seated (derived from status change timestamp)
- Duration seated (live timer: "Seated 1h 23m ago")
- "Mark as Completed / Table Clear" button (primary CTA) - transitions to COMPLETED, returns table to AVAILABLE
- "Edit Booking" button
- "Extend Stay" option (extends the booking's end time - useful for yield management)

**If HELD/BLOCKED:**
- Block reason (if recorded)
- Block time range
- "Remove Block" button
- "Edit Block" button

---

### 2.3 - New Booking Modal (from Floor Plan)

When "New Booking" is triggered from the floor plan, open a modal with the following fields. This modal should reuse the same booking creation component used elsewhere in the application (New Booking page) - do not build a separate one. If the existing component cannot be opened as a modal, refactor it to support both page and modal rendering.

**Pre-filled from context:**
- Table assignment (the table that was clicked)
- Date (from the current floor plan date scrubber)

**Required fields:**
- Guest first name, last name
- Party size (constrained to table capacity - show a warning if party size exceeds table capacity, allow override with confirmation)
- Date and time (time constrained to available slots for the selected table on that date)
- Duration (auto-calculated from service period settings, editable)
- Phone number (required for SMS confirmation)
- Email address (optional)

**Optional fields:**
- Special requests / dietary notes
- Internal notes (not visible to guest)
- Deposit requirement toggle (default based on venue settings)

**On save:**
- Create the booking record in Supabase
- Assign the table in the booking or table_assignments record
- If deposit is required, trigger the Stripe deposit request flow (send payment link via SMS/email)
- If deposit is not required, send booking confirmation via SMS/email per venue communication settings
- Close the modal and update the floor plan canvas immediately

---

### 2.4 - Table Reassignment (Move Booking)

When "Move to Different Table" is selected from the action popover:

1. The popover closes
2. The canvas enters **reassignment mode** - a banner appears: *"Select the table you want to move [Guest Name]'s booking to"*
3. Tables that can accommodate the booking (correct capacity, available at that time) highlight in green. Tables that cannot are dimmed.
4. The user clicks a destination table
5. A confirmation prompt: *"Move [Guest Name]'s booking from Table [X] to Table [Y]?"*
6. On confirm: update the table assignment in the database, update both tables' overlays immediately, exit reassignment mode
7. An "Cancel Move" button in the banner exits reassignment mode without changes

Table availability during reassignment must account for the current booking's time window - a table is only shown as available if it has no conflicting bookings for the same time range.

---

### 2.5 - Block Table

The Block Table form (accessible from the AVAILABLE popover, and from a right-click/long-press context menu on any table):

**Fields:**
- Table (pre-filled, not editable from table click)
- Start time
- End time
- Reason (optional free text - e.g. "Staff lunch", "Private event setup", "Maintenance")
- Repeat (None / Daily / This week only) - optional, implement as a stub if complex

**Behaviour:**
- Blocked ranges are stored in a `table_blocks` table (or equivalent - confirm schema)
- Blocked tables show as HELD on the floor plan and as a distinct block on the Table Grid
- Blocks prevent the availability engine from offering these tables for booking during the blocked period
- Blocks can be removed from the floor plan popover or from the Table Grid

---

### 2.6 - Walk-in Flow from Floor Plan

A **"Walk-in"** button must be accessible from the floor plan toolbar (top of screen, not buried in a table popover). This is a primary operational action during service.

Walk-in flow:
1. Click "Walk-in" in the toolbar
2. A streamlined modal opens (faster than the full New Booking modal):
   - Party size (large number input, easy to tap quickly)
   - Guest name (optional for walk-ins)
   - Phone number (optional for walk-ins)
   - Special notes (optional)
3. The system recommends the best available table based on party size and current occupancy (highlight it on the canvas)
4. Staff can accept the recommendation or click a different table
5. On confirm: booking is created with status SEATED immediately (walk-ins are seated on arrival - no PENDING/CONFIRMED stage)
6. Table overlay updates immediately

---

## Step 3 - Table Grid: Full Implementation

### 3.1 - Grid Structure & Rendering

The grid is the primary scheduling surface for table management, equivalent to ResDiary's diary grid view. It must render with the following structure:

**X-axis (columns):** Time slots in 15-minute increments across the full service day. Show the date and day of week in the header. Allow navigation to previous/next day.

**Y-axis (rows):** One row per table. Tables grouped by area (if areas are configured). Each row shows the table name/number and capacity in a fixed left column.

**Grid cells:** Each cell represents a 15-minute block for a specific table. Empty cells are clickable to initiate a new booking.

**Booking blocks:** Span multiple columns based on booking duration. Must render with:
- Guest surname and party size
- Booking time
- Status colour coding (use the same colour convention as the floor plan)
- Deposit status indicator (small icon: paid/unpaid)
- If the block is too narrow to show text, show only a coloured bar with a tooltip on hover

**Performance:** The grid may contain many tables and many bookings. Virtualise the row rendering if there are more than 20 tables to avoid performance issues. Do not re-render the entire grid when a single booking status changes - update only the affected booking block reactively.

---

### 3.2 - Booking Block Interactions

**Click:** Opens the Booking Detail Panel (see 3.3) as a side panel or modal.

**Drag to different table row (same time):**
- Shows a preview of the block in the new row as the user drags
- On drop: validates availability (same rules as floor plan reassignment)
- On valid drop: prompts confirmation, then updates assignment
- On invalid drop (table occupied or wrong capacity): shows a visual rejection indicator, snaps back

**Drag to different time (same table row):**
- Preview moves with the drag
- On drop: validates the new time slot is available for this table
- On valid drop: prompts confirmation ("Move [Guest Name]'s booking to [New Time]?"), then updates booking start/end time
- This must also update the availability engine to reflect the new time

**Resize (drag right edge of block):**
- Extends or shortens the booking duration in 15-minute increments
- On release: validates the extended time doesn't conflict with another booking on the same table
- On valid resize: updates booking end time in database
- Show a tooltip during resize displaying the new end time

**Right-click context menu on a booking block:**
- Edit Booking
- Change Status (submenu: Confirm / Seat / Complete / No Show / Cancel)
- Move to Table (opens reassignment flow)
- Send Message to Guest
- Block Table After This Booking (auto-fills block start time = booking end time)

**Right-click context menu on an empty cell:**
- New Booking (pre-fills table and time from cell position)
- Block This Slot (pre-fills table and time)
- Walk-in (opens walk-in modal, pre-fills table)

---

### 3.3 - Booking Detail Panel

When a booking block is clicked, a panel slides in from the right (or opens as a modal on smaller viewports). This is the primary booking management surface on the grid. It must contain:

**Header:**
- Guest full name (large, prominent)
- Booking reference number
- Status badge with current status
- Close button

**Booking Summary:**
- Date and time
- Duration
- Party size
- Table assigned (with option to reassign)
- Covers/booking type

**Guest Details:**
- Phone number (click to call on mobile, click to copy on desktop)
- Email address
- Previous visits count (if derivable from booking history - "3rd visit")
- Guest notes/preferences from previous visits (if stored)

**This Booking:**
- Special requests / dietary notes
- Internal staff notes (editable inline)
- Deposit status (Paid £X / Unpaid / Waived) with action button:
  - If unpaid: "Send Payment Link" / "Mark as Waived" / "Record Cash Deposit"
  - If paid: "Issue Refund" (opens refund confirmation with Stripe refund flow)

**Status Actions (primary CTAs, shown based on current status):**

- PENDING → "Confirm Booking" (sends confirmation SMS/email) | "Cancel"
- CONFIRMED → "Mark as Seated" | "Mark as No Show" | "Cancel"
- SEATED → "Mark as Completed" | "Cancel"
- COMPLETED / NO_SHOW / CANCELLED → Status is terminal, show read-only summary

**Edit Booking:**
- An "Edit" button opens the booking fields for editing (name, party size, time, notes)
- Time changes must re-validate table availability and re-check for conflicts
- Party size changes must re-check table capacity
- Save/Cancel edit actions

**Communication Log:**
- A collapsible section showing all SMS and email messages sent for this booking (sent at, message type, delivery status)
- "Send Custom Message" button → opens a free-text SMS field with send button

---

### 3.4 - New Booking from Grid

Clicking an empty cell on the grid opens the New Booking modal (same component as 2.3) with:
- Table pre-filled from the row clicked
- Date pre-filled from the current grid date
- Time pre-filled from the column clicked (rounded to nearest available slot start)

The time field should show only valid slot start times for the selected table - slots that are already occupied or fall within a blocked range should not be selectable.

---

### 3.5 - Table Blocks on the Grid

Blocked time ranges must render as a visually distinct element on the grid - use a hatched or striped fill to clearly distinguish them from bookings. Blocks should show the block reason if one was recorded.

Clicking a block opens a small popover:
- Block time range
- Block reason
- "Remove Block" button (with confirmation)
- "Edit Block" button (opens block edit form)

---

### 3.6 - Grid Toolbar

The grid toolbar (top of the screen, above the grid) must contain:

- **Date navigator:** Previous day arrow / Date picker / Next day arrow / "Today" button
- **View filter:** "All Tables" dropdown - can filter to a specific area/room if areas are configured
- **Walk-in button** (same as floor plan - consistent placement across both screens)
- **New Booking button** (opens new booking modal without a pre-selected table)
- **Legend** (collapsible or hover tooltip): shows colour key for all booking statuses and block types
- **Refresh button** (manual refresh fallback in case real-time subscription drops)

---

## Step 4 - Real-time Synchronisation

Both screens must stay in sync with each other and with the Reservations list in real time. A status change made on the floor plan must immediately reflect on the Table Grid, and vice versa.

### 4.1 - Supabase Realtime Setup

Implement a single shared Supabase Realtime subscription hook that both screens use. This hook should:

- Subscribe to changes on the `bookings` table filtered to the current venue and current date
- Subscribe to changes on the `table_assignments` table (or equivalent) for the current venue
- Subscribe to changes on the `table_blocks` table for the current venue
- On any change event (INSERT, UPDATE, DELETE): update the relevant local state without triggering a full re-fetch
- Clean up subscriptions correctly on component unmount
- Handle subscription failure gracefully - fall back to a polling mechanism (every 30 seconds) if the Realtime connection drops, and display a subtle "Live updates paused - reconnecting..." indicator

### 4.2 - Optimistic Updates

For status changes initiated by the current user (e.g. clicking "Mark as Seated"), apply an **optimistic update** to local state immediately - do not wait for the database write to complete before updating the UI. If the database write fails, roll back the optimistic update and show an error notification.

This applies to:
- Status changes (all transitions)
- Table reassignments
- Block creation and removal

It does not apply to booking creation (where the new record's ID is unknown until the database responds) or booking deletion.

---

## Step 5 - Communication Triggers

Status changes made from either screen must correctly trigger the appropriate SMS/email communications via the existing Twilio/SendGrid communication engine. Verify and implement the following triggers:

| Status Transition | Communication Triggered |
|---|---|
| PENDING → CONFIRMED | Booking confirmation SMS + email |
| Any status → CANCELLED | Cancellation notification SMS + email (if guest contact exists) |
| CONFIRMED → NO_SHOW | No internal trigger - but log the no-show against the guest record |
| Deposit payment link sent | Payment link SMS |
| Deposit received (Stripe webhook) | Payment confirmation SMS |

**Important:** Do not fire duplicate communications. If a confirmation has already been sent for a booking, triggering "Confirm" again from the grid should not send a second confirmation. Check for existing communication log entries before firing.

If the communication engine is handled via an API route or server action, ensure the calls from the Floor Plan and Table Grid go through the same route - do not duplicate the sending logic.

---

## Step 6 - Validation & Final Checklist

### Floor Plan

- [ ] All table status overlays render correctly for the current date/time on load
- [ ] Date/time scrubber updates overlays without unnecessary re-fetches
- [ ] Clicking an available table → correct popover with New Booking, Assign, Block options
- [ ] Clicking a booked table → guest details, Mark Seated CTA, Edit, Move, No Show, Cancel
- [ ] Clicking a seated table → duration timer, Mark Completed CTA, Edit
- [ ] Clicking a blocked table → block details, Remove Block option
- [ ] New booking created from floor plan → table overlay updates immediately
- [ ] Table reassignment flow works end-to-end with availability validation
- [ ] Block Table form creates block, floor plan updates immediately
- [ ] Walk-in flow creates seated booking immediately, floor plan updates
- [ ] Cancellation from floor plan triggers confirmation prompt and communication
- [ ] Real-time: booking created elsewhere appears on floor plan without refresh
- [ ] Real-time: subscription cleans up on unmount (check browser devtools / Supabase dashboard)

### Table Grid

- [ ] Grid renders all tables as rows, time slots as columns, for today's date on load
- [ ] All existing bookings for the date render as correctly sized and coloured blocks
- [ ] Clicking a booking block opens the Booking Detail Panel with correct data
- [ ] All status transitions work from the Booking Detail Panel with correct communication triggers
- [ ] Drag booking to different table row → availability validated, confirmation prompted, database updated
- [ ] Drag booking to different time → availability validated, confirmation prompted, database updated
- [ ] Resize booking block → duration updated in database
- [ ] Right-click context menu on booking block → all options functional
- [ ] Click empty cell → New Booking modal opens pre-filled with table and time
- [ ] Right-click empty cell → New Booking, Block Slot, Walk-in all functional
- [ ] Block renders visually distinct from bookings, click shows remove/edit options
- [ ] Walk-in button in toolbar → walk-in modal → seated booking appears on grid immediately
- [ ] Date navigator switches grid to correct day, fetches correct bookings
- [ ] Real-time: status change on Floor Plan reflects on Table Grid immediately
- [ ] Real-time: new booking from Reservations list appears on grid without refresh
- [ ] Deposit status icons render correctly on booking blocks
- [ ] Booking Detail Panel: "Send Payment Link" triggers Stripe flow and SMS
- [ ] Booking Detail Panel: "Issue Refund" triggers Stripe refund and updates deposit status

### Cross-screen

- [ ] Status changes on either screen are immediately reflected on the other
- [ ] Status changes on either screen are immediately reflected in the Reservations list
- [ ] Communication log is consistent - no duplicate messages sent
- [ ] Walk-in flow produces identical results whether initiated from Floor Plan or Table Grid
- [ ] All error states (network failure, Supabase error, Stripe error) are handled gracefully with user-facing error messages - no silent failures

---

## Implementation Sequencing

Work in this order. Do not skip ahead.

1. Booking status state machine - shared constants/types file
2. `getTableStatus()` utility function - tested independently
3. Supabase Realtime shared hook - verified with console logging before UI integration
4. Floor Plan: table status overlays + date/time scrubber
5. Floor Plan: table click action popover (all four status variants)
6. Floor Plan: New Booking modal integration (reuse existing component)
7. Floor Plan: Table Reassignment flow
8. Floor Plan: Block Table form
9. Floor Plan: Walk-in flow
10. Table Grid: grid structure, rendering, and booking blocks
11. Table Grid: Booking Detail Panel
12. Table Grid: drag-to-reassign (table row)
13. Table Grid: drag-to-reschedule (time slot)
14. Table Grid: resize booking block
15. Table Grid: right-click context menus
16. Table Grid: block rendering and management
17. Table Grid: toolbar (date navigator, walk-in, new booking, filter)
18. Communication triggers - verify all status transitions fire correctly
19. Optimistic updates - implement across all status change interactions
20. Full end-to-end validation against the checklist above

---

## Notes on Scope

**Do not** rebuild the deposit collection flow, Stripe Connect integration, or SMS/email sending infrastructure. These are existing systems - the task is to ensure the Floor Plan and Table Grid correctly call into them.

**Do not** rebuild the availability engine. The task is to ensure these screens correctly query and respect availability when creating or moving bookings.

**Do** flag immediately if any existing system (communications, deposits, availability) has a broken interface that prevents these screens from integrating with it. Resolve the interface issue before proceeding with the UI.

**Mobile:** The Table Grid requires a minimum of 900px viewport width to be usable - below this, show a message directing staff to use the Floor Plan view or the Reservations list. The Floor Plan operational view should be functional on tablet (768px+). Edit mode remains desktop-only.
