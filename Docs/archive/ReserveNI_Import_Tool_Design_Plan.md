# ReserveNI Data Import Tool — Cursor Implementation Prompt

> **Cursor Prompt:**
>
> Build a data import tool for ReserveNI that allows venue owners to import client and booking data from previous providers (Fresha, Booksy, Vagaro, ResDiary, and others). The tool is a multi-step wizard with AI-assisted column mapping (using the OpenAI API with model `gpt-5.4-nano`), visual drag-and-drop column matching, data validation, and a safe import with undo capability.
>
> This tool is accessible from the dashboard at `/dashboard/import` and is available to admin users on all plan types including Appointments Light, Appointments, and Restaurant plans.

---

## OVERVIEW OF THE FIVE STEPS


| Step | Name     | Description                                                                 |
| ---- | -------- | --------------------------------------------------------------------------- |
| 1    | Upload   | User uploads one or more CSV files and labels them                          |
| 2    | Map      | AI auto-maps columns, user reviews and adjusts with drag-and-drop           |
| 3    | Decide   | User handles unmatched columns (ignore, create custom field, split/combine) |
| 4    | Validate | System checks for errors, duplicates, and format issues                     |
| 5    | Import   | Background import with progress, email confirmation, 24-hour undo           |


---

## DATABASE CHANGES

### import_sessions table

Tracks each import attempt from start to finish.

```sql
CREATE TABLE import_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES staff(id),

  status TEXT NOT NULL DEFAULT 'uploading',
  -- 'uploading' | 'mapping' | 'validating' | 'ready' | 'importing' |
  -- 'complete' | 'failed' | 'undone'

  detected_platform TEXT,
  -- 'fresha' | 'booksy' | 'vagaro' | 'resdiary' | 'unknown'

  -- Summary counts (populated after import)
  total_rows INT DEFAULT 0,
  imported_clients INT DEFAULT 0,
  imported_bookings INT DEFAULT 0,
  skipped_rows INT DEFAULT 0,
  updated_existing INT DEFAULT 0,

  -- Undo support
  undo_available_until TIMESTAMPTZ,
  undone_at TIMESTAMPTZ,

  -- AI mapping metadata
  ai_mapping_used BOOLEAN DEFAULT false,
  ai_model_used TEXT,

  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_import_sessions_venue ON import_sessions(venue_id);
```

### import_files table

Each uploaded CSV file in an import session.

```sql
CREATE TABLE import_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES import_sessions(id) ON DELETE CASCADE,
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,

  filename TEXT NOT NULL,
  file_type TEXT NOT NULL,
  -- 'clients' | 'bookings' | 'staff' | 'unknown'

  storage_path TEXT NOT NULL,
  -- Path in Supabase Storage where the raw CSV is stored

  row_count INT,
  column_count INT,
  headers TEXT[],
  sample_rows JSONB,
  -- First 5 rows as array of objects

  encoding TEXT DEFAULT 'utf-8',
  delimiter TEXT DEFAULT ',',

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_import_files_session ON import_files(session_id);
```

### import_column_mappings table

Stores the column mapping decisions for each file in an import session.

```sql
CREATE TABLE import_column_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id UUID NOT NULL REFERENCES import_files(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES import_sessions(id) ON DELETE CASCADE,

  source_column TEXT NOT NULL,
  -- The column name from the uploaded CSV, e.g. 'Mobile Number'

  target_field TEXT,
  -- The ReserveNI field to map to, e.g. 'phone'
  -- NULL if ignoring or creating a custom field

  action TEXT NOT NULL DEFAULT 'map',
  -- 'map' | 'ignore' | 'custom' | 'split'

  -- For 'custom' action
  custom_field_name TEXT,
  custom_field_type TEXT,
  -- 'text' | 'number' | 'date' | 'boolean'

  -- For 'split' action
  split_config JSONB,
  -- { "separator": " ", "parts": [{"field":"first_name"},{"field":"last_name"}] }

  -- AI mapping metadata
  ai_suggested BOOLEAN DEFAULT false,
  ai_confidence TEXT,
  -- 'high' | 'medium' | 'low'
  ai_reasoning TEXT,

  user_overridden BOOLEAN DEFAULT false,

  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_import_mappings_file ON import_column_mappings(file_id);
CREATE INDEX idx_import_mappings_session ON import_column_mappings(session_id);
```

