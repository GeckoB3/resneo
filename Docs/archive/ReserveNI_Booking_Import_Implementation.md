# ReserveNI — Booking Import Implementation Prompt

**Extension to the Data Import Tool: Full Booking Reference Resolution**
**For Cursor AI Agent**

---

## OVERVIEW

This prompt extends the existing data import tool to handle future booking imports correctly across all five ReserveNI booking models. When a venue imports booking data from a competitor platform, future bookings must be fully functional — appearing on the correct calendar, triggering reminders at the right time, and being manageable from the dashboard exactly like bookings made natively in ReserveNI.

This requires a new wizard step (Step 3b: Match Booking References) that extracts all external references from the uploaded booking file (service names, staff names, event names, class names, resource names, table references) and resolves each one to an existing or newly created entity in ReserveNI before validation and import proceed.

The existing import tool steps remain unchanged:

- Step 1: Upload
- Step 2: Map Columns
- Step 3: Review Columns
- **Step 3b: Match Booking References ← NEW (only appears for booking files)**
- Step 4: Validate
- Step 5: Import

---

## DATABASE CHANGES

### Add to import_sessions table

```sql
ALTER TABLE import_sessions ADD COLUMN IF NOT EXISTS has_booking_file BOOLEAN DEFAULT false;
-- Set to true when any uploaded file is labelled 'bookings'

ALTER TABLE import_sessions ADD COLUMN IF NOT EXISTS references_resolved BOOLEAN DEFAULT false;
-- Set to true when Step 3b is complete
-- Validation (Step 4) cannot proceed until this is true (when has_booking_file = true)
```

### New table: import_booking_references

Stores every unique external reference extracted from booking CSV files, and its resolution to a ReserveNI entity.

```sql
CREATE TABLE import_booking_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES import_sessions(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES import_files(id) ON DELETE CASCADE,
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,

  -- What type of reference this is
  reference_type TEXT NOT NULL,
  -- 'service'     = a service or treatment name (appointments model)
  -- 'staff'       = a staff member or practitioner name (appointments model)
  -- 'event'       = an event name and date (events model)
  -- 'class'       = a class name and instance date/time (classes model)
  -- 'resource'    = a resource name (resource model)
  -- 'table'       = a table reference (restaurant model — handled differently, see notes)

  -- The raw value from the CSV
  raw_value TEXT NOT NULL,
  -- e.g. "Men's Cut", "Sarah", "Ghost Tour — 20 April 2026 2pm", "Court 1"

  -- For events and classes: the specific date and time of the instance
  instance_date DATE,
  instance_time TIME,
  instance_end_time TIME,

  -- How many bookings in the file reference this value
  booking_count INT NOT NULL DEFAULT 0,

  -- AI mapping suggestion
  ai_suggested_entity_id UUID,
  -- The UUID of the suggested ReserveNI entity (service, practitioner, event, etc.)
  ai_suggested_entity_name TEXT,
  ai_confidence TEXT,
  -- 'high' | 'medium' | 'low'
  ai_reasoning TEXT,

  -- User resolution
  resolution_action TEXT,
  -- 'map'    = map to an existing ReserveNI entity (entity_id populated)
  -- 'create' = create a new entity and map to it (created_entity_id populated after creation)
  -- 'skip'   = skip all bookings that reference this value
  -- 'unassigned' = import as unassigned (restaurant tables only)

  -- For 'map' resolution: the existing entity to link to
  resolved_entity_id UUID,
  resolved_entity_type TEXT,
  -- 'service_item' | 'unified_calendar' | 'event_session' | 'class_instance' | 'venue_resource'

  -- For 'create' resolution: the newly created entity
  created_entity_id UUID,
  created_entity_type TEXT,

  -- Status
  is_resolved BOOLEAN DEFAULT false,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_import_refs_session ON import_booking_references(session_id);
CREATE INDEX idx_import_refs_type ON import_booking_references(session_id, reference_type);
```

### New table: import_booking_rows

Stores each individual future booking row from the CSV, linked to its resolved references, ready for import.

