# ReserveNI - Advanced Table Management: Settings Toggle & Unified Floor Plan Prompt

**Prompt Type:** Feature Refactor + Consolidation  
**Scope:** Settings page toggle, navigation mode-switching, unified Floor Plan screen, deprecation of redundant screens  
**Prerequisite:** Complete the System Harmony Audit prompt before running this one.

---

## Overview

This prompt covers two tightly related changes:

1. **Move the Advanced Table Management toggle from the Tables sidebar tab into the Settings page**, and implement clean mode-switching so the correct nav items and views appear and disappear based on the toggle state.

2. **Consolidate the Floor Plan screen, the standalone Floor Plan Editor, the Tables list screen, and the Table Combinations tab into a single unified Floor Plan screen** - with all table management functionality accessible in-place through an edit mode.

Work through these in order. Do not begin Part 2 until Part 1 is complete and verified.

---

## Part 1 - Settings Toggle & Navigation Mode-Switching

### 1.1 - Understand the Current Toggle Implementation

Before making any changes, locate and read the following:

- The current toggle component (likely in the Tables sidebar tab or a `/tables` page)
- The database column that stores the toggle state - confirm the exact column name and which table it lives on (expected: `table_management_enabled` boolean on `venues` or `venue_settings`)
- The React context, hook, or store that exposes this toggle state to the rest of the application
- The sidebar/navigation component that currently conditionally renders nav items based on this state
- Every page or component that reads the toggle state directly

Document what you find before proceeding.

---

### 1.2 - Move the Toggle to the Settings Page

**Goal:** The Advanced Table Management toggle must live in the Settings page, under a clearly labelled section. The current toggle location (Tables tab / Tables page) must be removed.

**Implementation steps:**

1. In the Settings page, create a new section titled **"Table Management"** (position it after general venue settings, before any billing/account section).

2. Within this section, add a toggle with the following UI:

   - **Label:** "Advanced Table Management"
   - **Description text:** "Enable per-table booking assignment, floor plan management, and the table timeline grid. When enabled, the Day Sheet view is replaced by the Floor Plan and Table Grid views."
   - **Toggle component:** Use your existing toggle/switch component for visual consistency.
   - **State indicator:** Show the current state clearly - "Enabled" / "Disabled" with appropriate colour treatment (green/grey or your existing active/inactive palette).

3. On toggle change:
   - Immediately persist the new value to the database (update the `venues` or `venue_settings` record via your existing Supabase update pattern).
   - Update the shared context/store so the rest of the application reacts without requiring a page reload.
   - Show a brief success confirmation inline (a small toast or inline status message - do not use a blocking modal for this).

4. Add a **warning modal** that fires only when the user is **turning the toggle OFF** and the venue has existing table assignments or a configured floor plan. The modal should read:

   > "Turning off Advanced Table Management will hide your Floor Plan and Table Grid views. Your table configurations and floor plan will be saved and can be restored by turning this back on. Existing bookings will not be affected."

   Provide "Turn Off" and "Cancel" buttons. Do not show this warning when turning the feature ON.

5. Remove the toggle from wherever it currently lives (Tables tab or Tables page). If the Tables page exists solely to house this toggle and the table list (which will be consolidated in Part 2), leave the page shell in place for now - it will be replaced in Part 2.

---

### 1.3 - Implement Navigation Mode-Switching

**Goal:** The sidebar must reflect the active mode at all times. The correct items must appear and disappear based on `table_management_enabled`, and this must be enforced at both the navigation level and the page level.

**Simple Mode (table_management_enabled = false):**
```
Home
Reservations
New Booking
Availability
Waitlist
Reports
Settings
───────────
Day Sheet
Your Booking Page
```

**Advanced Mode (table_management_enabled = true):**
```
Home
Reservations
New Booking
Availability
Waitlist
Reports
Settings
───────────
Floor Plan
Table Grid
Your Booking Page
```

**Implementation steps:**

1. In the sidebar component, replace the current conditional logic with a single clean condition based on the shared `table_management_enabled` context value:

   - When `false`: render the **Day Sheet** nav item. Do not render Floor Plan, Table Grid, or any Tables-related items.
   - When `true`: render **Floor Plan** and **Table Grid** nav items. Do not render the Day Sheet nav item.
   - **Tables** as a standalone nav item should be removed entirely - table management now lives inside the Floor Plan screen (Part 2).

2. The nav items must update **reactively** - when the toggle is changed in Settings, the sidebar must update immediately without a page reload. Confirm the context/store propagation handles this correctly.

3. Add **page-level route guards** to each mode-specific page:

   - `/day-sheet` - if `table_management_enabled` is `true`, redirect to `/floor-plan`
   - `/floor-plan` - if `table_management_enabled` is `false`, redirect to `/day-sheet`
   - `/table-grid` - if `table_management_enabled` is `false`, redirect to `/day-sheet`
   - `/tables` (current standalone page, to be deprecated in Part 2) - if `table_management_enabled` is `false`, redirect to `/settings`

   Implement these as early returns or middleware checks at the top of each page component, using the same shared context value as the sidebar.