### import_validation_issues table

Stores validation problems found during Step 4.

```sql
CREATE TABLE import_validation_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES import_sessions(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES import_files(id) ON DELETE CASCADE,

  row_number INT NOT NULL,
  severity TEXT NOT NULL,
  -- 'error' = row will be skipped | 'warning' = row will import with caveats

  issue_type TEXT NOT NULL,
  -- 'missing_required' | 'invalid_format' | 'duplicate_email' |
  -- 'duplicate_phone' | 'existing_client' | 'date_format_ambiguous' |
  -- 'phone_invalid' | 'email_invalid' | 'value_too_long'

  column_name TEXT,
  raw_value TEXT,
  message TEXT NOT NULL,
  resolution TEXT,

  user_decision TEXT,
  -- 'skip' | 'import_anyway' | 'update_existing'

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_import_issues_session ON import_validation_issues(session_id);
```

### import_records table

Links imported records back to their source for undo support.

```sql
CREATE TABLE import_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES import_sessions(id) ON DELETE CASCADE,
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,

  record_type TEXT NOT NULL,
  -- 'guest' | 'booking'

  record_id UUID NOT NULL,

  action TEXT NOT NULL,
  -- 'created' | 'updated'

  previous_data JSONB,
  -- For 'updated' records: original field values before import changed them

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_import_records_session ON import_records(session_id);
CREATE INDEX idx_import_records_record ON import_records(record_id);
```

### custom_client_fields table

Stores venue-specific custom fields created during import.

```sql
CREATE TABLE custom_client_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,

  field_name TEXT NOT NULL,
  field_key TEXT NOT NULL,
  field_type TEXT NOT NULL,
  -- 'text' | 'number' | 'date' | 'boolean'

  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(venue_id, field_key)
);
```

Custom field values are stored in a new column on the guests table:

```sql
ALTER TABLE guests ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}';
```

Apply standard venue-scoped RLS to all new tables.

---

## RESERVENI FIELD SCHEMA

### Client fields

```typescript
const CLIENT_FIELDS = [
  // Required
  { key: 'first_name', label: 'First Name', required: true, type: 'text',
    examples: ['Sarah', 'John', 'Emma'] },
  { key: 'last_name', label: 'Last Name', required: true, type: 'text',
    examples: ['Jones', 'Smith', 'Brown'] },

  // Contact
  { key: 'email', label: 'Email Address', required: false, type: 'email',
    examples: ['sarah@email.com'] },
  { key: 'phone', label: 'Phone Number', required: false, type: 'phone',
    examples: ['+447891234567', '07891234567'] },

  // Personal
  { key: 'date_of_birth', label: 'Date of Birth', required: false, type: 'date',
    examples: ['15/03/1985', '1985-03-15'] },
  { key: 'gender', label: 'Gender', required: false, type: 'text',
    examples: ['Female', 'Male', 'Non-binary'] },

  // Marketing
  { key: 'marketing_consent', label: 'Marketing Consent', required: false,
    type: 'boolean', examples: ['Yes', 'No', 'true', 'false', '1', '0'] },

  // History
  { key: 'first_visit_date', label: 'First Visit Date', required: false, type: 'date' },
  { key: 'last_visit_date', label: 'Last Visit Date', required: false, type: 'date' },
  { key: 'total_visits', label: 'Total Visits', required: false, type: 'number' },
  { key: 'total_spent', label: 'Total Spent (£)', required: false, type: 'currency' },

  // Notes and tags
  { key: 'notes', label: 'Client Notes', required: false, type: 'text' },
  { key: 'tags', label: 'Tags', required: false, type: 'tags',
    examples: ['VIP', 'VIP,Regular', 'Allergy'] },
];
```

### Booking fields

