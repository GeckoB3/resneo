# ReserveNI - Automatic Table Combination Engine

**Prompt Type:** Algorithm Implementation + UI Integration  
**Scope:** Spatial adjacency detection, automatic combination suggestion, booking assignment for oversized parties  
**Prerequisite:** The Floor Plan & Table Grid Full Functionality prompt must be fully implemented and verified before running this one.

---

## Context & Objective

ReserveNI's floor plan editor stores the precise position and dimensions of every table as canvas coordinates (x, y, width, height). The booking creation flow already handles single-table assignment. The goal of this prompt is to build an **automatic table combination engine** that:

1. Detects which tables are physically adjacent based on floor plan position data - no manual combination setup required from venue staff
2. When a booking party size exceeds any single table's capacity, automatically identifies valid groups of adjacent tables that can accommodate the party
3. Scores and ranks those groups by efficiency
4. Surfaces the best suggestion to staff during booking creation, with the ability to accept, override, or manually select an alternative
5. Integrates this suggestion into the New Booking modal, the Floor Plan, and the Table Grid

This replaces the need for manually pre-configured table combinations for the majority of use cases, while retaining the ability for staff to override with their own judgement.

---

## Step 1 - Codebase Audit

Before writing any code, read and document the following:

**Floor plan data model:**
- Confirm the exact column names for table position and dimension data on the `tables` table - expected: `position_x`, `position_y`, `width`, `height`, `rotation`. Note any that are missing or named differently.
- Confirm whether rotation is stored and in what unit (degrees or radians). If rotation is not stored, note this - it affects adjacency detection for non-axis-aligned tables.
- Confirm the coordinate system used by the floor plan canvas (origin top-left assumed - verify).
- Check whether table positions are stored in canvas pixels, a normalised 0–1 scale, or real-world units. Note the unit.

**Existing combinations:**
- Locate the `table_combinations` table or equivalent. Note its schema.
- Confirm whether any manually pre-configured combinations exist in the database.
- The automatic engine will work alongside any manually configured combinations - it does not replace them. Manual combinations should still be surfaced as options, ranked alongside automatically detected ones.

**Booking creation flow:**
- Locate the New Booking modal/component built in the previous prompt.
- Confirm how table assignment is currently handled - is a single `table_id` stored on the booking record, or is there a separate `table_assignments` join table supporting multiple tables per booking?
- If only a single `table_id` is supported, a schema change will be required before the combination engine can be built. Flag this and implement the migration first (see Step 2.1).

**Availability engine:**
- Locate the availability checking logic.
- Confirm it can evaluate availability for a specific table at a specific date/time range.
- The combination engine will need to call this per-table to validate that all tables in a proposed combination are free for the required time window.

---

## Step 2 - Schema & Data Layer Preparation

### 2.1 - Multi-table Booking Support

If the current schema only supports a single `table_id` per booking, implement the following migration before proceeding:

```sql
-- Create a table_assignments join table if it does not exist
create table if not exists table_assignments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  table_id uuid not null references tables(id) on delete restrict,
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  unique(booking_id, table_id)
);

-- Index for fast lookup by booking
create index if not exists idx_table_assignments_booking_id 
  on table_assignments(booking_id);

-- Index for fast lookup by table (availability checks)
create index if not exists idx_table_assignments_table_id 
  on table_assignments(table_id);
```

If a `table_assignments` table already exists with a different schema, adapt the combination engine to match it rather than creating a new one.

After the migration:
- Update the booking creation flow to write to `table_assignments` rather than (or in addition to) `table_id` on the bookings record
- Update all queries that currently join on `bookings.table_id` to also join on `table_assignments` - confirm the Floor Plan status overlay, Table Grid rendering, and availability engine all still work correctly after this change

### 2.2 - Combination Cache Table (Optional Optimisation)

For venues with large floor plans, recalculating adjacency on every booking request may be unnecessary. Implement a lightweight cache:

```sql
create table if not exists table_adjacency_cache (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  table_id_a uuid not null references tables(id) on delete cascade,
  table_id_b uuid not null references tables(id) on delete cascade,
  gap_distance numeric not null,
  last_calculated_at timestamptz not null default now(),
  unique(table_id_a, table_id_b)
);
```