```sql
CREATE TABLE import_booking_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES import_sessions(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES import_files(id) ON DELETE CASCADE,
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,

  row_number INT NOT NULL,

  -- Parsed booking data
  booking_date DATE NOT NULL,
  booking_time TIME NOT NULL,
  booking_end_time TIME,
  duration_minutes INT,
  party_size INT DEFAULT 1,

  -- Raw CSV reference values (before resolution)
  raw_service_name TEXT,
  raw_staff_name TEXT,
  raw_event_name TEXT,
  raw_class_name TEXT,
  raw_resource_name TEXT,
  raw_table_ref TEXT,
  raw_status TEXT,
  raw_price TEXT,
  raw_notes TEXT,

  -- Resolved reference IDs (populated after Step 3b)
  resolved_service_id UUID,
  resolved_calendar_id UUID,        -- practitioner or resource calendar
  resolved_event_session_id UUID,
  resolved_class_instance_id UUID,
  resolved_resource_id UUID,

  -- Client linkage (populated after client import runs first)
  guest_id UUID REFERENCES guests(id),
  raw_client_email TEXT,
  raw_client_phone TEXT,
  raw_client_name TEXT,

  -- Import status
  import_status TEXT DEFAULT 'pending',
  -- 'pending' | 'imported' | 'skipped' | 'error'
  skip_reason TEXT,
  error_message TEXT,

  -- Whether this is a future booking (requires full calendar linkage)
  is_future_booking BOOLEAN DEFAULT false,

  -- Communication flags (to prevent duplicate reminders)
  suppress_all_comms BOOLEAN DEFAULT false,
  -- true if appointment is within 24 hours of import
  reminder_already_sent BOOLEAN DEFAULT false,
  -- true if appointment is between 2 and 24 hours from import

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_import_booking_rows_session ON import_booking_rows(session_id);
CREATE INDEX idx_import_booking_rows_future ON import_booking_rows(session_id, is_future_booking);
```

Apply standard venue-scoped RLS to both new tables.

---

## STEP 3b: MATCH BOOKING REFERENCES

### When this step appears

Step 3b appears automatically after Step 3 (Review Columns) when:

1. The session has at least one file labelled 'bookings', AND
2. That file contains a `booking_date` column mapped to a date field, AND
3. At least one row in the booking file has a date in the future

If none of these conditions are met (e.g. purely historical data), skip Step 3b and proceed to Step 4.

### What happens on entering Step 3b

On entering this step, the system immediately:

1. Parses every row of the booking CSV using the column mappings defined in Steps 2 and 3.
2. Identifies future booking rows (booking_date >= today).
3. Extracts all unique reference values from future booking rows, grouped by reference type:
  - All unique values in the mapped `service_name` column
  - All unique values in the mapped `staff_name` column
  - All unique values in the mapped `event_name` column (with their dates and times)
  - All unique values in the mapped `class_name` column (with their dates and times)
  - All unique values in the mapped `resource_name` column
  - All unique values in the mapped `table` column (restaurant model)
4. Creates `import_booking_references` records for each unique reference.
5. Calls the AI mapping endpoint to suggest resolutions.
6. Creates `import_booking_rows` records for each future booking row.

### AI reference mapping

**Endpoint:** `POST /api/import/sessions/[sessionId]/ai-map-references`

This endpoint calls the OpenAI API with model `gpt-5.4-nano` to suggest how each external reference maps to existing ReserveNI entities.

For each reference type, fetch the relevant existing entities from the venue:

```typescript
// For 'service' references: fetch existing service_items
const existingServices = await supabase
  .from('service_items')
  .select('id, name, duration_minutes, price_pence')
  .eq('venue_id', venueId)
  .eq('is_active', true);

// For 'staff' references: fetch existing unified_calendars of type 'practitioner'
const existingPractitioners = await supabase
  .from('unified_calendars')
  .select('id, name, slug')
  .eq('venue_id', venueId)
  .eq('calendar_type', 'practitioner')
  .eq('is_active', true);

// For 'event' references: fetch existing event_sessions
const existingEvents = await supabase
  .from('event_sessions')
  .select('id, calendar_id, session_date, start_time, service_item_id')
  .eq('venue_id', venueId)
  .gte('session_date', today);

// For 'class' references: fetch existing class_instances
const existingClasses = await supabase
  .from('class_instances')
  .select('id, class_type_id, instance_date, start_time')
  .eq('venue_id', venueId)
  .gte('instance_date', today);

// For 'resource' references: fetch existing venue_resources
const existingResources = await supabase
  .from('venue_resources')
  .select('id, name, resource_type')
  .eq('venue_id', venueId)
  .eq('is_active', true);
```

**OpenAI prompt for reference matching:**

```typescript
const systemPrompt = `You are a data matching assistant for ReserveNI, a booking platform.
Your job is to match names from an imported booking CSV to existing entities in ReserveNI.
Return ONLY valid JSON with no additional text or markdown.`;

const userPrompt = `
Match each imported reference to the closest existing ReserveNI entity.

Imported references to match:
${JSON.stringify(references, null, 2)}

Existing ReserveNI entities:
${JSON.stringify(existingEntities, null, 2)}