4. After implementing, verify the following manually or via a checklist:

   - [ ] Toggle ON in Settings → sidebar immediately shows Floor Plan + Table Grid, Day Sheet disappears
   - [ ] Toggle OFF in Settings → sidebar immediately shows Day Sheet, Floor Plan + Table Grid disappear
   - [ ] Directly navigating to `/day-sheet` with advanced mode ON → redirected correctly
   - [ ] Directly navigating to `/floor-plan` with advanced mode OFF → redirected correctly
   - [ ] Page refresh with either mode active → correct nav items render on load, no flicker

---

## Part 2 - Unified Floor Plan Screen

### Overview

The following screens/tabs currently exist and must be consolidated:

| Current Screen | Current Location | Fate |
|---|---|---|
| Floor Plan (operational view) | `/floor-plan` | **Becomes the unified screen** |
| Floor Plan Editor | Separate screen or modal | **Folded into Floor Plan as Edit Mode** |
| Tables List | `/tables` or tabs within it | **Folded into Floor Plan as Properties Panel** |
| Table Combinations | Tab within `/tables` | **Folded into Floor Plan as Combinations Mode** |

The result is a **single `/floor-plan` screen** that handles all of the above, with context-appropriate UI that appears based on what the user is doing.

---

### 2.1 - Audit the Existing Screens

Before writing any new code, read and map the following:

- All components used by the current Floor Plan screen
- All components used by the Floor Plan Editor
- The Tables list page/component - what data it fetches, how it renders, what CRUD operations it supports
- The Table Combinations tab - how combinations are defined, stored (database schema), and displayed
- The Supabase tables involved: likely `tables`, `table_combinations`, `floor_plan_layouts` or similar - confirm exact schema
- Any shared state or data fetching that is duplicated across these screens

Document the full picture. Identify any data that is fetched in multiple places and will need to be consolidated into a single data-fetching layer on the new unified screen.

---

### 2.2 - Design the Unified Floor Plan Screen

The screen has **two top-level modes**: **Operational View** and **Edit Mode**. Edit Mode has three sub-modes accessible via tabs.

#### Operational View (default)

This is what staff see during service. It shows:

- The rendered floor plan canvas with all tables in their configured positions
- Each table displayed with its current status for the selected date/time:
  - **Available** - unbooked, shown in neutral colour
  - **Booked** - has an upcoming or current booking, shown with party name and time
  - **Seated** - currently occupied
  - **Reserved / Held** - blocked
- A **date/time selector** at the top of the screen so staff can scrub forward and see the floor plan state at any point in the service
- A top-right **"Edit Layout"** button (pencil icon + label) that enters Edit Mode
- Clicking any table opens a **quick-action popover** showing:
  - Table name/number and capacity
  - Current booking (if any) with guest name and party size
  - Quick actions: Assign Booking, Mark Seated, Mark Available, Block Table
  - A link to view the full booking record

#### Edit Mode

Activated by clicking "Edit Layout". The canvas shifts into an editing state. A header banner appears reading **"Editing Layout - changes are not saved until you click Save"** in a clearly distinct colour (amber/warning tone).

Edit Mode has **three tabs** in a panel that appears alongside or below the canvas:

---

**Tab 1 - Tables**

This replaces the current standalone Tables list screen.

- The canvas is now interactive: tables are **draggable** and **resizable**
- A left sidebar panel shows a **table shape picker** - the user can drag new table shapes onto the canvas (round 2-top, round 4-top, rectangular 2-top, rectangular 4-top, rectangular 6-top, rectangular 8-top, booth)
- **Clicking any table on the canvas** opens an inline **Properties Panel** on the right side, showing:
  - Table number / name (editable text field)
  - Capacity (number input, min 1 max 20)
  - Table type (dropdown: Standard, Booth, Bar, High Top, Outdoor)
  - Active toggle (active tables appear in booking availability; inactive tables are shown greyed out on the floor plan and excluded from availability)
  - A **Delete Table** button (red, with confirmation) - if the table has future bookings assigned, show a warning: *"This table has [N] upcoming bookings assigned. Deleting it will unassign those bookings. They will remain in the system but will need to be manually reassigned."*
- Tables can be moved freely on the canvas by dragging
- A grid snap option in the toolbar helps with alignment

**Tab 2 - Combinations**

This replaces the current standalone Table Combinations tab.

- Shows a list of all currently defined combinations on the left
- The canvas highlights combination member tables with a coloured overlay when a combination is selected in the list
- **Creating a combination:**
  1. User clicks "New Combination" button
  2. A prompt appears on the canvas: *"Click the tables that form this combination"*
  3. User clicks 2 or more tables - they highlight as selected
  4. A small form appears: combination name (e.g. "Tables 3+4"), combined capacity (auto-calculated from member tables, editable), and active toggle
  5. User clicks "Save Combination"
  6. A visual link/bracket indicator is drawn between the combination member tables on the canvas
- **Editing a combination:** click it in the list → member tables highlight → edit form opens → save
- **Deleting a combination:** confirmation required, same warning pattern as table deletion if bookings are assigned to the combination

**Tab 3 - Areas** *(implement as a stub if not currently built)*