This cache is invalidated and recalculated whenever a table's position, dimensions, or active status changes in the floor plan editor. Implement the invalidation trigger as part of the Save Layout flow in the floor plan editor.

If the venue has fewer than 30 tables, this cache is optional - the adjacency calculation is fast enough to run on demand. Implement the cache only if performance testing indicates it is needed.

---

## Step 3 - The Adjacency Detection Algorithm

Implement this as a pure utility function: **`detectAdjacentTables(tables)`**

This function takes the full list of active tables for a venue (each with id, position_x, position_y, width, height, capacity, rotation) and returns a map of adjacency relationships with gap distances.

### 3.1 - Bounding Box Calculation

For each table, calculate its axis-aligned bounding box (AABB). If rotation is not used or is always 0, the bounding box is simply:

```
left   = position_x
right  = position_x + width
top    = position_y
bottom = position_y + height
```

If rotation is non-zero, calculate the rotated bounding box by transforming all four corners and taking min/max extents. Use the table centre as the rotation origin:

```javascript
function getRotatedBoundingBox(table) {
  const cx = table.position_x + table.width / 2
  const cy = table.position_y + table.height / 2
  const angle = (table.rotation || 0) * (Math.PI / 180)
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)

  const corners = [
    { x: table.position_x,               y: table.position_y },
    { x: table.position_x + table.width, y: table.position_y },
    { x: table.position_x + table.width, y: table.position_y + table.height },
    { x: table.position_x,               y: table.position_y + table.height },
  ].map(({ x, y }) => ({
    x: cx + (x - cx) * cos - (y - cy) * sin,
    y: cy + (x - cx) * sin + (y - cy) * cos,
  }))

  return {
    left:   Math.min(...corners.map(c => c.x)),
    right:  Math.max(...corners.map(c => c.x)),
    top:    Math.min(...corners.map(c => c.y)),
    bottom: Math.max(...corners.map(c => c.y)),
  }
}
```

### 3.2 - Gap Distance Calculation

For two bounding boxes A and B, the gap distance is the shortest distance between their edges - not their centres. Two tables whose edges are touching have a gap of 0. Two tables with space between them have a positive gap.

```javascript
function getBoundingBoxGap(a, b) {
  const horizontalGap = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right))
  const verticalGap   = Math.max(0, Math.max(a.top,  b.top)  - Math.min(a.bottom, b.bottom))
  return Math.sqrt(horizontalGap ** 2 + verticalGap ** 2)
}
```

### 3.3 - Adjacency Threshold

Two tables are considered **adjacent and combinable** if their gap distance is below a configurable threshold.

Set the default threshold at **80 canvas units**. This should represent approximately the width of a chair plus a small aisle - enough to capture tables that are clearly intended to be pushed together, without capturing tables across the room from each other.

Expose this threshold as a venue-level setting in the Settings page under the Table Management section:

> **Combination Distance** - How close two tables must be on the floor plan to be considered combinable. Default: 80. Increase if combinations are not being detected. Decrease if unintended combinations are suggested.

Store this as `combination_threshold` on the `venue_settings` record.

### 3.4 - Full Adjacency Detection Function

```javascript
function detectAdjacentTables(tables, threshold = 80) {
  // Returns: Map<tableId, Set<tableId>> - adjacency list
  const adjacencyMap = new Map()
  const boundingBoxes = new Map()

  for (const table of tables) {
    boundingBoxes.set(table.id, getRotatedBoundingBox(table))
    adjacencyMap.set(table.id, new Set())
  }

  for (let i = 0; i < tables.length; i++) {
    for (let j = i + 1; j < tables.length; j++) {
      const a = tables[i]
      const b = tables[j]
      const gap = getBoundingBoxGap(
        boundingBoxes.get(a.id),
        boundingBoxes.get(b.id)
      )
      if (gap <= threshold) {
        adjacencyMap.get(a.id).add(b.id)
        adjacencyMap.get(b.id).add(a.id)
      }
    }
  }

  return adjacencyMap
}
```

Write unit tests for this function covering:
- Two clearly adjacent tables (gap = 0) → detected as adjacent
- Two tables with a small gap (gap = 40) → detected as adjacent (within default threshold)
- Two tables with a large gap (gap = 200) → not detected as adjacent
- A rotated table adjacent to a non-rotated table → correctly detected
- A table adjacent to two others but those two not adjacent to each other → adjacency is not transitive unless explicitly connected