For each reference, return:
{
  "reference_id": "the import_booking_references UUID",
  "raw_value": "the original CSV value",
  "suggested_entity_id": "UUID of best match, or null if no good match",
  "suggested_entity_name": "name of the matched entity",
  "confidence": "high | medium | low",
  "reasoning": "brief explanation"
}

Rules:
- 'high' confidence: name is an exact or very close match (e.g. "Men's Cut" → "Men's Cut")
- 'medium' confidence: semantically similar (e.g. "Gents Haircut" → "Men's Cut")
- 'low' confidence: uncertain match
- Return null for suggested_entity_id if no reasonable match exists
- Never force a match — prefer null over a wrong match
`;
```

### Step 3b UI Layout

**Route:** `/dashboard/import/[sessionId]/references`

**Page header:**
Title: 'Match Your Booking Data'
Subtitle: 'We found references to services, staff, and other items in your bookings. Tell us what each one maps to in Reserve NI so your future bookings import correctly.'

**Progress summary bar at top:**

```
✓ 3 of 7 references resolved   ⚠ 4 still need attention
```

**Tabs for each reference type found:**
Only show tabs for reference types that actually appear in the data. If the booking file has no class references, don't show a Classes tab.

Tabs: Services | Staff | Events | Classes | Resources | Tables

---

### TAB: Services

Shows all unique service names found in the future booking rows.

**Layout per service reference:**

```
┌─────────────────────────────────────────────────────────────────┐
│ "Men's Cut"                                    Used in 23 bookings
│ Sample values: Men's Cut, Men's Cut, Men's Cut
│
│ AI suggestion: ● High confidence → Men's Cut (30 min, £15)
│
│ [✓ Use Men's Cut]  [Choose different →]  [Create new service]  [Skip these bookings]
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ "Hot Towel Shave"                              Used in 4 bookings
│ Sample values: Hot Towel Shave, Hot Towel Shave
│
│ ⚠ No match found — this service doesn't exist in Reserve NI yet
│
│ [Choose existing →]  [Create new service]  [Skip these bookings]
└─────────────────────────────────────────────────────────────────┘
```

**'Create new service' inline form:**

When the user clicks 'Create new service', expand an inline form below the reference card:

```
Create service: Hot Towel Shave

Service name:    [Hot Towel Shave          ]
Duration:        [30 min ▾]
Price:           [£ 18.00]
Colour:          [● ▾]
Assign to:       ☑ Sarah  ☑ John  ☐ Mike  (shows all practitioners)

[Create and use this service]
```

On submit: create the `service_items` record, create `calendar_service_assignments` for checked practitioners, set the reference's resolution_action to 'create', created_entity_id to the new service ID, is_resolved to true.

**'Choose different' dropdown:**
Shows all existing active service_items for this venue. Selecting one sets resolution_action to 'map' and resolved_entity_id.

**'Skip these bookings' option:**
Sets resolution_action to 'skip'. The 4 bookings referencing "Hot Towel Shave" will be skipped during import. Show a count: 'Skipping 4 bookings.'

---

### TAB: Staff

Shows all unique staff/practitioner names found in the future booking rows.

```
┌─────────────────────────────────────────────────────────────────┐
│ "Sarah"                                        Used in 34 bookings
│
│ AI suggestion: ● High confidence → Sarah Jones
│
│ [✓ Use Sarah Jones]  [Choose different →]  [Create new practitioner]  [Skip]
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ "Mark"                                         Used in 8 bookings
│
│ ⚠ No match found
│
│ [Choose existing →]  [Create new practitioner]  [Skip these bookings]
└─────────────────────────────────────────────────────────────────┘
```

**'Create new practitioner' inline form:**

```
Create practitioner: Mark

Full name:       [Mark                     ]
Working hours:   [Copy from existing ▾] or set manually
                 Mon-Fri 9am-6pm (default)

[Create and use this practitioner]
```

On submit: create the `unified_calendars` record with calendar_type='practitioner', working_hours set to the venue's default working hours. The practitioner is created as inactive (no working hours confirmed) and a warning is shown: 'Mark has been created. Remember to set up their working hours and services in Settings.'

---

### TAB: Events

Shows all unique event names and instances found in the future booking rows.

Events are shown grouped by event name, with each specific instance listed below:

```
┌─────────────────────────────────────────────────────────────────┐
│ EVENT: "Ghost Tour"
│
│   Instance: 20 April 2026 at 7:00 PM    Used in 8 bookings
│   AI suggestion: ⚠ Low confidence → No matching event found
│   [Create this event session]  [Link to existing event →]  [Skip]
│
│   Instance: 27 April 2026 at 7:00 PM    Used in 12 bookings
│   AI suggestion: ⚠ No match found
│   [Create this event session]  [Link to existing event →]  [Skip]
└─────────────────────────────────────────────────────────────────┘
```