```typescript
const BOOKING_FIELDS = [
  { key: 'client_email', label: 'Client Email', required: true, type: 'email' },
  { key: 'client_phone', label: 'Client Phone', required: false, type: 'phone' },
  { key: 'client_name', label: 'Client Name', required: false, type: 'text' },
  { key: 'service_name', label: 'Service Name', required: false, type: 'text' },
  { key: 'staff_name', label: 'Staff Member', required: false, type: 'text' },
  { key: 'booking_date', label: 'Booking Date', required: true, type: 'date' },
  { key: 'booking_time', label: 'Booking Time', required: true, type: 'time' },
  { key: 'duration_minutes', label: 'Duration (minutes)', required: false, type: 'number' },
  { key: 'status', label: 'Booking Status', required: false, type: 'text' },
  { key: 'price', label: 'Price (£)', required: false, type: 'currency' },
  { key: 'notes', label: 'Booking Notes', required: false, type: 'text' },
];
```

---

## KNOWN PLATFORM COLUMN SIGNATURES

Use these to auto-detect the source platform without calling the AI. Detection requires matching 3 or more signature columns.

```typescript
const PLATFORM_SIGNATURES = {
  fresha: {
    columns: ['Client First Name', 'Client Last Name', 'Client Mobile',
              'Client Email', 'Appointment Date', 'Appointment Time',
              'Service Name', 'Staff Member'],
    filenames: ['fresha', 'shedul'],
  },
  booksy: {
    columns: ['Customer Name', 'Customer Phone', 'Customer Email',
              'Service', 'Employee', 'Date', 'Start Time'],
    filenames: ['booksy'],
  },
  vagaro: {
    columns: ['First Name', 'Last Name', 'Cell Phone', 'Email',
              'Service Date', 'Service Name', 'Provider'],
    filenames: ['vagaro'],
  },
  resdiary: {
    columns: ['Guest Name', 'Guest Email', 'Guest Phone', 'Covers',
              'Reservation Date', 'Reservation Time', 'Table'],
    filenames: ['resdiary', 'res_diary'],
  },
  timely: {
    columns: ['Client first name', 'Client last name', 'Client email',
              'Mobile', 'Appointment start', 'Service'],
    filenames: ['timely'],
  },
};
```

When a platform is detected, apply a known mapping template directly without calling the AI:

```typescript
const PLATFORM_MAPPINGS = {
  fresha_clients: {
    'Client First Name': 'first_name',
    'Client Last Name': 'last_name',
    'Client Mobile': 'phone',
    'Client Email': 'email',
    'Date of Birth': 'date_of_birth',
    'Client Notes': 'notes',
    'Total Visits': 'total_visits',
    'Marketing Consent': 'marketing_consent',
    'Tags': 'tags',
  },
  fresha_bookings: {
    'Client Email': 'client_email',
    'Appointment Date': 'booking_date',
    'Appointment Time': 'booking_time',
    'Service Name': 'service_name',
    'Staff Member': 'staff_name',
    'Duration': 'duration_minutes',
    'Status': 'status',
    'Price': 'price',
  },
  // Add equivalent templates for booksy, vagaro, resdiary, timely
};
```

When a template is applied, show the user: 'We detected a Fresha export and applied our standard mapping. Review and adjust if needed.' Mark these mappings with `ai_suggested: false`.

---

## AI COLUMN MAPPING (OpenAI API)

Use the OpenAI API for column mapping when the platform is unknown or columns remain unmatched after applying a platform template.

### Model and setup

Use the model `**gpt-5.4-nano**` for cost efficiency. This is a structured JSON output task — classification and data extraction — which is exactly what GPT-5.4 nano is optimised for.

```bash
npm install openai
```

Add environment variable:

```
OPENAI_API_KEY=sk-xxxxx
```

### API endpoint

Create `POST /api/import/ai-map-columns` (authenticated, admin only):

**Request body:**

```typescript
{
  fileId: string;
  headers: string[];
  sampleRows: Record<string, string>[];
  fileType: 'clients' | 'bookings';
  detectedPlatform?: string;
}
```

### OpenAI prompt

```typescript
const systemPrompt = `You are a data mapping assistant for ReserveNI, a booking platform.
Your job is to map columns from a CSV export of another booking platform to ReserveNI's data schema.
You must return ONLY valid JSON with no additional text, explanation, or markdown.`;

const userPrompt = `
The user has uploaded a CSV file containing ${fileType} data.
${detectedPlatform ? `We believe this is from ${detectedPlatform}.` : 'The source platform is unknown.'}

CSV column headers:
${JSON.stringify(headers)}

Sample data (first 5 rows):
${JSON.stringify(sampleRows, null, 2)}