---

## Step 4 - The Combination Finder Algorithm

Implement this as a pure utility function: **`findValidCombinations(partySize, datetime, duration, tables, bookings, blocks, adjacencyMap, manualCombinations)`**

### 4.1 - Single Table Check

Before searching for combinations, always check whether any single table can accommodate the party size and is available. If one or more single tables are valid, they should be returned first in the results - combinations are only suggested when no single table suffices or as an alternative.

### 4.2 - Combination Search

For each table that is available at the requested datetime + duration:

1. Start a candidate group containing just that table
2. Find all adjacent tables (from the adjacency map) that are also available at the same datetime + duration
3. Build groups by adding adjacent available tables until the combined capacity meets or exceeds the party size
4. Stop expanding a group once it meets the party size requirement - do not over-expand

Use a **breadth-first search** starting from each seed table, building connected groups. Only include groups where all member tables are mutually reachable through the adjacency graph (i.e. the group forms a connected subgraph - no islands).

```javascript
function findConnectedGroups(seedTableId, availableTables, adjacencyMap, targetCapacity) {
  const availableSet = new Set(availableTables.map(t => t.id))
  const results = []

  function bfs(currentGroup, currentCapacity) {
    if (currentCapacity >= targetCapacity) {
      results.push([...currentGroup])
      return // Don't expand further once target is met
    }

    // Find candidates: adjacent to any table in the group, not already in the group
    const candidates = new Set()
    for (const tableId of currentGroup) {
      for (const adjacentId of adjacencyMap.get(tableId) || []) {
        if (!currentGroup.has(adjacentId) && availableSet.has(adjacentId)) {
          candidates.add(adjacentId)
        }
      }
    }

    if (candidates.size === 0) return // Dead end - group is fully expanded but under capacity

    for (const candidateId of candidates) {
      const candidateTable = availableTables.find(t => t.id === candidateId)
      const newGroup = new Set(currentGroup)
      newGroup.add(candidateId)
      bfs(newGroup, currentCapacity + candidateTable.capacity)
    }
  }

  const seedTable = availableTables.find(t => t.id === seedTableId)
  if (!seedTable) return results

  bfs(new Set([seedTableId]), seedTable.capacity)
  return results
}
```

Deduplicate results - the same group of tables may be discovered starting from different seed tables. Normalise groups by sorting table IDs before deduplication.

Cap the search at **groups of 4 tables maximum** to prevent combinatorial explosion on large floor plans. A party requiring 5 or more tables to seat should be flagged as a special event requiring manual handling.

### 4.3 - Include Manual Combinations

Any manually pre-configured combinations (from the `table_combinations` table) whose member tables are all available at the requested datetime should also be included in the results, ranked alongside the automatically detected groups.

Mark each result with its source: `"auto"` or `"manual"` - this is displayed in the UI so staff can see whether a suggestion was system-generated or pre-configured.

### 4.4 - Availability Check

For each candidate table in every group, check availability using the existing availability engine. A table is available for a combination if:

- It has no confirmed or pending bookings overlapping the requested time window
- It has no blocks overlapping the requested time window
- It is marked as active in the floor plan

Pass the `bookings` and `blocks` arrays into the function rather than making Supabase calls inside the algorithm - the calling context should fetch the data once and pass it in, keeping the function pure and testable.

---

## Step 5 - Scoring & Ranking

Implement **`scoreCombination(group, partySize, tables)`** to rank valid combinations.

Score each combination on four criteria, producing a single numeric score where lower is better:

**1. Capacity waste** (weight: 40%)  
`waste = totalGroupCapacity - partySize`  
A group with capacity 8 for a party of 6 wastes 2 covers. Minimise this.

**2. Table count** (weight: 30%)  
Fewer tables is better. A party of 6 at one 6-top is better than two 3-tops, which is better than three 2-tops.

**3. Compactness** (weight: 20%)  
The tighter the physical cluster, the better. Calculate compactness as the area of the bounding box enclosing all tables in the group - smaller bounding boxes indicate the tables are closer together spatially.

**4. Manual vs auto preference** (weight: 10%)  
Manually pre-configured combinations get a small ranking boost. If the venue manager has explicitly set up a combination, they had a reason - trust that over the algorithm's suggestion.