**'Create this event session' inline form:**

Creating an event instance requires either linking to an existing event type (unified_calendar with calendar_type='event') or creating a new one.

```
Create event: Ghost Tour — 20 April 2026

Event type:      [+ Create new event type "Ghost Tour"] or [Link to existing ▾]

If creating new event type:
  Event name:    [Ghost Tour                ]
  Description:   [                          ]
  Default capacity: [6]

Session details (pre-filled from CSV):
  Date:          [20 April 2026]
  Start time:    [7:00 PM]
  End time:      [8:30 PM] (estimated — adjust if needed)
  Capacity:      [6] (from event type default, or override here)

[Create event and session]
```

On submit:

1. If creating a new event type: create `unified_calendars` record with calendar_type='event'
2. Create `event_sessions` record linked to the calendar
3. Set reference resolution to the new event_session_id

**Important:** When event sessions are created here, they are immediately live and bookable by other clients. Add a note: 'This event session will be visible on your booking page immediately. Edit it in your Events dashboard after import if needed.'

---

### TAB: Classes

Very similar to Events but for recurring class sessions.

```
┌─────────────────────────────────────────────────────────────────┐
│ CLASS: "Vinyasa Yoga"
│
│   Instance: Monday 21 April 2026 at 6:00 PM    Used in 12 bookings
│   AI suggestion: ● High confidence → Vinyasa Yoga (Mondays 6pm)
│   [✓ Use this class session]  [Choose different →]  [Skip]
│
│   Instance: Monday 28 April 2026 at 6:00 PM    Used in 9 bookings
│   AI suggestion: ● High confidence → Vinyasa Yoga (Mondays 6pm)
│   [✓ Use this class session]  [Choose different →]  [Skip]
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ CLASS: "Advanced Pilates"
│
│   Instance: Wednesday 23 April 2026 at 10:00 AM    Used in 6 bookings
│   ⚠ No match found — this class doesn't exist in Reserve NI yet
│   [Create class type and session]  [Link to existing →]  [Skip]
└─────────────────────────────────────────────────────────────────┘
```

**'Create class type and session' inline form:**

```
Create class: Advanced Pilates

Class type:      [+ Create new "Advanced Pilates"] or [Link to existing ▾]

If creating new class type:
  Class name:    [Advanced Pilates          ]
  Duration:      [60 min ▾]
  Capacity:      [15]
  Instructor:    [Choose practitioner ▾] (optional)
  Price per class: [£ 12.00]

Session details (pre-filled):
  Date:          [Wednesday 23 April 2026]
  Start time:    [10:00 AM]
  Capacity override: [15] (or leave blank to use class type default)

[Create class and session]
```

On submit:

1. If creating new class type: create `class_types` record
2. Create `class_instances` record linked to the class type
3. Set reference resolution to the new class_instance_id

---

### TAB: Resources

```
┌─────────────────────────────────────────────────────────────────┐
│ "Court 1"                                      Used in 18 bookings
│
│ AI suggestion: ● High confidence → Tennis Court 1
│
│ [✓ Use Tennis Court 1]  [Choose different →]  [Create new resource]  [Skip]
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ "Meeting Room A"                               Used in 5 bookings
│
│ ⚠ No match found
│
│ [Choose existing →]  [Create new resource]  [Skip these bookings]
└─────────────────────────────────────────────────────────────────┘
```

**'Create new resource' inline form:**

```
Create resource: Meeting Room A

Resource name:   [Meeting Room A           ]
Resource type:   [Meeting Room ▾]
Min booking:     [30 min ▾]
Max booking:     [4 hours ▾]
Price per slot:  [£ 25.00]
Availability:    Mon-Fri 8am-6pm (default — adjust in Settings)

[Create and use this resource]
```

On submit: create `venue_resources` record. Set reference resolution to the new resource ID.

---

### TAB: Tables (Restaurant Model Only)

Tables are handled differently from all other reference types. Instead of mapping old table numbers to ReserveNI tables, all restaurant bookings are imported as unassigned and staff assign them manually.

This tab explains the behaviour rather than asking for mapping:

```
┌─────────────────────────────────────────────────────────────────┐
│ Table References Found in Your Booking Data
│
│ We found references to these tables in your future bookings:
│ Table 5, Table 6, Table 12, Corner Booth, Window Seat
│
│ Restaurant table layouts are unique to each setup, so we can't
│ automatically assign your imported bookings to specific tables.
│
│ Instead, your 34 future restaurant bookings will be imported as
│ UNASSIGNED bookings. They will appear on your day sheet and
│ bookings list with the correct date, time, party size, and guest
│ details — but without a specific table assigned.
│
│ After import, open your Table Grid or Day Sheet to assign each
│ booking to the correct table.
│
│ [Got it — import as unassigned ✓]
└─────────────────────────────────────────────────────────────────┘
```