ReserveNI target fields:
${JSON.stringify(targetFields, null, 2)}

For each CSV column, suggest a mapping to one of the ReserveNI target fields.
If a column does not match any target field, suggest ignoring it.
If a column appears to contain multiple pieces of information (e.g. "Full Name"), suggest splitting it.

Return a JSON array with one object per CSV column:
[
  {
    "source_column": "exact column name from CSV",
    "action": "map" | "ignore" | "split",
    "target_field": "reserveni field key or null",
    "confidence": "high" | "medium" | "low",
    "reasoning": "brief explanation in plain English",
    "split_config": {
      "separator": " ",
      "parts": [{"field": "first_name"}, {"field": "last_name"}]
    }
  }
]

Rules:
- Only suggest target fields that exist in the provided field list
- A target field can only be the destination of ONE source column
- If two columns could map to the same field, pick the better one and ignore the other
- Confidence should be 'high' if clearly matching, 'medium' if reasonable guess, 'low' if uncertain
- Prefer 'ignore' over a low-confidence mapping for columns you are unsure about
`;
```

### Calling the API

```typescript
const completion = await openai.chat.completions.create({
  model: 'gpt-5.4-nano',
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ],
  response_format: { type: 'json_object' },
  temperature: 0,
});

const mappings = JSON.parse(completion.choices[0].message.content);

// Validate: ensure all target_field values exist in the schema
// Ensure no target field is used more than once
// Fall back to 'ignore' for any invalid suggestions
// Store each mapping in import_column_mappings with ai_suggested: true
```

Handle OpenAI API errors gracefully. If the AI call fails, log the error and proceed with empty mappings so the user can map manually. Never block the import flow because the AI is unavailable.

---

## API ENDPOINTS

### Import session management


| Method | Endpoint                           | Description                      |
| ------ | ---------------------------------- | -------------------------------- |
| POST   | `/api/import/sessions`             | Create new import session        |
| GET    | `/api/import/sessions`             | List all sessions for this venue |
| GET    | `/api/import/sessions/[sessionId]` | Full session details             |
| DELETE | `/api/import/sessions/[sessionId]` | Cancel and clean up session      |


### File upload


| Method | Endpoint                                          | Description              |
| ------ | ------------------------------------------------- | ------------------------ |
| POST   | `/api/import/sessions/[sessionId]/files`          | Upload a CSV file        |
| PATCH  | `/api/import/sessions/[sessionId]/files/[fileId]` | Update file type label   |
| DELETE | `/api/import/sessions/[sessionId]/files/[fileId]` | Remove file from session |


The upload endpoint: accepts multipart form, stores in Supabase Storage at `imports/[venueId]/[sessionId]/[filename]`, parses CSV, extracts headers and first 5 rows, runs platform detection, returns file record.

### Column mapping


| Method | Endpoint                                                 | Description               |
| ------ | -------------------------------------------------------- | ------------------------- |
| POST   | `/api/import/sessions/[sessionId]/files/[fileId]/ai-map` | Trigger AI mapping        |
| PUT    | `/api/import/sessions/[sessionId]/mappings/[mappingId]`  | Update single mapping     |
| POST   | `/api/import/sessions/[sessionId]/mappings/bulk`         | Save all mappings at once |


### Validation


| Method | Endpoint                                              | Description                        |
| ------ | ----------------------------------------------------- | ---------------------------------- |
| POST   | `/api/import/sessions/[sessionId]/validate`           | Run full validation                |
| PATCH  | `/api/import/sessions/[sessionId]/issues/[issueId]`   | Record user decision               |
| PATCH  | `/api/import/sessions/[sessionId]/issues/bulk-decide` | Apply decision to all of same type |


Validation runs as a background job for large files and returns a job ID for polling.

### Import execution


| Method | Endpoint                                    | Description           |
| ------ | ------------------------------------------- | --------------------- |
| POST   | `/api/import/sessions/[sessionId]/execute`  | Start the import      |
| GET    | `/api/import/sessions/[sessionId]/progress` | Poll for progress     |
| POST   | `/api/import/sessions/[sessionId]/undo`     | Undo completed import |


---

## STEP-BY-STEP UI IMPLEMENTATION

Add 'Import Data' to the dashboard sidebar under Settings, admin users only.

### Step 1: Upload