```javascript
function scoreCombination(group, partySize, tableData, isManual = false) {
  const tables = group.map(id => tableData.find(t => t.id === id))
  const totalCapacity = tables.reduce((sum, t) => sum + t.capacity, 0)
  const waste = totalCapacity - partySize
  const tableCount = tables.length

  const boxes = tables.map(t => getRotatedBoundingBox(t))
  const enclosingArea =
    (Math.max(...boxes.map(b => b.right))  - Math.min(...boxes.map(b => b.left))) *
    (Math.max(...boxes.map(b => b.bottom)) - Math.min(...boxes.map(b => b.top)))

  const wasteScore     = (waste / partySize) * 40
  const countScore     = (tableCount - 1) * 30
  const compactScore   = (enclosingArea / 100000) * 20  // normalise by canvas area
  const manualBonus    = isManual ? -10 : 0

  return wasteScore + countScore + compactScore + manualBonus
}
```

Sort all valid combinations by score ascending before presenting to staff.

---

## Step 6 - UI Integration

### 6.1 - New Booking Modal - Party Size Trigger

In the New Booking modal, when the party size field is updated:

1. Check whether any single active table can accommodate the party size
2. If no single table can: automatically trigger the combination search for the current date/time
3. If a table is already selected that cannot accommodate the new party size: clear the table selection and trigger the combination search
4. Show a loading indicator while the search runs (it should be near-instant but show the indicator for polish)

### 6.2 - Combination Suggestion UI

Replace the simple table selector in the New Booking modal with a **"Table Assignment"** section that handles both single tables and combinations:

**When a single table can accommodate the party:**  
Show the existing table picker. No change to current behaviour.

**When no single table can accommodate the party:**  
Show a dedicated combination suggestions panel:

```
┌─────────────────────────────────────────────────────┐
│  No single table available for a party of 7         │
│  Here are the best table combinations:              │
│                                                     │
│  ● Tables 3 + 4  -  Combined capacity 8  ✦ Best fit │
│    [Auto-detected · Adjacent · 1 cover spare]       │
│                                                     │
│  ○ Tables 5 + 6  -  Combined capacity 10            │
│    [Auto-detected · Adjacent · 3 covers spare]      │
│                                                     │
│  ○ Tables 1 + 2 + 3  -  Combined capacity 9         │
│    [Auto-detected · 2 covers spare]                 │
│                                                     │
│  ○ Choose tables manually →                         │
└─────────────────────────────────────────────────────┘
```

Each option shows:
- Table names/numbers
- Combined capacity and covers spare
- Source badge (Auto-detected / Pre-configured)
- A visual indicator on the floor plan mini-preview (if a floor plan preview panel is present in the modal) highlighting the relevant tables

The top-ranked option is pre-selected but not committed - staff must explicitly confirm or choose an alternative.

**"Choose tables manually" option:**  
Opens a multi-select table picker showing all available tables. Staff can select any combination regardless of adjacency. The system will show a warning if the selected tables are not spatially adjacent ("These tables are not close together on your floor plan - are you sure?") but does not block the selection.

### 6.3 - Floor Plan Integration

When a new booking with a combination is being created from the floor plan:

- During the "select table" step of the New Booking modal, highlight the suggested combination on the canvas
- As the staff member selects different combination options from the list, the canvas highlight updates to show the corresponding tables
- Once a combination is confirmed, all member tables show as BOOKED on the canvas for the booking's time window
- The floor plan must correctly render multi-table bookings - both Table 3 and Table 4 should show the guest name and booking time, with a visual indicator that they are part of a combined booking (e.g. a small link icon or matching colour border)

### 6.4 - Table Grid Integration

On the Table Grid, a booking assigned to multiple tables renders as a **linked block** spanning the same time window on each table's row:

- Each table row shows the booking block for the same time window
- The blocks share the same colour and guest name
- A small **link icon** on each block indicates it is part of a combination
- Hovering or clicking either block opens the same Booking Detail Panel for the booking
- The Booking Detail Panel shows all assigned tables under "Table Assignment" (e.g. "Tables 3 + 4 (Combined)")
- Dragging one block of a combined booking prompts: *"Move the entire booking (Tables 3 + 4) to a new table, or split this booking?"* - implement "move entire booking" only for now; splitting can be a future feature

### 6.5 - Booking Detail Panel Update