The user must click the confirmation button to proceed. This ensures they understand and expect the unassigned state.

---

### Step 3b Progress and Completion

At the bottom of each tab, show resolution progress:

```
Services:  5 of 5 resolved ✓
Staff:     3 of 4 resolved (1 pending)
Events:    2 of 2 resolved ✓
Classes:   Not present in your data
Resources: Not present in your data
Tables:    Confirmed as unassigned ✓
```

The 'Continue to Validation' button is enabled only when all references in all tabs are resolved (either mapped, created, or skipped). If any are still pending, show: 'Resolve all references before continuing. 1 staff member still needs attention.'

When the user clicks Continue: set `import_sessions.references_resolved = true` and proceed to Step 4.

---

## API ENDPOINTS FOR STEP 3b

### Extract references

`POST /api/import/sessions/[sessionId]/extract-references`

Triggered automatically when entering Step 3b. Parses all booking CSV rows using the saved column mappings. Identifies future booking rows. Extracts unique references per type. Creates import_booking_references records. Creates import_booking_rows records. Calls the AI mapping endpoint. Returns the full reference list grouped by type.

### AI map references

`POST /api/import/sessions/[sessionId]/ai-map-references`

Calls the OpenAI API (gpt-5.4-nano) to suggest entity matches for all unresolved references. Stores suggestions in import_booking_references. Returns suggestions. If OpenAI is unavailable, returns empty suggestions gracefully.

### Resolve a reference

`PATCH /api/import/sessions/[sessionId]/references/[referenceId]`

Body:

```typescript
{
  resolution_action: 'map' | 'create' | 'skip' | 'unassigned';
  resolved_entity_id?: string;        // for 'map'
  resolved_entity_type?: string;      // for 'map'
  entity_data?: object;               // for 'create' — data to create the new entity
}
```

For 'create' action: create the entity (service, practitioner, event session, class instance, or resource), then set the reference's created_entity_id, resolved_entity_id (same as created), and is_resolved = true.

Returns the updated reference and the created entity (if applicable).

### Bulk resolve

`POST /api/import/sessions/[sessionId]/references/bulk-resolve`

Accept an array of resolution decisions. Used when the user confirms all AI suggestions at once.

### Confirm table handling

`POST /api/import/sessions/[sessionId]/confirm-table-unassigned`

Sets all table references to resolution_action = 'unassigned'. Required before Step 4 can proceed for restaurant venues.

---

## UPDATED IMPORT EXECUTION ENGINE

The import execution engine must be updated to handle fully linked future bookings. The processing order is:

### Phase 1: Import clients (unchanged)

Process all client files first, creating or updating guest records. This must complete before Phase 2.

### Phase 2: Import bookings

For each row in import_booking_rows:

**Step 1: Find the guest**

Look up the guest using the resolved guest_id (if already set from Phase 1), or by matching raw_client_email, raw_client_phone, or raw_client_name against the newly created guest records.

If no guest is found: log as skipped with reason 'no_matching_client'.

**Step 2: Determine the booking type and build the booking record**

The booking type is determined by the venue's booking_model and which reference fields are populated:

```typescript
function buildBookingRecord(row: ImportBookingRow, venue: Venue): Partial<Booking> {
  const base = {
    venue_id: row.venue_id,
    guest_id: row.guest_id,
    booking_date: row.booking_date,
    booking_time: row.booking_time,
    status: mapImportedStatus(row.raw_status),
    // 'Completed' → 'Completed', 'No Show' → 'No-show', 'Cancelled' → 'Cancelled'
    // Future bookings with status 'Confirmed' or null → 'Confirmed'
    notes: row.raw_notes,
    source: 'import',
    // Mark all imported bookings with source='import' for filtering/reporting
  };

  if (venue.booking_model === 'table_reservation') {
    // Restaurant: import as unassigned
    return {
      ...base,
      party_size: row.party_size,
      table_id: null,            // Unassigned
      area_id: venue.default_area_id,
      is_unassigned: true,
    };
  }

  if (row.resolved_service_id && row.resolved_calendar_id) {
    // Practitioner appointment
    return {
      ...base,
      service_item_id: row.resolved_service_id,
      calendar_id: row.resolved_calendar_id,
      duration_minutes: row.duration_minutes ?? getServiceDuration(row.resolved_service_id),
    };
  }

  if (row.resolved_event_session_id) {
    // Event ticket
    return {
      ...base,
      event_session_id: row.resolved_event_session_id,
      capacity_used: row.party_size ?? 1,
    };
  }

  if (row.resolved_class_instance_id) {
    // Class session spot
    return {
      ...base,
      class_instance_id: row.resolved_class_instance_id,
      capacity_used: 1,
    };
  }

  if (row.resolved_resource_id) {
    // Resource booking
    return {
      ...base,
      calendar_id: row.resolved_resource_id,
      duration_minutes: row.duration_minutes,
    };
  }

  return null; // Cannot determine booking type — will be skipped
}
```