**Route:** `/dashboard/import/[sessionId]/upload`

Large drag-and-drop zone accepting .csv files only. Support multiple file uploads. Show a card per file containing: filename, row count, column count, file type selector (Client list / Booking history / Not sure), detected platform badge, preview button (shows first 10 rows), remove button.

Show a 'What can I import?' expandable help section explaining supported platforms and file types.

'Continue' button enabled when at least one file is uploaded and labelled.

### Step 2: Map Columns

**Route:** `/dashboard/import/[sessionId]/map`

**Layout:** Two-panel layout side by side.

**Left panel — Your columns:**

Each source column shown as a draggable card:

```
┌─────────────────────────────────┐
│ ⠿  Client First Name            │  ← drag handle
│                                 │
│ Sarah, John, Emma, Michael...   │  ← sample values
│                                 │
│ ● High confidence → First Name  │  ← AI suggestion + confidence colour
└─────────────────────────────────┘
```

Confidence colours: Green = high, Amber = medium, Red = low or no suggestion, Grey = ignored.

Cards grouped into: Mapped (green tint), Needs attention (amber tint), Ignored (grey, collapsed).

**Right panel — ReserveNI fields:**

Each target field shown as a drop zone:

```
┌─────────────────────────────────┐
│ First Name                *     │  ← asterisk = required
│ text • examples: Sarah, John    │
│                                 │
│ ┌───────────────────────────┐   │
│ │ Client First Name     [×] │   │  ← mapped source column
│ └───────────────────────────┘   │
└─────────────────────────────────┘
```

Empty drop zones show a dashed border with 'Drop a column here'. At the bottom: a 'Create custom field' drop zone.

**Three interaction methods (all equivalent):**

1. Drag column card from left, drop onto field on right
2. Click column to select, then click field to connect
3. Click the AI suggestion badge to accept it

Visual connection lines drawn between matched pairs. Lines animate on connect and disconnect.

On tablets, replace drag-and-drop with tap-to-select-then-tap-to-connect. Show clear selected state feedback.

**File tabs** if multiple files in the session.

**AI banner:** 'We auto-mapped [N] of [total] columns using AI. Review the suggestions below and adjust if anything looks wrong.' Or: 'We detected a Fresha export and applied our standard mapping.'

**Continue** enabled when required fields (first_name, last_name for clients; client_email or client_phone AND booking_date AND booking_time for bookings) are all mapped.

### Step 3: Review Columns

**Route:** `/dashboard/import/[sessionId]/review`

A list of all columns with current status and available actions:

```
Column name    |  Sample values           |  Current mapping  |  Actions
──────────────────────────────────────────────────────────────────────────
Loyalty Points │  450, 1200, 0, 320       │  [Unmapped]       │  [Map ▾] [Ignore] [Create field]
Full Name      │  Sarah Jones, John Smith  │  [Split detected] │  [Split into First + Last ▾] [Map ▾]
Internal ID    │  CL001, CL002, CL003      │  [Ignored]        │  [Unignore]
```

**Create custom field flow:**

```
Field name: [Loyalty Points        ]
Data type:  [Number ▾]
Preview:    Values like '450', '1200' will be stored as numbers
[Create and map]
```

**Split column flow:**

```
'Full Name' → Split into:
  Part 1: [First Name ▾]
  Part 2: [Last Name ▾]
  Separator: [Space ▾]

Preview:
  'Sarah Jones' → First: Sarah | Last: Jones
  'John Smith'  → First: John  | Last: Smith
  'Emma'        → First: Emma  | Last: (empty)
[Apply split]
```

Continue always enabled — show warning if any columns are still undecided.

### Step 4: Validate

**Route:** `/dashboard/import/[sessionId]/validate`

Trigger validation automatically on entering this step. Show loading spinner: 'Checking your data...'

**Validation summary card:**

```
Validation Complete

✓ 847 rows ready to import
⚠ 12 warnings (rows will import with caveats)
✗ 8 errors (rows will be skipped)

Clients: 839 new, 8 already exist in ReserveNI
```

**Issues grouped by type:**

```
✗ Missing required field — 3 rows (will be skipped)
Row 12: First Name is empty    [View row]
Row 45: Last Name is empty     [View row]
[Skip all 3 rows]
```

