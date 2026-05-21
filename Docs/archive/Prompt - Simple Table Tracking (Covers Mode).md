# Prompt - Simple Table Tracking in Covers-Based Mode

## Context

ReserveNI already has a full table management system implemented (floor plan editor, `venue_tables` schema, `booking_table_assignments`, table combinations, timeline grid, etc.). This was built for the full table management mode where tables drive availability.

However, many venues will operate in **simple covers-based mode**, where availability is calculated purely from total covers per time slot. These venues still benefit from knowing which tables are occupied - they just don't want tables to affect their bookable capacity.

This prompt adds support for using the **existing** table management infrastructure in a lightweight, informational-only capacity when a venue is in covers-based mode.

---

## Objectives

1. Allow venues in covers-based mode to define their tables using the existing Tables / Floor Plan UI - same `venue_tables` table, same CRUD operations.
2. When seating a reservation (clicking "Seat"), optionally let staff assign one or more tables from their defined list.
3. When creating a walk-in, optionally let staff assign one or more tables.
4. Display assigned table names on booking rows in the day sheet and reservations pages.
5. Show a table status summary on the day sheet so staff can see at a glance which tables are occupied and which are free.
6. **Crucially:** In covers-based mode, table data must have zero impact on availability calculation or booking logic. It is purely a front-of-house operational aid.

---

## 1. Mode-Aware Behaviour

The venue's mode (covers-based vs full table management) should gate how the existing table infrastructure is used:

### Tables / Floor Plan UI

- In **covers-based mode**, present the tables UI as a simplified list editor - table name, capacity, sort order, active/inactive toggle. The floor plan canvas, auto-assignment settings, and any capacity-driven configuration should be hidden or disabled.
- Add a clear informational banner at the top of the tables UI when in covers-based mode: *"Your availability is based on total covers. Tables are used for seating tracking only and do not affect your bookable capacity."*
- In **full table management mode**, the existing UI and behaviour remains unchanged.

### Availability Engine

- In covers-based mode, the availability calculation endpoints must not query or reference `venue_tables` or `booking_table_assignments` in any way. No changes are needed to the availability engine - just ensure tables are excluded from the calculation path when the venue is in covers-based mode.

---

## 2. Seat Flow - Table Assignment

When a staff member clicks "Seat" on a booking (reservations page or day sheet):

- **If the venue has active tables defined:** Show a compact table selector (popover or inline panel) after clicking Seat, before confirming the status change.
  - Display all active tables as selectable chips showing: table name, capacity, and occupancy status (available/occupied based on whether the table is assigned to another SEATED booking).
  - Allow selecting multiple tables (for large parties across pushed-together tables).
  - Occupied tables should be selectable with a visual warning (soft constraint - warn, don't block). Show the current occupant on hover or tap.
  - If the total capacity of selected tables is less than the party size, show a subtle hint. Not a blocker.
  - Include a "Skip" or "Seat Without Table" option that completes the seating with no assignment. This must be prominent - table assignment should never slow down the seating flow.
  - "Confirm" saves the assignment(s) to `booking_table_assignments` and transitions the booking to SEATED.

- **If the venue has no tables defined:** Skip the table selector entirely. The Seat button works exactly as it does today.

---

## 3. Walk-In Flow - Table Assignment

When staff create a walk-in from the day sheet or reservations page:

- Add the same table selector (from §2) to the walk-in creation form.
- Walk-ins are created with status SEATED, so table assignment happens at creation time.
- Table assignment remains fully optional.

---

## 4. Reservations Page - Table Display

- For SEATED bookings with table assignments, display the assigned table name(s) as a badge or tag on the booking row.
  - Single table: `Table 5`
  - Multiple tables: `Tables 3, 4`
- If a booking is SEATED with no table assigned, show nothing - do not display "No table" or any placeholder.
- Add a table filter to the existing filter controls: filter by specific table, or "Unassigned" (seated bookings with no table).

---

## 5. Day Sheet - Table Display & Status Strip

### Table Status Strip

Add a compact horizontal summary at the top of the day sheet (below date navigation, above the booking list):

- One chip per active table, ordered by `sort_order`.
- Each chip shows: table name, capacity, and colour-coded status:
  - **Green / available:** Not assigned to any SEATED booking.
  - **Red / occupied:** Assigned to a SEATED booking. Show guest name on hover/tap.
- Clicking an occupied chip scrolls to or highlights the relevant booking.
- If the venue has no tables defined, do not render the strip. Optionally show a subtle prompt: *"Want to track which tables are in use? Set up your tables in the Tables section."*

### Booking Rows

- Same table badge display as the reservations page.

---

## 6. Table Occupancy Logic

A table is "occupied" if it is linked via `booking_table_assignments` to a booking with status `SEATED`. When a booking transitions to COMPLETED, CANCELLED, or NO_SHOW, the table is no longer considered occupied. The assignment rows should be preserved in the database for historical reference - do not delete them on status change.

This logic is used only for:
- The table selector occupancy indicators (§2)
- The day sheet table status strip (§5)
- The reservations page table filter (§4)

It must **not** be used anywhere in the availability calculation path.

---

## 7. Reassignment & Removal

- On the booking detail view or inline on the day sheet, display current table assignments as removable chips.
- Staff can reassign (opens the table selector) or remove assignments at any time while a booking is SEATED.

---

## 8. Realtime

Subscribe to changes on `booking_table_assignments` and booking status changes to keep the day sheet table status strip, booking row badges, and the table selector occupancy indicators updated in real time. Use the existing Supabase Realtime patterns.

---

## 9. Implementation Notes

- **No new database tables are needed.** This feature uses the existing `venue_tables` and `booking_table_assignments` tables.
- **No changes to the availability engine.** The covers-based calculation path should already be independent of tables - verify this is the case and ensure no table queries leak into it.
- **Reusable TableSelector component.** Build one shared component for the table selector used in the Seat flow, walk-in form, and reassignment. It takes the venue's active tables, current occupancy state, and an optional pre-selection, and returns the selected table IDs.
- **The simplified tables list UI** in covers-based mode should be a mode-aware presentation of the existing Tables/Floor Plan page, not a separate page or route.