**Step 3: Validate capacity for future bookings**

For future bookings that link to events, classes, or resources, check that capacity is not exceeded:

```typescript
// For events: check remaining capacity
const existingBookings = await supabase
  .from('bookings')
  .select('capacity_used')
  .eq('event_session_id', row.resolved_event_session_id)
  .in('status', ['Pending', 'Confirmed']);

const totalBooked = existingBookings.reduce((sum, b) => sum + b.capacity_used, 0);
const session = await getEventSession(row.resolved_event_session_id);

if (totalBooked + (row.party_size ?? 1) > session.capacity) {
  // Log warning but still import — the venue is migrating real bookings
  // that existed before this capacity was exceeded. Add a warning note.
  importWarning = 'Imported over capacity — review this booking';
}
```

Do NOT block import due to capacity. Real bookings from a previous system should always come across, even if they technically exceed the capacity configured in ReserveNI. Flag them with a warning instead.

**Step 4: Create the booking record**

Insert into the bookings table. Log to import_records with action 'created'.

**Step 5: Handle communication flags**

For future bookings only:

```typescript
const hoursUntilAppointment = differenceInHours(
  new Date(`${row.booking_date}T${row.booking_time}`),
  new Date()
);

if (hoursUntilAppointment <= 2) {
  // Appointment is imminent — suppress all communications
  await supabase.from('bookings').update({
    reminder_sent_at: new Date(),
    final_reminder_sent_at: new Date(),
    suppress_import_comms: true,
  }).eq('id', newBookingId);
}
else if (hoursUntilAppointment <= 24) {
  // Primary reminder window has passed — mark as sent to prevent duplicate
  await supabase.from('bookings').update({
    reminder_sent_at: new Date(),
    // final_reminder_sent_at left null — 2-hour nudge will still fire if applicable
  }).eq('id', newBookingId);
}
else {
  // Appointment is more than 24 hours away
  // Leave reminder_sent_at null — cron will send reminder at the normal time
  // Do NOT send a confirmation email/SMS — the client already has one from the old system
}
```

Add a boolean column to the bookings table to suppress import confirmation messages:

```sql
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS suppress_import_comms BOOLEAN DEFAULT false;
```

The communication engine should check this flag before sending booking_confirmation messages. If suppress_import_comms is true, skip the confirmation send entirely. Reminders and other communications fire normally based on the timestamp logic above.

---

## UPDATED VALIDATION (STEP 4)

After Step 3b completes, Step 4 validation must include booking-specific checks. Add these to the existing validation logic:

### Booking validation rules


| Check                                                                      | Issue type           | Severity | Resolution                                      |
| -------------------------------------------------------------------------- | -------------------- | -------- | ----------------------------------------------- |
| Booking date is in the past                                                | `historical_booking` | Warning  | Import as historical record (no calendar entry) |
| No matching guest found                                                    | `no_matching_client` | Error    | Skip booking                                    |
| Resolved entity has been deleted or deactivated since Step 3b              | `entity_unavailable` | Error    | Re-resolve or skip                              |
| Future booking is over capacity                                            | `over_capacity`      | Warning  | Import with warning flag                        |
| Booking time conflicts with another imported booking for same practitioner | `time_conflict`      | Warning  | Import with warning (staff manage conflicts)    |
| Booking references a 'skip' resolved reference                             | `reference_skipped`  | Info     | Skip booking (expected)                         |
| Restaurant booking (unassigned)                                            | `table_unassigned`   | Info     | Import without table (expected)                 |


Show a dedicated section in the validation summary for booking issues:

```
Booking Validation

✓ 156 future bookings ready to import
✓ 89 historical bookings will be added to client records
⚠ 3 bookings are over the event/class capacity (will import with warning)
⚠ 2 bookings have time conflicts between staff members (will import with flag)
✗ 4 bookings skipped (no matching client found)
✗ 8 bookings skipped (service was set to 'skip' in Step 3b)

34 restaurant bookings will import as unassigned (assign tables in your dashboard)
```

---

## DASHBOARD INTEGRATION AFTER IMPORT

### Day sheet (restaurant model)