In the Booking Detail Panel (on both screens), update the Table Assignment field to support multiple tables:

- Show all assigned tables (e.g. "Tables 3 + 4 - Combined (capacity 8)")
- "Change Table Assignment" opens the combination suggestion UI for the booking's party size and time window - treating this as a reassignment with the same validation and confirmation flow as single-table reassignment
- Show whether the combination was auto-detected or manually selected

---

## Step 7 - Settings Page Integration

In the Settings page, under the Table Management section (added in the previous prompt), add:

**Combination Distance Threshold**  
A numeric input field labelled "Combination detection distance". Helper text: "How close two tables need to be on your floor plan to be suggested as a combination. Measured in floor plan units. Default is 80."  
Min: 20. Max: 300. Default: 80.  
On change: save to `venue_settings.combination_threshold`, and invalidate the adjacency cache (recalculate on next booking that triggers combination search).

**Recalculate Combinations button**  
A secondary button: "Recalculate table adjacency". Triggers an immediate recalculation of the adjacency cache for the venue. Shows a spinner while running, then "Done - [N] adjacent table pairs detected." Useful after a major floor plan rearrangement.

---

## Step 8 - Validation & Testing

### Algorithm Unit Tests

Write isolated unit tests for each pure function before integrating into the UI:

- `getRotatedBoundingBox()` - test with rotation 0, 45, 90 degrees
- `getBoundingBoxGap()` - test touching tables (gap 0), close tables, far tables
- `detectAdjacentTables()` - test various floor plan configurations
- `findConnectedGroups()` - test with simple 2-table pair, L-shaped 3-table group, disconnected tables
- `scoreCombination()` - verify lower scores are better, manual combinations rank ahead of equivalent auto combinations

### Integration Checklist

- [ ] Party size of 2 with a 2-top available → single table suggested, no combination panel shown
- [ ] Party size of 5 with no 5-top, but two adjacent 3-tops available → combination suggested automatically
- [ ] Party size of 5 with no adjacent tables available → "No tables available" shown, not a crash
- [ ] Party size of 5 with manual combination configured for Tables 3+4 → manual combination appears alongside auto-detected options, with correct source badge
- [ ] Combination selected → both tables show as BOOKED on floor plan for the booking time window
- [ ] Combination selected → both table rows on Table Grid show linked booking blocks
- [ ] Booking Detail Panel shows all assigned tables for a combined booking
- [ ] Moving a combined booking from the grid prompts correctly and moves all table assignments
- [ ] Cancelling a combined booking frees all assigned tables simultaneously
- [ ] Combination threshold updated in Settings → adjacency cache invalidated → new threshold applied on next combination search
- [ ] Recalculate button runs correctly and shows detected pair count
- [ ] `table_assignments` migration did not break existing single-table booking queries
- [ ] Floor Plan status overlays still render correctly for single-table bookings after migration
- [ ] Table Grid still renders correctly for single-table bookings after migration

---

## Implementation Sequencing

Work in this exact order:

1. Codebase audit - document current schema and data flow
2. `table_assignments` migration (if required) - verify all existing queries still work
3. `getRotatedBoundingBox()` utility - unit tested
4. `getBoundingBoxGap()` utility - unit tested
5. `detectAdjacentTables()` - unit tested
6. `findConnectedGroups()` - unit tested
7. `scoreCombination()` - unit tested
8. `findValidCombinations()` - integration tested with real venue data
9. Adjacency cache table + invalidation on floor plan save
10. Settings page: combination threshold field + recalculate button
11. New Booking modal: party size trigger + combination suggestion UI
12. Floor Plan: multi-table booking rendering (both tables show booking)
13. Table Grid: linked booking blocks across multiple rows
14. Booking Detail Panel: multi-table display + reassignment
15. Full end-to-end validation against checklist

---

## Scope Notes

**Do not** implement combination splitting (assigning part of a party to one table and part to another as separate bookings) - this is a future feature.

**Do not** implement automatic combination for the public-facing booking widget at this stage. The widget continues to show availability based on single-table and pre-configured manual combinations only. Automatic combination suggestions are a staff-side operational feature for now.

**Do** ensure the availability engine correctly treats all tables in an active combination as unavailable for the booking's time window - not just the primary table. A booking on Tables 3+4 must block both Table 3 and Table 4 from being offered in any subsequent availability query for that time window.