```
⚠ Client already exists — 8 rows
These email addresses already have client records in ReserveNI.
Row 7:  sarah@email.com → matches Sarah Jones (5 visits)  [Update] [Skip]
[Update all existing clients]  [Skip all duplicates]
```

```
⚠ Date format ambiguous — 15 rows
'03/04/2025' — is this 3 April or 4 March?
[DD/MM/YYYY (3 April)]  [MM/DD/YYYY (4 March)]
```

**Issue resolution options:**


| Issue type             | Options                                        |
| ---------------------- | ---------------------------------------------- |
| Missing required field | Skip row                                       |
| Existing client        | Update existing / Skip / Import as new         |
| Invalid email          | Import without email / Skip row                |
| Invalid phone          | Import without phone / Skip row                |
| Ambiguous date         | Choose format (applies to all ambiguous dates) |
| Value too long         | Truncate / Skip row                            |


'Proceed to Import' button shows final counts: 'Import 839 new clients, update 8 existing, skip 3 rows.'

### Step 5: Import

**Route:** `/dashboard/import/[sessionId]/importing`

Trigger import execution immediately on entering this step.

**During import:**

```
Importing your data...

[████████████████░░░░░░░░░░░░░░] 62%

523 of 847 rows processed
Clients: 515 created, 8 updated
Errors: 0

Estimated time remaining: 12 seconds
```

User can navigate away — import continues in the background. Email sent on completion.

**Import complete:**

```
Import Complete ✓

839 clients imported
8 existing clients updated
3 rows skipped (missing required fields)

[View your clients →]

Made a mistake?
[Undo this import]  ← available for 24 hours

Download import report (CSV)
```

Undo confirmation: 'This will remove all 839 imported clients and revert the 8 updated clients to their previous state. This cannot be undone. [Confirm undo] [Cancel]'

---

## IMPORT EXECUTION ENGINE

Runs as a background process. Use Vercel background functions or a Supabase Edge Function with a long timeout.

### Processing order

1. Process client files first (bookings reference clients).
2. For each data row:
  - Apply column mappings and split configurations
  - Transform data types (parse dates, normalise phones to E.164, parse booleans)
  - Apply validation decisions for this row
  - Skip rows with unresolved 'error' issues
  - Check for existing client by email → phone → full name
  - Create or update guest record based on user decision
  - Store custom field values in `guest.custom_fields` JSONB
  - Log to import_records with action 'created' or 'updated'
  - Update session progress counters
3. Process booking files after clients complete.
  - Match each booking row to a client via email, phone, or name
  - Skip booking if no client found
  - Create booking record and log to import_records
4. Mark session as 'complete'. Set `undo_available_until = now() + 24 hours`.
5. Send completion email to venue owner.

### Phone number normalisation

Use `libphonenumber-js` to normalise to E.164 format:

- `07891234567` → `+447891234567`
- `00447891234567` → `+447891234567`
- `+44 7891 234567` → `+447891234567`

If a number cannot be parsed as a valid UK number, store as-is and flag with severity 'warning'.

### Date parsing

Use `date-fns`. Try formats in order: `dd/MM/yyyy`, `MM/dd/yyyy`, `yyyy-MM-dd`, `dd-MM-yyyy`, `d MMMM yyyy`, `MMMM d, yyyy`. For ambiguous dates, use the user's format decision from Step 4.

### Boolean normalisation

- True: `yes`, `true`, `1`, `y`, `on`, `opted in` (case insensitive)
- False: `no`, `false`, `0`, `n`, `off`, `opted out`, `` (empty)

---

## COMPLETION EMAIL

**Subject:** 'Your data import to Reserve NI is complete'

**Body:**

```
Hi [name],

Your data import has finished. Here's what was imported:

✓ [N] clients imported
✓ [N] existing clients updated
✗ [N] rows skipped

[View your clients →]

If you notice anything wrong, you can undo this import within the next 24 hours
from your import history page.

[Undo this import →]   (available until [datetime])

Reserve NI
```

---

## IMPORT HISTORY PAGE

At `/dashboard/import`, show all past import sessions:

