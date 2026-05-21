# ReserveNI - Table Management Grid Implementation Plan

**Comprehensive Implementation Guide for Cursor AI Agents**
**March 2026 | Version 1.0**

---

## 1. Industry Analysis: How the Best Platforms Handle Table Management

This section analyses how OpenTable, SevenRooms, ResDiary, Resy, and Eat App implement table management, identifying the patterns that make a world-class system and the mistakes that frustrate restaurant staff.

### 1.1 The Three Views Every Competitor Offers

Every serious table management platform provides three complementary views of the same data. Each serves a different purpose during different moments of a restaurant's day:

**Floor Plan View** - A visual representation of the restaurant's physical layout. Tables are shown as shapes (circles for round tables, rectangles for rectangular) positioned where they actually sit on the floor. Colour-coded by status. Used primarily for at-a-glance spatial awareness during service: "where is the open table?" SevenRooms and OpenTable treat this as the primary view during live service.

**Timeline Grid View** - Tables on the Y-axis, time slots on the X-axis. Bookings appear as horizontal bars spanning their expected duration. This is the power view for planning and optimisation: hosts can see gaps between bookings, identify where a walk-in could fit, and drag bookings between tables. ResDiary and Resy treat this as the primary planning view. SevenRooms calls it "Grid View" and describes it as the tool to "plan out shifts and improve the flow of service."

**List View** - A traditional sorted list of bookings, essentially the day sheet. This is the fallback for quick reference and for staff who are less comfortable with visual interfaces. Every platform keeps this available as a simpler alternative.

### 1.2 Key Features from Industry Leaders

| Feature | OpenTable | SevenRooms | ResDiary | Resy |
|---|---|---|---|---|
| Floor plan editor | Drag-and-drop with shapes and zones | Drag-and-drop with custom areas | Table plan with zones | Custom layouts |
| Timeline grid | Yes - tables × time with booking blocks | "Grid View" for shift planning | Yes - core planning tool | "Smart Grid" - 15-min slots |
| Drag-and-drop rebooking | Yes - between tables and times | Yes - with auto-validation | Yes - with capacity checks | Yes |
| Table status tracking | Available → Seated → Mains → Dessert → Bill → Bussing | Custom statuses with POS integration | Basic status tracking | Custom statuses |
| Table combinations | Flexible linking for large parties | Dynamic table linking | Table groups for large parties | Flexible combinations |
| Auto-assignment | "Smart Assign" recommends optimal table | AI auto-seating algorithm | Manual or rule-based | Automated table optimisation |
| Colour coding | Status-based colours | Status + VIP + occasion colours | Status-based | Status-based with urgency |
| Real-time updates | Yes - across all devices | Yes - all views synchronise | Yes | Yes |
| Walk-in accommodation | Visual gap identification | AI suggests best table | Manual identification | Grid shows gaps |
| Server sections | Assign tables to servers, rotate sections | Server section management | Basic server assignment | Server rotation |

### 1.3 What Makes a Table Management Grid "World Class"

Based on analysis, the features that separate excellent from mediocre are:

1. **Speed of interaction** - Every action during service must be achievable in 1-2 taps/clicks. Hosts are under pressure. A drag-and-drop that takes 3 seconds is too slow if it could take 1 second. OpenTable and SevenRooms optimise ruthlessly for interaction speed.

2. **Information density without clutter** - The timeline grid shows a lot of data (table names, booking names, party sizes, statuses, dietary flags, VIP markers, durations) but must never feel overwhelming. The best implementations use colour, iconography, and progressive disclosure (hover/tap for details, not everything visible at once).

3. **Visual gap identification** - The single most valuable feature of a timeline grid is making empty time gaps immediately visible. A host should be able to glance at the grid and instantly see "table 5 has a 2-hour gap from 7:30pm" without counting slots. This is achieved through whitespace contrast and optional "gap highlight" overlays.

4. **Drag-and-drop with guardrails** - Dragging a booking to a new table must validate in real-time: does the table have enough capacity? Does it overlap with another booking? Is the table available for the full duration? Invalid drops should be visually indicated (red highlight on the target) before the user releases, not after.

5. **Seamless toggle between modes** - Venues must be able to switch between covers-based (simple) and table management (advanced) without data loss. Existing bookings should remain valid. The toggle should be frictionless - not a migration.

6. **Offline resilience** - During service, if the WiFi drops, the grid should remain readable from its last state, queue any actions, and sync when reconnected. A blank screen during peak service is unacceptable.

### 1.4 Common Complaints About Competitor Implementations

From review analysis, the most frequent frustrations restaurant staff report are:

- **Slow load times** - Grids with many tables and bookings can become sluggish. Performance must be a first-class concern.
- **Confusing table combination UX** - Linking/unlinking tables for large parties is often unintuitive. This needs to feel natural.
- **No undo** - Accidentally dragging a booking to the wrong table with no way to reverse it is infuriating mid-service.
- **Status updates require too many clicks** - Changing a table from "Seated" to "Mains" should be one tap, not three.
- **Floor plan editor is fiddly** - Positioning tables precisely is annoying on a tablet. The editor needs to be forgiving and snap-to-grid.

---

## 2. ReserveNI Current State & Integration Points

Based on the implemented availability engine improvement plan, ReserveNI now has:

### 2.1 Existing Architecture to Build On

- **`venue_services` table** - Named services (Lunch, Dinner) with independent rules, days of week, start/end times.
- **`service_capacity_rules` table** - Yield management with max covers per slot, max bookings per slot, slot intervals, buffer minutes, day/time overrides.
- **`party_size_durations` table** - Duration by party size per service.
- **`booking_restrictions` table** - Advance booking limits, party size limits, large party threshold.
- **`availability_blocks` table** - Closures and overrides.
- **`bookings` table** - Now includes `service_id`, `estimated_end_time`, `actual_seated_time`, `actual_departed_time`.
- **Availability engine** at `lib/availability-engine.ts` - Calculates slots using dual-constraint yield management.
- **Events table** - Immutable audit log for all booking actions.
- **Supabase Realtime** - Already used for dashboard and day sheet live updates.
- **Unified Reservations Dashboard** - Booking list with status management, modification, walk-in entry.
- **Day Sheet** - Service view with check-in, no-show recording, dietary highlights.

### 2.2 What Table Management Adds

Table management is an **optional layer on top of** the existing covers-based system, not a replacement. The architectural principle is:

```
Covers-based availability (existing) = ALWAYS active
Table-level availability (new)       = OPTIONAL layer, venue toggle
```

When table management is **disabled** (default): Everything works exactly as it does today. Availability is calculated purely on covers. No tables, no floor plan, no grid.