After import, unassigned restaurant bookings appear in the day sheet with a distinct visual treatment:

```
Unassigned Bookings (34)
┌─────────────────────────────────────────────────────────────────┐
│ 7:00 PM  Sarah Jones  Party of 4   No table assigned   [Assign] │
│ 7:30 PM  John Smith   Party of 2   No table assigned   [Assign] │
└─────────────────────────────────────────────────────────────────┘
```

The [Assign] button opens the standard table assignment flow. Show an informational banner for 7 days after import: 'You have [N] imported bookings without tables assigned. Assign tables in your day sheet or table grid.'

### Calendar (appointments model)

Imported future appointments appear on the practitioner calendar exactly like native bookings. Show a small 'Imported' badge on the booking block for 7 days so staff can identify them easily. After 7 days, the badge disappears and the booking looks identical to any other.

### Events dashboard

Imported event bookings appear in the attendee list for the relevant event session. If the event session was created during Step 3b, a banner on the event dashboard reads: 'This event was created during a data import. Review its settings and capacity before your event date.' for 7 days.

### Classes dashboard

Imported class bookings appear in the class roster for the relevant instance. Same 7-day banner if the class type and instance were created during Step 3b.

---

## POST-IMPORT NOTIFICATION TO VENUE OWNER

Extend the existing completion email to include booking-specific information:

```
Your data import is complete.

Clients:
✓ 847 clients imported
✓ 12 existing clients updated
✗ 3 rows skipped

Future Bookings:
✓ 156 appointments added to your calendar
✓ 34 restaurant bookings added (unassigned — assign tables in your dashboard)
✓ 8 event bookings linked to Ghost Tour sessions
✓ 12 class bookings linked to Vinyasa Yoga sessions
⚠ 3 bookings imported over capacity — review these in your dashboard
✗ 4 bookings skipped (no matching client found)

Historical Bookings:
✓ 89 past bookings added to client histories

New items created during import:
• 1 new service: Hot Towel Shave
• 1 new practitioner: Mark (set up their working hours in Settings)
• 2 new event sessions: Ghost Tour — 20 Apr, Ghost Tour — 27 Apr
• 1 new class type: Advanced Pilates

Reminders:
• 156 appointments will receive automated reminders at the normal times
• 2 appointments in the next 24 hours will not receive a duplicate reminder
• 0 appointments were too close to send any reminders

[View your calendar →]
[Assign restaurant tables →]  (if applicable)
[View import report →]
[Undo this import →]          (available until [datetime])
```

---

## TESTING SCENARIOS

### Appointments model (Model B)

1. **FULL APPOINTMENT IMPORT** — Upload a Booksy CSV with 3 services, 2 staff, and 45 future appointments. Step 3b shows Services and Staff tabs. AI maps 'Men's Cut' → existing service, 'Sarah' → existing practitioner. User creates 'Hot Towel Shave' inline. Import runs. 45 appointments appear on practitioner calendars. 24-hour reminders fire at correct times.
2. **NEW PRACTITIONER CREATED** — CSV references 'Mark' who doesn't exist in ReserveNI. User creates Mark as a new practitioner. Mark appears in the calendar with his imported appointments. Warning shown: 'Set up Mark's working hours and services in Settings.'
3. **SERVICE SKIPPED** — User marks 'Executive Package' as 'Skip these bookings'. 6 bookings referencing this service are excluded from import. Validation shows '6 bookings skipped (service set to skip)'.
4. **IMMINENT APPOINTMENT** — A booking is for 90 minutes from now. Booking is imported. reminder_sent_at and final_reminder_sent_at both set to now(). suppress_import_comms set to true. No confirmation or reminder sent.
5. **APPOINTMENT IN 12 HOURS** — Booking is for tomorrow morning. reminder_sent_at set to now() (primary reminder suppressed). final_reminder_sent_at left null (2-hour nudge will fire normally). No confirmation sent.
6. **APPOINTMENT IN 5 DAYS** — Booking is for next week. Both reminder timestamps left null. Cron sends 24-hour reminder at the normal time. No confirmation sent (suppress_import_comms true).

### Restaurant model (Model A)

1. **RESTAURANT UNASSIGNED IMPORT** — Upload a ResDiary CSV with 34 future table bookings. Step 3b shows only the Tables tab with the unassigned explanation. User clicks confirmation. Import runs. 34 bookings appear on day sheet as unassigned. Banner prompts staff to assign tables.
2. **TABLE ASSIGNMENT POST-IMPORT** — Staff opens day sheet after import. Sees unassigned bookings. Clicks [Assign] on each. Standard table assignment flow works. Once assigned, booking looks identical to a native reservation.

### Events model (Model C)