```
Import History                                    [+ Start New Import]

┌──────────────────────────────────────────────────────────────────┐
│ 15 March 2026, 2:34pm          Complete              [Report]    │
│ Fresha export • 847 clients, 2,341 bookings imported             │
│ Undo available until 16 March 2026, 2:34pm          [Undo]       │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ 10 February 2026, 11:12am      Complete              [Report]    │
│ Booksy export • 120 clients imported                             │
│ Undo expired                                                     │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ 3 January 2026, 4:45pm         Cancelled                         │
│ Upload cancelled before completion                               │
└──────────────────────────────────────────────────────────────────┘
```

[Report] opens the full import report with a downloadable CSV of all imported, updated, and skipped rows.

---

## TESTING SCENARIOS

1. **FRESHA CLIENT IMPORT** — Upload a Fresha client CSV → platform detected → standard mapping applied without AI → all columns mapped correctly → 0 validation errors → import completes → clients appear in dashboard → undo works within 24 hours.
2. **BOOKSY BOOKING IMPORT** — Upload Booksy booking history CSV → platform detected → mapping applied → bookings linked to existing clients by email → bookings appear in client history.
3. **UNKNOWN PLATFORM** — Upload CSV with unrecognised column names → AI mapping triggered → suggestions shown with confidence levels → user adjusts via drag-and-drop → saves mapping → continues.
4. **AI FALLBACK** — Simulate OpenAI API failure → tool continues without AI → user maps manually → import completes normally. AI failure must never block the flow.
5. **MULTIPLE FILES** — Upload two files (client list and booking history) → each file has its own mapping tab → both mapped and validated → import processes clients first then bookings.
6. **DUPLICATE DETECTION** — Import file contains 10 emails already in ReserveNI → validation flags all 10 → user selects 'Update all existing' → records updated → import_records logs previous values → undo reverts all 10 to original values.
7. **CUSTOM FIELD CREATION** — CSV has a 'Loyalty Points' column with no matching field → user creates custom field of type Number → values stored in `guest.custom_fields` → visible in client detail view.
8. **FULL NAME SPLIT** — CSV has single 'Name' column → system detects split opportunity → user confirms split into First + Last → preview shows correct split → import creates clients with correct separate names.
9. **DATE FORMAT RESOLUTION** — CSV has ambiguous dates ('03/04/2025') → validation flags as ambiguous → user selects DD/MM/YYYY → all dates parsed correctly.
10. **UNDO** — Complete full import of 200 clients → undo within 24 hours → all 200 created clients removed → updated clients reverted → session marked undone.
11. **UNDO EXPIRED** — Attempt undo after 24 hours → undo button not shown → API returns 403 if called directly.
12. **LARGE FILE PERFORMANCE** — Upload CSV with 5,000 rows → upload completes in reasonable time → AI responds within 10 seconds → validation processes all rows → progress bar updates throughout.
13. **MOBILE AND TABLET** — All five steps work on tablet. Drag-and-drop works via touch. Preview tables scroll horizontally on mobile. All buttons meet touch target size requirements.
14. **RESTAURANT VENUE** — Restaurant venue can import clients. The word 'Guest' is used instead of 'Client' throughout the import tool for restaurant venues, consistent with the venue's terminology settings.

---

## CRITICAL RULES

1. Never delete original uploaded CSV files from Supabase Storage until the import session is manually deleted or the undo window expires. They are the source of truth.
2. The AI mapping step must never block the user from proceeding. If the OpenAI API is unavailable, fall back gracefully to empty mappings and allow manual mapping.
3. Every import must be fully undoable within 24 hours. The import_records table must log every created and updated record with sufficient data to reverse the change.
4. Booking imports must always process after client imports in the same session. Bookings reference clients by email or phone.
5. Phone numbers must be normalised to E.164 format before storage. Invalid numbers are stored as-is with a warning flag — not silently dropped.
6. The drag-and-drop interface must work on both mouse and touch devices. Use dnd-kit (already used in the project for the calendar) for consistent touch and mouse handling.
7. A target field can only be mapped from ONE source column. If a user drops a second column onto an already-mapped field, show a confirmation: 'This field is already mapped to [Column A]. Replace it with [Column B]?' The replaced column returns to unmapped state.
8. The import tool is admin-only. Staff members without admin role cannot access `/dashboard/import` or any import API endpoint. Return 403 for non-admin access attempts.
9. All import data is strictly scoped to the venue. A venue can only see, access, and import into their own records. Cross-venue data access must be impossible.