When table management is **enabled**: The system checks BOTH covers-based capacity AND table-level availability. A booking is only allowed if there are enough covers in the slot AND a suitable table (or combination) is available for the full duration. The tighter constraint wins - this is the hybrid model identified as the gold standard in the availability engine plan.

### 2.3 Design Principles for ReserveNI's Implementation

1. **Toggle, not migration** - Venues enable table management with a single switch. Existing bookings become "unassigned" and can be allocated to tables at the venue's pace.
2. **Mobile-first timeline grid** - The grid must work beautifully on a tablet at the host stand. This is the primary use case.
3. **Progressive complexity** - Start simple (add tables, see the grid), unlock advanced features as needed (combinations, server sections, custom statuses).
4. **Always fall back gracefully** - If a venue turns off table management, everything reverts to covers-based with zero data loss.

---

## 3. Database Schema

### 3.1 New Tables

**A) `venue_tables`** - Physical tables in the restaurant.

```sql
CREATE TABLE venue_tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                    -- e.g. 'Table 1', 'Booth A', 'Bar 5'
  min_covers INT NOT NULL DEFAULT 1,     -- minimum party size for this table
  max_covers INT NOT NULL DEFAULT 2,     -- maximum party size for this table
  shape TEXT NOT NULL DEFAULT 'rectangle', -- 'rectangle', 'circle', 'square'
  zone TEXT,                             -- e.g. 'Main Dining', 'Terrace', 'Private', 'Bar'
  position_x NUMERIC,                   -- floor plan X coordinate (percentage 0-100)
  position_y NUMERIC,                   -- floor plan Y coordinate (percentage 0-100)
  width NUMERIC DEFAULT 10,             -- floor plan width (percentage)
  height NUMERIC DEFAULT 8,             -- floor plan height (percentage)
  rotation NUMERIC DEFAULT 0,           -- rotation in degrees
  sort_order INT NOT NULL DEFAULT 0,    -- display order in timeline grid
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(venue_id, name)
);
```

**B) `table_combinations`** - Defines which tables can be combined for larger parties.

```sql
CREATE TABLE table_combinations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                    -- e.g. 'Tables 1+2', 'Big Booth'
  combined_min_covers INT NOT NULL,      -- minimum party for this combination
  combined_max_covers INT NOT NULL,      -- maximum party for this combination
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE table_combination_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  combination_id UUID NOT NULL REFERENCES table_combinations(id) ON DELETE CASCADE,
  table_id UUID NOT NULL REFERENCES venue_tables(id) ON DELETE CASCADE,
  UNIQUE(combination_id, table_id)
);
```

**C) `booking_table_assignments`** - Links bookings to tables (or table combinations).

```sql
CREATE TABLE booking_table_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  table_id UUID NOT NULL REFERENCES venue_tables(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by UUID REFERENCES staff(id),  -- null = auto-assigned
  UNIQUE(booking_id, table_id)
);
-- A booking assigned to a combination will have multiple rows (one per table in the combination)
```

**D) `table_statuses`** - Tracks real-time status progression of each table during service.

```sql
CREATE TABLE table_statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id UUID NOT NULL REFERENCES venue_tables(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES bookings(id),  -- null when table is free
  status TEXT NOT NULL DEFAULT 'available',
  -- Statuses: 'available', 'reserved', 'seated', 'starters', 'mains', 
  --           'dessert', 'bill', 'paid', 'bussing'
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES staff(id),
  UNIQUE(table_id)  -- only one active status per table
);
```

**E) Venue-level toggle** - Add to existing `venues` table:

```sql
ALTER TABLE venues ADD COLUMN table_management_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE venues ADD COLUMN floor_plan_background_url TEXT;  -- optional background image
```

### 3.2 Row-Level Security Policies

All new tables follow the same pattern as existing tables: staff can only CRUD data for their own `venue_id`. Policies should use the existing auth pattern:

```sql
-- Example for venue_tables (apply same pattern to all new tables)
ALTER TABLE venue_tables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view own venue tables" ON venue_tables
  FOR SELECT USING (venue_id IN (
    SELECT venue_id FROM staff WHERE id = auth.uid()
  ));

CREATE POLICY "Admin staff can manage own venue tables" ON venue_tables
  FOR ALL USING (venue_id IN (
    SELECT venue_id FROM staff WHERE id = auth.uid() AND role = 'admin'
  ));
```

### 3.3 Indexes for Performance

```sql
CREATE INDEX idx_venue_tables_venue ON venue_tables(venue_id) WHERE is_active = true;
CREATE INDEX idx_booking_table_assignments_booking ON booking_table_assignments(booking_id);
CREATE INDEX idx_booking_table_assignments_table ON booking_table_assignments(table_id);
CREATE INDEX idx_table_statuses_table ON table_statuses(table_id);
CREATE INDEX idx_table_combinations_venue ON table_combinations(venue_id) WHERE is_active = true;
```

---

## 4. Availability Engine Integration

### 4.1 The Hybrid Constraint Model

When `table_management_enabled` is true, the availability check becomes a two-stage gate:

**Stage 1 (existing):** Does the covers-based yield management allow this booking? Check `max_covers_per_slot`, `max_bookings_per_slot`, day/time overrides, blocks, and restrictions. If this fails, the booking is rejected regardless of table availability.

**Stage 2 (new):** Is there a suitable table (or combination) available for the full duration of this booking? A table is "available" for a booking if: (a) the table's `max_covers >= party_size` and `min_covers <= party_size`, (b) no other booking is assigned to this table with an overlapping time window (booking_time to estimated_end_time + buffer), (c) the table is active.

If no single table fits, check table combinations: find a combination where `combined_max_covers >= party_size` and ALL component tables are available for the full duration.

Both stages must pass. The booking is only permitted if covers capacity allows it AND a suitable table exists.

### 4.2 Table Availability Function

Create a new function in the availability engine:

```typescript
// lib/table-availability.ts

interface TableAvailabilityResult {
  available: boolean;
  suggestedTable: VenueTable | null;
  suggestedCombination: TableCombination | null;
  allOptions: (VenueTable | TableCombination)[];  // all valid options, sorted by fit
}

function getAvailableTablesForBooking(
  venueId: string,
  date: string,
  startTime: string,
  durationMinutes: number,
  bufferMinutes: number,
  partySize: number
): Promise<TableAvailabilityResult>
```