- Allows the floor plan to be divided into named areas (Main Room, Terrace, Private Dining, Bar)
- Each area is a labelled region on the canvas
- Tables can be assigned to an area
- Areas affect reporting and can be used to filter the Table Grid view
- If this feature is not yet built, render the tab with an "Coming Soon" placeholder - do not attempt to build it in this prompt. Simply stub the tab so it exists in the UI.

---

#### Edit Mode - Save / Discard

- A **Save Layout** button and a **Discard Changes** button appear persistently at the top of the screen while in edit mode
- Save: persists all changes (table positions, properties, combinations) to the database in a single transaction where possible. Show a loading state on the button. On success, exit edit mode and return to Operational View.
- Discard: prompts *"Discard all unsaved changes?"* with Discard / Keep Editing options. On confirm, revert the canvas to the last saved state and exit edit mode.
- If the user attempts to navigate away while in edit mode with unsaved changes, show a standard unsaved changes warning.

---

### 2.3 - Data Layer Consolidation

The unified Floor Plan screen should fetch all required data in a **single initialisation hook or server component fetch**, covering:

- All tables for the venue (`id`, `name`, `capacity`, `type`, `position_x`, `position_y`, `width`, `height`, `rotation`, `active`)
- All table combinations (`id`, `name`, `capacity`, `member_table_ids[]`, `active`)
- All areas if the schema supports it
- Bookings for the selected date (for operational view status overlay)

Do not fetch these in separate per-component calls if they are already available from a parent fetch. Consolidate duplicated queries.

Confirm the Supabase schema supports all required fields. If any fields are missing (e.g. `position_x`, `position_y`, `width`, `height`, `rotation` on the `tables` table for floor plan positioning), add the necessary migration before building the UI. Write the migration as a Supabase SQL migration file following the project's existing migration conventions.

---

### 2.4 - Deprecate the Old Screens

Once the unified Floor Plan screen is complete and verified:

1. **Remove `/tables` from the sidebar navigation** (it should already be gone from Part 1, but confirm)
2. **Add a redirect** from the old `/tables` route to `/floor-plan` so any bookmarked URLs don't 404
3. **Remove the standalone Floor Plan Editor** screen/route if it existed as a separate page - redirect its route to `/floor-plan` as well
4. **Delete or archive** the component files for the old Tables list, Table Combinations tab, and Floor Plan Editor. Do not leave dead code in the codebase - if you are uncertain whether a component is used elsewhere, check all imports before deleting.

---

### 2.5 - Validation Checklist for Part 2

- [ ] Floor Plan screen loads in Operational View by default, showing all active tables with correct status for today's date
- [ ] Date/time scrubber correctly updates table status overlay without full page reload
- [ ] Clicking a table in Operational View shows the quick-action popover with correct booking data
- [ ] "Edit Layout" button enters Edit Mode with the amber warning banner visible
- [ ] Tables tab: new table can be dragged from shape picker onto canvas and saved
- [ ] Tables tab: existing table can be dragged to new position, properties edited, and saved
- [ ] Tables tab: table deletion with future bookings shows correct warning and unassigns (does not delete) those bookings
- [ ] Combinations tab: new combination can be created by clicking tables on canvas
- [ ] Combinations tab: combination displays visual link between member tables on canvas
- [ ] Combinations tab: combination deletion with assigned bookings shows correct warning
- [ ] Save Layout persists all changes correctly to Supabase
- [ ] Discard Changes reverts canvas to last saved state
- [ ] Navigating away with unsaved changes triggers unsaved changes warning
- [ ] Old `/tables` route redirects to `/floor-plan`
- [ ] No dead component files remain from deprecated screens
- [ ] `table_management_enabled = false` → `/floor-plan` route is guarded and redirects correctly

---

## Implementation Notes

**Do not** attempt to build the full unified Floor Plan screen as a single code generation task. Break it into the following sequential sub-tasks, completing and testing each before moving to the next:

1. Settings toggle + database persistence
2. Navigation mode-switching + route guards
3. Floor Plan screen data layer consolidation and schema migration (if needed)
4. Operational View with status overlay
5. Edit Mode shell + tab structure
6. Tables tab (drag, drop, properties panel, delete)
7. Combinations tab (creation flow, canvas highlighting, delete)
8. Save / Discard flow
9. Deprecation of old screens + redirects

**State management:** All edit mode state (unsaved positions, unsaved property changes) should live in local component state and only be committed to the database on Save. Do not auto-save or optimistically update Supabase during editing - the explicit Save action is the commit point.

**Canvas implementation:** If the existing floor plan canvas uses a library (e.g. Konva, React Flow, Fabric.js, or a custom SVG/canvas implementation), stay within that library for all new canvas interactions. Do not introduce a second canvas library. If the existing implementation is insufficient for the required interactions, flag this before proceeding and propose a migration path.

**Mobile:** The Floor Plan screen does not need to be fully functional on mobile at this stage. A read-only operational view on tablet is acceptable. The edit mode can be desktop-only for now, with a clear message on smaller screens: *"Floor plan editing is available on desktop."*