1. **EVENT SESSION CREATION** — CSV has 20 bookings for 'Ghost Tour' on 20 April. Step 3b shows Events tab with the specific session. AI finds no match. User clicks 'Create this event session'. Inline form creates the event type 'Ghost Tour' and the session on 20 April at 7pm with capacity 6. Import links 20 bookings to this session. Attendee list shows 20 names.
2. **OVER CAPACITY IMPORT** — 20 bookings are linked to an event with capacity 6. Import proceeds with a warning flag on the affected bookings. Events dashboard shows the session as over capacity with a warning banner.
3. **EXISTING EVENT MATCH** — AI correctly identifies that CSV 'Whiskey Tasting 25 Apr' matches an existing event session created during onboarding. User confirms. Import links bookings to the existing session without creating a duplicate.

### Classes model (Model D)

1. **RECURRING CLASS MATCH** — Yoga studio imports from Mindbody. CSV has classes every Monday for 4 weeks. AI matches all to 'Vinyasa Yoga' timetable entry. Import creates class instances for each Monday date and links bookings. Class rosters show correct participants.
2. **NEW CLASS TYPE AND INSTANCE** — CSV references 'Advanced Pilates' which doesn't exist. User creates class type and the specific instance inline. Import proceeds. Class dashboard shows the new class with imported participants.

### Resource model (Model E)

1. **RESOURCE MAPPING** — Tennis facility imports from a competitor. CSV has 'Court 1', 'Court 2', and 'Meeting Room A'. AI maps Court 1 and Court 2 to existing resources. User creates 'Meeting Room A' inline. Import creates resource bookings for all three. Resource timeline shows correct bookings.
2. **RESOURCE DURATION CALCULATION** — CSV has booking start time but no end time. Import calculates duration from the resource's minimum_booking_minutes setting. Booking is created with the calculated duration.

### Communication tests

1. **NO DUPLICATE CONFIRMATIONS** — Import 100 future appointments. Zero confirmation emails or SMS are sent. Clients do not receive duplicate messages from their old system and ReserveNI.
2. **REMINDERS FIRE CORRECTLY** — Import a booking for 3 days from now. On the day before, the 24-hour reminder cron fires and sends the normal reminder email and SMS. The client receives exactly one reminder.
3. **RECENT BOOKING SUPPRESSED** — Import a booking for 18 hours from now. reminder_sent_at set to now() at import time. 24-hour reminder cron finds reminder_sent_at is not null — skips. Client receives no duplicate reminder.

---

## CRITICAL RULES

1. **Future bookings must be fully functional.** An imported appointment for next Tuesday must appear on the practitioner's calendar, block the time slot, fire the 24-hour reminder, allow status updates, and support deposit refunds — identically to a natively created booking.
2. **Never block import due to capacity.** If imported bookings exceed the configured capacity of an event, class, or resource, import them with a warning flag. The venue is migrating real bookings — blocking them would strand actual customers.
3. **Never send confirmation messages for imported bookings.** The client already received a confirmation from the previous system. Set suppress_import_comms = true on all imported bookings to prevent the communication engine from sending a second confirmation.
4. **Handle reminder timing correctly.** Check the hours until the appointment at import time and set reminder timestamps accordingly. Appointments within 2 hours: suppress all comms. Appointments 2-24 hours away: suppress primary reminder, allow 2-hour nudge. Appointments more than 24 hours away: allow normal reminder cadence.
5. **Restaurant bookings are always unassigned.** Never attempt to map old table numbers to ReserveNI tables. The floor plan is unique to each ReserveNI setup and cannot be reliably matched from external data.
6. **Step 3b must complete before Step 4 runs.** The validation engine depends on all booking references being resolved. If import_sessions.references_resolved = false and has_booking_file = true, the Step 4 endpoint must return an error directing the user back to Step 3b.
7. **Entities created during Step 3b are immediately live.** Services, practitioners, event sessions, class instances, and resources created during the reference resolution step are immediately visible in the venue's dashboard and on their booking page. Add 7-day 'Created during import' badges so staff can identify and review them.
8. **Clients must be imported before bookings.** Phase 1 (client import) must fully complete before Phase 2 (booking import) begins. If client import fails, booking import must not start.
9. **Use source='import' on all imported bookings.** This allows filtering, reporting, and the 7-day badge display. Never remove this flag — it provides a permanent audit trail of which bookings originated from a data migration.
10. **The undo operation must reverse entity creation.** If the user undoes the import and new entities (services, practitioners, events, classes, resources) were created during Step 3b, those entities must also be soft-deleted as part of the undo. Store created entity IDs in import_records so the undo engine can reverse them. Do not delete entities that existed before the import — only those created during it.