**Sorting logic for suggestions (best fit first):**
1. Prefer single tables over combinations (simpler).
2. Among single tables, prefer the smallest table that fits (don't seat a party of 2 at a 6-top if a 2-top is free). This is the "short-sell protection" concept from ResDiary.
3. Among combinations, prefer the fewest tables combined.
4. If multiple options are equally good, use `sort_order` as tiebreaker.

### 4.3 Auto-Assignment

When a booking is created (online or phone) and table management is enabled:
1. Run the table availability function.
2. If a suitable table/combination is found, auto-assign it (create `booking_table_assignments` rows).
3. If no suitable table is found but covers capacity allows it, create the booking as "unassigned" - it appears in the grid's unassigned sidebar for manual allocation by staff.
4. Log a `booking.table_assigned` or `booking.table_unassigned` event.

Staff can always override auto-assignment by dragging the booking to a different table in the grid.

### 4.4 Backward Compatibility

When `table_management_enabled` is false:
- The table availability check is skipped entirely.
- No `booking_table_assignments` rows are created.
- The timeline grid and floor plan views are hidden from the dashboard.
- The existing day sheet and reservations dashboard work exactly as before.

When a venue enables table management for the first time:
- All existing future bookings become "unassigned" (no table assignments exist).
- The grid shows them in an "Unassigned" sidebar.
- Staff can drag them onto tables at their own pace.
- No disruption to the booking flow - guests are unaffected.

---

## 5. Timeline Grid View - Specification

This is the centrepiece feature. It must be the best version of this view available in any restaurant platform at this price point.

### 5.1 Layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [< Prev Day] [Today: Fri 14 Mar 2026] [Next Day >]  [Dinner ▼] [+ Walk-in] │
├──────────┬───────┬───────┬───────┬───────┬───────┬───────┬───────┬──────┤
│          │ 17:00 │ 17:15 │ 17:30 │ 17:45 │ 18:00 │ 18:15 │ 18:30 │ ... │
├──────────┼───────┴───────┴───────┴───────┴───────┴───────┴───────┴──────┤
│ Table 1  │ ██ Smith (4) 🎂 ████████████████████  │                      │
│ (2-4)    │ 17:00-18:30  Confirmed               │                      │
├──────────┼──────────────────────────────────────────────────────────────┤
│ Table 2  │         │ ██ Jones (2) ██████████  │ ██ Wilson (3) 🌱 █████ │
│ (2-4)    │         │ 17:15-18:30             │ 19:00-20:30           │
├──────────┼──────────────────────────────────────────────────────────────┤
│ Table 3  │ ██ WALK-IN (6) ██████████████████████████████████            │
│ (4-6)    │ 17:00-19:00  Seated → Mains                                │
├──────────┼──────────────────────────────────────────────────────────────┤
│ Booth A  │                    │ ██ O'Brien (8) 🥜🎂 ████████████████████│
│ (6-10)   │    [AVAILABLE]     │ 18:00-20:30  Confirmed  [T3+T4]       │
├──────────┼──────────────────────────────────────────────────────────────┤
│          │                                                              │
│ UNASSIGNED│ ▪ Kumar (2) 19:30  ▪ Patel (4) 20:00                       │
│          │                                                              │
└──────────┴──────────────────────────────────────────────────────────────┘
```

### 5.2 Core Interactions

**Viewing a booking:** Tap/click a booking block to open a detail popover showing: guest name, phone, email, party size, time, duration, status, deposit info, dietary notes, occasion, special requests, visit count, and table assignment. The popover includes quick-action buttons for status changes.

**Dragging a booking to a different table:** Drag the booking block vertically to another table row. During drag, valid targets highlight green, invalid targets (capacity mismatch, time overlap) highlight red. On drop, the system validates the move, updates `booking_table_assignments`, and logs a `booking.table_reassigned` event. Include an **undo toast** that appears for 5 seconds: "Moved Smith (4) to Table 3. [Undo]".

**Dragging a booking to a different time:** Drag the booking block horizontally to shift the start time. The block snaps to the nearest slot interval. On drop, the system re-validates availability (both covers and table) for the new time, updates the booking, recalculates `estimated_end_time`, and logs a `booking.modified` event. Show undo toast.

**Dragging from the unassigned sidebar:** Drag an unassigned booking from the sidebar onto a table row at a specific time position. Same validation and logging as above.

**Resizing a booking:** Drag the right edge of a booking block to extend or shorten the duration. Useful for when a venue knows a table will take longer (large party, special event). Updates `estimated_end_time`. Log a `booking.duration_adjusted` event.

**Right-click / long-press context menu:** On a booking block: View details, Change status (submenu), Reassign table, Edit booking, Cancel booking, Mark as no-show (if past booking time + grace period). On an empty cell: Create new booking at this table and time, Block this table for this time.

**Double-tap empty cell:** Quick-create a walk-in at this table and time. Minimal form: party size (pre-filled from table default), optional guest name. Status immediately set to "Seated".

### 5.3 Booking Block Design

Each booking block is a horizontal bar whose width represents the booking duration (start time to estimated end time). The block contains:

- **Guest name** (truncated if necessary) and **party size** in a circle badge
- **Status colour** as the block background:
  - Pending (awaiting deposit): Amber/yellow with diagonal stripe pattern
  - Confirmed: Blue (#3B82F6)
  - Seated: Green (#22C55E)
  - Starters: Light green (#86EFAC)
  - Mains: Darker green (#16A34A)
  - Dessert: Teal (#14B8A6)
  - Bill/Paid: Purple (#8B5CF6)
  - Bussing: Grey (#9CA3AF)
  - No-show: Red (#EF4444)
  - Cancelled: Light grey with strikethrough, semi-transparent
- **Icons** overlaid on the block:
  - 🎂 Birthday/anniversary (from occasion field)
  - 🌱 Vegetarian/vegan (parsed from dietary_notes)
  - 🥜 Allergy (parsed from dietary_notes)
  - ♿ Wheelchair (from special_requests)
  - ⭐ VIP / repeat guest (visit_count >= 3)
  - 💳 Deposit paid indicator
- **Combination indicator** - If the booking spans multiple tables, show a subtle bracket/connector spanning the rows

### 5.4 Table Column (Y-Axis)

Each table row header shows:
- **Table name** (e.g. "Table 1", "Booth A")
- **Capacity** in small text (e.g. "2-4" meaning min 2, max 4 covers)
- **Zone badge** if zones are configured (e.g. "Terrace" in a small coloured pill)
- **Current status dot** - colour matches the current table_status

Tables are grouped by zone (if configured) with collapsible zone headers. Within each zone, tables are ordered by `sort_order`. An "Unassigned" section always appears at the bottom when there are unassigned bookings.

### 5.5 Time Header (X-Axis)

- Shows time slots at the venue's configured `slot_interval_minutes` (15 or 30 min).
- Current time is indicated by a red vertical line that moves in real-time.
- Hours are highlighted with slightly heavier grid lines.
- Past time slots are subtly greyed out.
- The header scrolls horizontally with the grid body, with the table column fixed.

### 5.6 Visual Gap Highlighting

Empty gaps between bookings where a walk-in could be accommodated should be subtly highlighted. An optional toggle "Show gaps" overlays light green shading on any empty cell span that is >= the venue's minimum booking duration. This helps hosts instantly identify where walk-ins can be seated.

### 5.7 Summary Bar

Above the grid, a persistent summary bar shows:
- **Total covers**: X booked / Y capacity (with percentage)
- **Tables in use**: X / Y total
- **Unassigned bookings**: X (with alert colour if > 0)
- **Walk-ins today**: X
- **Current status breakdown**: X Confirmed, X Seated, X Completed, X No-show

### 5.8 Filters and Controls

- **Date picker**: Navigate between dates
- **Service selector**: Filter to a specific service (Lunch, Dinner) or show all
- **Zone filter**: Show only tables in a specific zone
- **Status filter**: Highlight or filter bookings by status
- **Search**: Type a guest name to highlight their booking in the grid
- **Zoom**: Pinch-to-zoom on tablet, or zoom control buttons, to adjust the time granularity (wider or narrower columns)

---

## 6. Floor Plan View - Specification

### 6.1 Floor Plan Editor (Settings)

Located at `/dashboard/settings/floor-plan`. This is where the venue owner sets up their restaurant layout.

**Canvas:** A large rectangular area representing the restaurant floor. Optional background image upload (a photo or architectural plan) that sits behind the table shapes at reduced opacity.

**Adding tables:** Click "Add Table" to place a new table on the canvas. Choose shape (rectangle, circle, square), set name, min/max covers, and zone. The table appears on the canvas and can be dragged to position. Tables snap to an invisible grid (configurable granularity) for neat alignment.

**Editing tables:** Click a table on the canvas to select it. Show resize handles on corners/edges. A properties panel on the side shows all editable fields (name, covers, zone, shape). Delete button with confirmation.

**Zones:** Define named zones (Main Dining, Terrace, Bar, Private) with optional colour coding. Zones can be drawn as background areas on the canvas, or tables can simply be tagged with a zone name.

**Table combinations:** Select multiple tables (shift-click or lasso select), then click "Create Combination". Name the combination and set combined capacity. A visual connector line links the tables.

**Import from grid:** If a venue has already added tables via the simpler table list in settings, those tables should appear on the canvas at default positions ready to be arranged.

### 6.2 Live Floor Plan (During Service)

Located at `/dashboard/floor-plan`. Shows the floor plan with real-time table statuses during service.

Each table shape on the plan shows:
- **Table name** and current **party size** (if occupied)
- **Background colour** matching the table status (same colour scheme as grid blocks)
- **Guest name** (truncated) when occupied
- **Time remaining** indicator: a subtle progress ring or bar around the table shape showing how much of the estimated duration has elapsed. Full ring = just seated, empty ring = time to turn.
- **Dietary/occasion icons** if relevant

**Interactions:**
- Tap a table to see full booking details and status action buttons.
- Tap an available table to seat a walk-in or assign an unassigned booking (shows list of unassigned bookings that fit this table).
- Long-press to access the status progression menu (one-tap status advances).
- Tables pulse or glow briefly when a status change occurs (e.g. new booking assigned).

### 6.3 Table Status Progression

Statuses follow a natural service flow. Staff can advance forward (most common) or jump to any status:

```
Available → Reserved → Seated → Starters → Mains → Dessert → Bill → Paid → Bussing → Available
```

**One-tap advance:** The most common action is advancing to the next status. The primary action button on a table should always be "Next status" (e.g. if currently "Seated", the primary button is "Starters"). One tap, done.

**Skip statuses:** Not every restaurant uses all statuses. A venue setting allows choosing which statuses are active. At minimum: Available, Seated, Paid, Available. Additional statuses are opt-in.

**Auto-status on check-in:** When a booking is checked in via the grid or day sheet (status → Seated), the table status automatically updates to "Seated". When a booking is marked as completed, the table status moves to "Bussing" then auto-reverts to "Available" after a configurable bussing time (default: 10 minutes, or immediately if disabled).

---

## 7. Floor Plan Editor - Detailed Specification

### 7.1 Technology Choice

Use a canvas-based approach for the floor plan editor and live view. Recommended library: **React Konva** (react-konva), which provides a React-friendly wrapper around the HTML5 Canvas API. It handles shapes, drag-and-drop, zoom/pan, and performs well on tablets. Alternative: pure SVG with React, which is simpler but may struggle with many tables.

### 7.2 Table Shapes

Each table is a Konva Group containing:
- A shape (Rect, Circle, or RegularPolygon for square) with rounded corners
- A text label (table name) centred
- A capacity label in smaller text below
- Status-coloured fill

Default sizes (in canvas units, scalable):
- 2-top: Small circle (diameter ~60px at default zoom) or small square
- 4-top: Medium rectangle (80×60px) or medium circle
- 6-top: Large rectangle (100×70px) or large circle
- 8-top+: Extra large rectangle (120×80px)
- Booth: Rounded rectangle with one flat edge

### 7.3 Snap-to-Grid and Alignment

- Invisible grid with configurable size (default: 10px)
- Tables snap to nearest grid point when dragged
- Alignment guides appear when a table's edge aligns with another table's edge (like Figma/Sketch)
- Rotation snaps to 0°, 45°, 90° increments (hold Shift for free rotation)

### 7.4 Saving and Loading

The floor plan layout (positions, sizes, rotations) is stored on the `venue_tables` rows themselves (`position_x`, `position_y`, `width`, `height`, `rotation`). All values are stored as percentages (0-100) of the canvas dimensions so the layout scales to different screen sizes.

Save is automatic (debounced 1 second after last change) with a "Saved" indicator. Load retrieves all `venue_tables` for the venue and renders them at their stored positions.

---

## 8. Server Sections (Optional Feature)

### 8.1 Data Model Addition

```sql
ALTER TABLE venue_tables ADD COLUMN server_section TEXT;
-- e.g. 'Section A', 'Section B', 'Bar'
-- Nullable - not all venues will use this
```

### 8.2 Functionality

- In the floor plan editor, assign tables to server sections
- In the timeline grid, optionally group/colour tables by server section
- Staff assignment: a simple dropdown per section per service (e.g. "Section A: Sarah, Section B: James")
- Visual indicator on the grid/floor plan showing which server owns each table
- Rotation tracking: the system suggests rotating section assignments to balance workload (Phase 2 enhancement)

---

## 9. Cursor Agent Implementation Prompts

### Prompt 16: Database Schema - Tables, Combinations, and Assignments

> **Cursor Prompt:**
>
> "Create Supabase migrations for the ReserveNI table management feature. This is an OPTIONAL feature that venues can toggle on or off - when off, the existing covers-based availability system works unchanged.
>
> Add to the existing `venues` table: `table_management_enabled` (boolean, default false), `floor_plan_background_url` (text, nullable).
>
> Create these new tables:
>
> (1) `venue_tables` - `id` (uuid PK, default gen_random_uuid()), `venue_id` (FK venues, ON DELETE CASCADE), `name` (text, not null), `min_covers` (int, default 1), `max_covers` (int, default 2), `shape` (text, default 'rectangle' - values: 'rectangle', 'circle', 'square'), `zone` (text, nullable), `position_x` (numeric, nullable - percentage 0-100 for floor plan), `position_y` (numeric, nullable), `width` (numeric, default 10), `height` (numeric, default 8), `rotation` (numeric, default 0), `sort_order` (int, default 0), `server_section` (text, nullable), `is_active` (boolean, default true), `created_at` (timestamptz), `updated_at` (timestamptz). Add UNIQUE constraint on (venue_id, name).
>
> (2) `table_combinations` - `id` (uuid PK), `venue_id` (FK venues, CASCADE), `name` (text, not null), `combined_min_covers` (int, not null), `combined_max_covers` (int, not null), `is_active` (boolean, default true), `created_at` (timestamptz).
>
> (3) `table_combination_members` - `id` (uuid PK), `combination_id` (FK table_combinations, CASCADE), `table_id` (FK venue_tables, CASCADE). UNIQUE on (combination_id, table_id).
>
> (4) `booking_table_assignments` - `id` (uuid PK), `booking_id` (FK bookings, CASCADE), `table_id` (FK venue_tables, CASCADE), `assigned_at` (timestamptz, default now()), `assigned_by` (uuid, FK staff, nullable). UNIQUE on (booking_id, table_id). A booking on a combination has multiple rows.
>
> (5) `table_statuses` - `id` (uuid PK), `table_id` (FK venue_tables, CASCADE), `booking_id` (FK bookings, nullable), `status` (text, default 'available' - values: 'available', 'reserved', 'seated', 'starters', 'mains', 'dessert', 'bill', 'paid', 'bussing'), `updated_at` (timestamptz, default now()), `updated_by` (uuid, FK staff, nullable). UNIQUE on (table_id) - one status per table.
>
> Add RLS policies on ALL new tables: SELECT for staff whose venue_id matches via the staff table; ALL operations for admin staff only. For `booking_table_assignments`, chain through bookings.venue_id.
>
> Add indexes: venue_tables(venue_id) WHERE is_active, booking_table_assignments(booking_id), booking_table_assignments(table_id), table_statuses(table_id), table_combinations(venue_id) WHERE is_active.
>
> Seed initial `table_statuses` rows: create a database trigger that auto-inserts a table_statuses row with status 'available' whenever a new venue_table is created. Also create a trigger that logs to the events table whenever a booking_table_assignment is created, updated, or deleted.
>
> Enable Supabase Realtime on `table_statuses` and `booking_table_assignments` for live updates."

### Prompt 17: Table Availability Engine

> **Cursor Prompt:**
>
> "Create the table-aware availability layer for ReserveNI at `lib/table-availability.ts`. This integrates with the existing availability engine - it does NOT replace it. The existing covers-based check always runs first. This table check is a second gate that only runs when `venue.table_management_enabled` is true.
>
> Export a function `getAvailableTablesForBooking(venueId, date, startTime, durationMinutes, bufferMinutes, partySize)` that returns `{ available: boolean, suggestedTable, suggestedCombination, allOptions }`.
>
> **Algorithm:**
> (1) Fetch all active `venue_tables` for the venue where `max_covers >= partySize` and `min_covers <= partySize`.
> (2) Fetch all `booking_table_assignments` for this venue on this date, joined with bookings to get start time and estimated_end_time.
> (3) For each candidate table, check if the time window `[startTime, startTime + durationMinutes + bufferMinutes]` overlaps with any existing assigned booking's time window on that table. A table is available if no overlaps exist. Use proper interval overlap logic: two intervals overlap if `start1 < end2 AND start2 < end1`.
> (4) If no single table fits, check `table_combinations` where `combined_max_covers >= partySize` and `combined_min_covers <= partySize`. A combination is available if ALL its member tables are individually available for the full window.
> (5) Sort results by best fit: prefer single tables over combinations, prefer smallest adequate table (don't put a 2 on a 6-top if a 2-top is free), use sort_order as tiebreaker.
> (6) Return the best suggestion and all options.
>
> Also export `getTableAvailabilityGrid(venueId, date, serviceId)` - returns a full grid of table × timeslot availability for the timeline view. For each table and each timeslot, return: { tableId, time, isAvailable, bookingId (if occupied), bookingDetails (guest name, party size, status, duration) }. This powers the entire grid UI and must be optimised for performance - batch all DB queries, don't query per-cell. Target: under 200ms for a venue with 30 tables and a full evening service.
>
> Modify the existing booking creation flow: after the covers-based availability check passes, if `table_management_enabled`, run the table availability check. If a suitable table is found, auto-assign it (insert into `booking_table_assignments`). If no table fits but covers allow it, create the booking as unassigned and log a `booking.table_unassigned` event. Always log `booking.table_assigned` when a table is assigned.
>
> Add an API endpoint `GET /api/venue/tables/availability?date=YYYY-MM-DD&service_id=X` that returns the full grid data for the timeline view. Authenticated venue staff only.
>
> Write unit tests covering: single table match, combination match, overlap detection, best-fit sorting, no table available but covers OK (unassigned), venue with table management disabled (skip table check entirely)."

### Prompt 18: Table Management Settings & Floor Plan Editor

> **Cursor Prompt:**
>
> "Build the table management settings and floor plan editor for ReserveNI.
>
> **Settings page at `/dashboard/settings/tables`:**
>
> At the top, a prominent toggle: 'Table Management' with an on/off switch. When off, show an explanation: 'Your venue uses simple cover-based availability. Enable table management to define individual tables, see a visual timeline grid, and assign bookings to specific tables.' When toggling ON for the first time, show a brief setup wizard (described below). When toggling OFF, show a confirmation: 'Existing table assignments will be preserved but hidden. You can re-enable at any time.'
>
> Below the toggle (visible only when enabled):
>
> **Table List** - A sortable, editable list of all venue tables. Each row: name (editable inline), shape (dropdown: rectangle/circle/square), min covers (number input), max covers (number input), zone (editable text or dropdown of existing zones), server section (text), active toggle, drag handle for reordering. 'Add Table' button at the bottom. 'Add Multiple' button that creates a batch (e.g. 'Create 10 tables named Table 1 through Table 10, all 4-tops'). Delete button with confirmation on each row.
>
> **Zones** - A simple section to define zone names and colours. Zones are just text labels - they don't need complex configuration. Pre-suggest common zones: 'Main Dining', 'Terrace', 'Bar Area', 'Private Dining'.
>
> **Combinations** - Show existing table combinations. Each shows the component tables, combined capacity, and a delete button. 'Create Combination' button opens a modal: multi-select tables from a list, auto-calculate combined capacity (sum of individual max_covers), allow override of combined min/max, name the combination (auto-suggest from table names, e.g. 'Tables 1 + 2').
>
> **Table Status Settings** - Checkboxes for which statuses this venue uses. Minimum: Available, Seated, Paid. Optional: Reserved, Starters, Mains, Dessert, Bill, Bussing. Default: all enabled. Also: 'Auto-bussing time' - number input for minutes after 'Paid' status before table auto-reverts to 'Available' (default: 10 minutes, 0 = immediate).
>
> **Floor Plan Editor** at `/dashboard/settings/floor-plan` (linked from table settings):
>
> Use a canvas-based approach with `react-konva`. The canvas fills the available screen area. Show all active venue tables as shapes on the canvas at their stored positions. If tables have no positions yet (newly created), arrange them in a grid automatically.
>
> Each table shape on the canvas shows: table name, capacity (e.g. '2-4'), and is coloured by zone.
>
> **Interactions:** Drag tables to reposition (snap to invisible grid, default 10px). Click to select (show resize handles and a properties panel). Multi-select with Shift+click or lasso drag. Selected tables can be grouped into a combination. Resize by dragging corner handles. Right-click or long-press for context menu: edit, delete, duplicate, set zone.
>
> **Background image:** An 'Upload Background' button lets the venue upload a floor plan image (photo or architectural drawing). It renders behind the tables at reduced opacity (30%). Stored as `floor_plan_background_url` on the venue via Supabase Storage.
>
> **Auto-save:** Debounce 1 second after any change. Show a 'Saved' / 'Saving...' indicator. All position/size data saved to venue_tables rows as percentages (0-100) of canvas dimensions for responsive scaling.
>
> **First-time setup wizard** (shown when table management is toggled on and no tables exist):
> Step 1: 'How many tables do you have?' - number input with quick presets (10, 15, 20, 25, 30).
> Step 2: 'What are your typical table sizes?' - select from presets: 'Mostly 2-tops and 4-tops', 'Mix of 2, 4, and 6-tops', 'Varied sizes', 'Custom'. Auto-generates tables based on selection.
> Step 3: 'Do you have separate dining areas?' - toggle to define zones. If yes, name them and assign tables.
> Step 4: 'Arrange your floor plan' - opens the floor plan editor with the generated tables ready to position.
> A 'Skip floor plan for now' option lets venues use the timeline grid without positioning tables (they appear in a list order)."

### Prompt 19: Timeline Grid View

> **Cursor Prompt:**
>
> "Build the timeline grid view for ReserveNI at `/dashboard/table-grid`. This is the world-class table management grid - it must be visually impressive, incredibly responsive, and intuitive for restaurant hosts using a tablet during busy service.
>
> **Only show this page in the dashboard navigation when `venue.table_management_enabled` is true.** When false, hide it completely.
>
> **Layout:** A fixed table column on the left (Y-axis) with scrollable time columns (X-axis). Tables are grouped by zone (collapsible zone headers) and ordered by sort_order within each zone. Time columns are generated from the selected service's start_time to end_time at the configured slot_interval_minutes. An 'Unassigned' section at the bottom shows any bookings without table assignments as compact cards.
>
> **Data loading:** On mount and on date/service change, call `GET /api/venue/tables/availability` to get the full grid data. Subscribe to Supabase Realtime on `bookings`, `booking_table_assignments`, and `table_statuses` tables for live updates - when a change arrives, update the relevant cells without reloading the full grid.
>
> **Booking blocks:** Each booking renders as a horizontal bar spanning from its start time to estimated_end_time. Bar colour indicates status: Pending = amber with stripe pattern, Confirmed = #3B82F6 (blue), Seated = #22C55E (green), Starters = #86EFAC, Mains = #16A34A, Dessert = #14B8A6, Bill/Paid = #8B5CF6 (purple), Bussing = #9CA3AF (grey), No-show = #EF4444 (red), Cancelled = light grey with 50% opacity. Each block shows: guest name (truncated), party size in a circle badge, and small icons for occasions/dietary/VIP. On hover (desktop) or tap (tablet), show a popover with full booking details and action buttons.
>
> **Drag and drop** using `@dnd-kit/core` and `@dnd-kit/sortable`:
> (1) Drag a booking block to a different table row (vertical move): validate that the target table has sufficient capacity (`max_covers >= party_size`) and no time overlap with existing bookings on that table. During drag, highlight valid rows green and invalid rows red. On successful drop, update `booking_table_assignments`, log a `booking.table_reassigned` event, and show an undo toast ('Moved [Name] to [Table]. Undo') that persists for 5 seconds.
> (2) Drag a booking block to a different time (horizontal move): snap to nearest slot interval. Validate covers-based and table-based availability at the new time. On drop, update the booking's time and recalculate estimated_end_time. Log `booking.modified` event. Show undo toast.
> (3) Drag from unassigned sidebar onto a table row at a specific time position: assign the table and optionally update the time. Same validation and logging.
> (4) Resize a booking block by dragging its right edge: adjust estimated_end_time. Validate no overlap with the next booking on that table. Log `booking.duration_adjusted` event. Show undo toast.
>
> **The undo system:** Maintain an undo stack of the last 10 actions. Each undo reverts the database changes (restore previous assignment, time, or duration). Show 'Undo' button in the toast AND a persistent 'Undo' button in the toolbar. Keyboard shortcut: Ctrl+Z / Cmd+Z.
>
> **Current time indicator:** A red vertical line at the current time position, updating every minute. Time slots to the left of the current time have a subtle grey overlay.
>
> **Gap highlighting:** An optional toggle 'Show available gaps' in the toolbar. When active, empty cell spans where a booking could fit (>= minimum duration for the venue) are subtly highlighted in light green. This helps hosts instantly spot where walk-ins can be seated.
>
> **Summary bar** above the grid: Total covers (booked/capacity with percentage bar), Tables in use (X/Y), Unassigned bookings (count, amber if > 0), and a real-time status breakdown (X confirmed, X seated, X completed, X no-shows).
>
> **Controls:** Date picker (left/right arrows + calendar popup), service selector dropdown, zone filter (checkboxes), status filter, guest name search (highlights matching blocks with a glow effect), zoom level (buttons or pinch-to-zoom on tablet, controlling column width).
>
> **Quick actions:** A floating '+ Walk-in' button (bottom right, mobile-style FAB) that opens a minimal form: select a table from available tables, party size, optional name. Creates booking with status 'Seated' and assigns to the selected table immediately.
>
> **Context menu** (right-click on desktop, long-press on tablet): On a booking block: View details, Change status (submenu with all active statuses), Reassign table, Edit booking, Cancel booking, Mark no-show. On an empty cell: New booking here, Block this table/time. On a table header: Edit table, Deactivate table.
>
> **Performance requirements:** The grid must render smoothly with 30+ tables and 100+ bookings visible. Use React virtualisation if needed for many tables. Memoize booking block components. Batch Supabase Realtime updates to avoid excessive re-renders. Target: initial load < 500ms, drag interaction at 60fps, no perceptible lag on iPad.
>
> **Responsive design:** On desktop (>1024px): full grid with all features. On tablet (768-1024px): full grid optimised for touch - larger tap targets, touch-friendly drag handles, bottom sheet for booking details instead of popovers. On phone (<768px): redirect to the existing day sheet view with a note that 'Table grid is best used on a tablet or desktop'. The grid should NOT attempt to render on a phone screen - it would be unusable.
>
> **Empty state:** When table management is enabled but no tables are defined: 'Set up your tables to use the timeline grid.' with a button linking to `/dashboard/settings/tables`. When tables exist but no bookings for the selected date: show the empty grid with a friendly message and the '+ Walk-in' button."

### Prompt 20: Floor Plan Live View

> **Cursor Prompt:**
>
> "Build the live floor plan view for ReserveNI at `/dashboard/floor-plan`. This is a real-time visual representation of the restaurant floor during service, showing table positions with live status indicators.
>
> **Only show this page in the dashboard navigation when `venue.table_management_enabled` is true AND at least one table has position data (position_x and position_y are not null).** Otherwise hide it from the nav (venues can use the timeline grid without a floor plan).
>
> **Rendering:** Use `react-konva` to render the floor plan canvas. Load the background image (if set) at 30% opacity. Render each active venue_table as its configured shape (rectangle, circle, square) at its stored position, scaled to the current canvas dimensions. Shapes have rounded corners for a polished look.
>
> **Table appearance by status:**
> Each table shape shows:
> - Background fill colour matching status (same colour scheme as the timeline grid blocks)
> - Table name (always visible, centered, bold)
> - When occupied: guest name (below table name, smaller text, truncated), party size badge (top-right corner, circle with number), and a progress ring around the table shape showing time elapsed vs estimated duration (thin arc, colour matches status, fills clockwise from 12 o'clock)
> - When available: show table capacity (e.g. '2-4') in lighter text
> - Dietary/occasion icons as small badges along the bottom edge of the table shape
> - VIP indicator: subtle gold border for guests with visit_count >= 3
>
> **Status colour map (same as grid):**
> Available: white with light border (#E5E7EB)
> Reserved: light blue (#DBEAFE)
> Seated: green (#22C55E)
> Starters: light green (#86EFAC)
> Mains: darker green (#16A34A)
> Dessert: teal (#14B8A6)
> Bill: purple (#8B5CF6)
> Paid: light purple (#DDD6FE)
> Bussing: grey (#9CA3AF)
>
> **Interactions:**
> - Tap an occupied table: show a detail card (overlay or side panel) with full booking details and quick action buttons: 'Next Status' (advance to next in sequence - this is the primary large button), status jump buttons (for skipping statuses), 'View Guest', 'Move to Another Table'. The 'Next Status' button should be colour-coded for the NEXT status, with clear text: e.g. if currently Seated, the button says '→ Starters' in the starters colour.
> - Tap an available table: show options: 'Seat Walk-in' (quick form: party size, optional name), 'Assign Booking' (shows a list of today's unassigned bookings that fit this table's capacity, sorted by time), 'Block Table' (mark unavailable with a reason).
> - Pinch-to-zoom on tablet for zooming in on specific areas.
> - Pan by dragging the background (not tables - tables are not draggable in live view, only in the editor).
>
> **Animation:** When a table status changes (either from a user action or from a Realtime update), the table shape briefly pulses/scales up and back (a subtle bounce animation, ~300ms). This draws attention to changes without being distracting.
>
> **Auto-bussing:** When a table status is set to 'Paid', start a countdown timer (using the venue's configured auto_bussing_minutes). Show the countdown on the table. When it reaches zero, automatically set status to 'Available' and clear the booking association. If auto_bussing_minutes is 0, transition immediately.
>
> **Real-time updates:** Subscribe to Supabase Realtime on `table_statuses`, `booking_table_assignments`, and `bookings` for this venue. When a change arrives, update the affected table's appearance with the pulse animation. Also listen for new bookings (to update assigned tables) and cancellations (to free tables).
>
> **Summary overlay:** A semi-transparent bar at the top or bottom of the canvas showing: time now, total covers seated / total covers booked / total capacity, and count of available tables. This stays visible while scrolling/zooming the plan.
>
> **Connection status:** Show a green/amber/red dot in the corner. Green = Realtime connected. Amber = reconnecting (poll every 30 seconds as fallback). Red = offline (show 'Data may be stale' warning). Same pattern as the existing day sheet.
>
> **Performance:** Limit canvas re-renders to only the tables that changed. Use Konva's `batchDraw()` for efficient rendering. Target: status update reflected in < 100ms after Realtime event received."

### Prompt 21: Integration, Polish & Testing

> **Cursor Prompt:**
>
> "Complete the table management feature by integrating all pieces, adding polish, and ensuring everything works together seamlessly.
>
> **Dashboard navigation update:** Add the following nav items, only visible when `table_management_enabled` is true: 'Table Grid' (links to `/dashboard/table-grid`, icon: grid), 'Floor Plan' (links to `/dashboard/floor-plan`, icon: layout, only if tables have position data). Keep the existing 'Day Sheet' and 'Bookings' nav items always visible regardless of table management status. Add 'Tables' as a sub-item under Settings.
>
> **Booking detail integration:** Update the existing booking detail view (in the reservations dashboard) to show table assignment when table management is enabled. Show: assigned table name(s), zone, and a 'Reassign Table' button that opens a dropdown of available tables for this booking's time window. If unassigned, show 'No table assigned' with an 'Assign Table' button.
>
> **Day sheet integration:** When table management is enabled, add a 'Table' column to the day sheet showing the assigned table name for each booking. Unassigned bookings show '-' with an amber background. Add a count of unassigned bookings to the day sheet summary bar.
>
> **Booking confirmation update:** When table management is enabled and a table is auto-assigned, optionally include the table name in the confirmation email and on the confirmation screen: 'You've been assigned to [Table Name]'. Add a venue setting `show_table_in_confirmation` (boolean, default false) - many venues prefer NOT to tell guests their table number as it reduces flexibility.
>
> **Event logging:** Ensure all table-related actions log to the events table: `booking.table_assigned` (payload: table_id, table_name, auto: true/false), `booking.table_reassigned` (payload: from_table_id, to_table_id, reassigned_by), `booking.table_unassigned` (payload: table_id, reason), `table.status_changed` (payload: table_id, from_status, to_status, changed_by, booking_id).
>
> **Reports integration:** Add a new section to the reporting page (only when table management enabled): 'Table Utilisation' - for a date range, show each table's utilisation percentage (hours occupied / hours available in service). Show as a simple bar chart. Highlight underperforming tables (< 50% utilisation) and overperforming tables (> 90%). This helps venues understand which tables are their workhorses and which might be poorly positioned.
>
> **Covers-based fallback:** Verify thoroughly that when `table_management_enabled` is toggled OFF: the Table Grid and Floor Plan nav items disappear, the booking flow skips the table availability check entirely, existing table assignments are preserved in the database but hidden from all views, the day sheet hides the table column, reports hide the table utilisation section. When toggled back ON: everything reappears with existing data intact.
>
> **End-to-end test scenarios** to verify manually:
> 1. New venue enables table management → setup wizard → creates 15 tables → arranges floor plan → toggle works.
> 2. Online booking arrives → auto-assigned to best-fit table → appears on grid and floor plan.
> 3. Phone booking with deposit → pending on grid in amber → deposit paid → confirmed on grid in blue.
> 4. Host drags booking from Table 2 to Table 5 on grid → assignment updates → floor plan reflects change → undo works.
> 5. Host drags booking to a different time → booking time updates → confirmation email would include new time → undo works.
> 6. Walk-in via grid FAB → assigned to tapped table → immediately shows as Seated.
> 7. Walk-in via floor plan → tap available table → quick seat → appears on grid too.
> 8. Status progression on floor plan: tap table → Next Status → advances through Seated → Starters → Mains → Dessert → Bill → Paid → auto-bussing countdown → Available.
> 9. Table combination: party of 8 → no single table fits → auto-assigned to combination of Table 3 + Table 4 → shows spanning both rows on grid → shows linked on floor plan.
> 10. Capacity validation: try to drag a party of 6 onto a 2-top → red highlight → drop rejected → helpful error message.
> 11. Time overlap validation: try to drag a booking onto a table already occupied at that time → rejected.
> 12. No-show on grid: mark no-show → booking block turns red → table freed → shows as available.
> 13. Table management disabled → all table UI hidden → booking flow works purely on covers → re-enable → everything returns.
> 14. Simultaneous updates: two staff members viewing the grid on different tablets → one makes a change → other sees it in real-time via Realtime subscription.
> 15. Performance: 30 tables, 80 bookings for an evening → grid loads in < 500ms → drag at 60fps → no lag on iPad."

---

## 10. Implementation Sequence & Dependencies

Execute the prompts in order. Each builds on the previous:

| Prompt | Description | Layer | Effort | Depends On |
|---|---|---|---|---|
| 16 | Database schema for tables & assignments | Backend | Medium | Existing availability engine prompts (8-15) |
| 17 | Table availability engine | Backend | High | Prompt 16 |
| 18 | Table settings & floor plan editor | Frontend + Backend | High | Prompt 16 |
| 19 | Timeline grid view | Frontend | Very High | Prompts 16, 17 |
| 20 | Floor plan live view | Frontend | High | Prompts 16, 17, 18 |
| 21 | Integration, polish & testing | Full Stack | Medium | Prompts 16-20 |

**Parallel work:** Prompts 18 and 19 can be started in parallel after Prompt 17 is complete, as they share the same data layer but operate on different pages. Prompt 20 depends on 18 (floor plan editor must exist first) but can be developed alongside 19.

**Critical path:** 16 → 17 → 19 → 21 (the grid is the centrepiece feature and must be rock solid).

---

## 11. Technology Dependencies

Install the following packages before starting:

```bash
npm install react-konva konva                    # Floor plan canvas rendering
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities  # Drag and drop for grid
npm install date-fns                             # Time manipulation (if not already installed)
```

These are all well-maintained, widely-used libraries with strong React integration:
- **react-konva** (v18+): React wrapper for Konva.js canvas library. Handles shapes, images, drag, zoom/pan. Performant for 50+ shapes on canvas.
- **@dnd-kit**: Modern drag-and-drop library for React. Supports keyboard, pointer, and touch. Better accessibility than react-dnd. Supports collision detection and droppable constraints.

---

## 12. Performance Targets

| Metric | Target | Method |
|---|---|---|
| Grid initial load | < 500ms | Batch all DB queries into 2-3 calls, not per-cell |
| Grid re-render on update | < 50ms | Memoize booking blocks, update only changed cells |
| Drag interaction | 60fps | Use CSS transforms during drag, not state updates |
| Floor plan render | < 300ms | Konva batchDraw, limit to visible tables |
| Table availability check | < 100ms | Single query with joins, not per-table queries |
| Realtime event to UI update | < 200ms | Direct state mutation from subscription callback |

---

## 13. How This Positions ReserveNI Competitively

With this table management implementation, ReserveNI offers a feature set that matches or exceeds what independent restaurants get from significantly more expensive platforms:

**vs. OpenTable** ($149-499/month + per-cover fees): ReserveNI's timeline grid with drag-and-drop and floor plan view matches OpenTable's core table management. OpenTable's advantages are POS integration for auto-statusing and the diner network - neither of which are relevant to ReserveNI's target market of independent NI restaurants at £79/month flat fee.

**vs. ResDiary** ($99-289/month): ReserveNI matches ResDiary's yield management (from the availability engine) AND adds a more modern, visually appealing timeline grid. ResDiary's interface has been criticised in reviews for poor ease of use. ReserveNI's clean, mobile-first design is a genuine differentiator.

**vs. SevenRooms** (~$700+/month): SevenRooms' AI auto-seating is more sophisticated, but their price point is 10x ReserveNI's. For independent NI restaurants, ReserveNI's auto-suggestion with manual override is more than sufficient.

**vs. Tablein / Table Agent** (budget tools): ReserveNI significantly exceeds these simpler platforms, which lack timeline grids, drag-and-drop, and floor plans entirely.

**The unique ReserveNI advantage:** The toggle between simple covers-based mode and full table management means ReserveNI serves BOTH ends of the market - the small bistro that just wants easy booking and deposits, AND the larger restaurant that wants granular table control. No competitor offers this flexibility at this price point with the deposit-first, no-show-reduction focus that defines ReserveNI.
