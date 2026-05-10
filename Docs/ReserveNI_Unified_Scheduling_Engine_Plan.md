# ReserveNI - Unified Scheduling Engine Implementation Plan

**Complete Phase 1 + Phase 2 Build Guide for Cursor AI Agents**
**Converting from Models B/C/D/E to a Single Unified Scheduling System**
**April 2026 | Version 1.1**

---

## DOCUMENT OVERVIEW

This document contains everything a Cursor AI agent needs to convert ReserveNI from separate booking models (B, C, D, E) into a single unified scheduling engine, while preserving Model A (restaurants) completely unchanged. It is designed to be followed sequentially as a series of numbered prompts. By the end, all functionality should be fully implemented and ready for human testing.

**What stays the same:** Model A (table_reservation) - the restaurant system with its availability engine, table management, floor plan, day sheet, and all existing restaurant functionality. Restaurant-facing behaviour and routes are preserved; shared tables may gain nullable columns used only by unified scheduling (see §2.7).

**What changes:** Models B, C, D, and E are replaced by a single "Unified Scheduling Engine" (USE) that handles appointments, events, classes, and resources through configuration. The existing Model B (practitioner appointment) code is the foundation - it is extended and generalised rather than rewritten.

### Scope and product intent

**In scope:** A single configurable engine and product surface for typical appointment-style businesses (solo or multi-practitioner, ticketed events/classes with sessions, bookable resources), plus the pricing, SMS allowance, comms lifecycle, dashboard, public booking flow, and onboarding described in this document.

**Out of scope for this plan (future extensions):** Multi-location / multi-venue organisation accounts beyond a placeholder `organisation_id`; waitlists; service packages or bundles; medically recurring patient series; arbitrary multi-resource dependencies (e.g. "staff + room" required together); complex group policies beyond a reserved `group_booking_id` on `bookings`. Those require separate specifications.

**"Full functionality" in this document means:** end-to-end operation for the verticals and flows explicitly listed here, not every possible appointment business model worldwide. Version 1.1 adds explicit lifecycle, timezone, resource, RLS, Stripe, and SMS-segment rules so implementers do not have to improvise in high-risk areas.

---

## TABLE OF CONTENTS

1. Pricing & SMS Billing Architecture
2. Database Schema (complete)
   - 2.4 includes Row-level security (must align with Reserve NI `staff` ↔ auth pattern)
   - 2.6 Event sessions & recurrence materialisation
   - 2.7 Shared schema compatibility & Model A regression checks
3. Unified Availability Engine (granular specification)
   - 3.0 Venue timezone & wall-clock rules
   - 3.5 Variable-length resource bookings
   - 3.6 Processing time & overlap rules
4. Communication Engine (granular specification with all 8 message types)
   - 4.5 Timezone for crons & scheduled messages
   - 4.6 SMS segment counting & billing accuracy
5. SMS Usage Tracking & Billing
   - 5.4 Stripe metered overage: subscription items & failure handling
6. Dashboard Architecture
7. Booking Page Architecture
   - 7.4 Group & multi-service bookings (Phase 2)
8. Onboarding Wizard
9. Settings & Configuration
10. Cursor Prompts (numbered sequentially)
11. Testing Protocol

---

## 1. PRICING & SMS BILLING

### 1.1 The Two Tiers

**Standard - £20/month per bookable calendar**
- All features included (booking, deposits, reminders, client records, reporting)
- Email AND SMS communications
- 200 SMS messages included per calendar per month (e.g. 3 calendars = 600 SMS/month)
- Additional SMS charged at 5p each, billed at end of month
- Email support

**Business - £79/month flat (restaurants MUST choose this)**
- Unlimited bookable calendars
- All features included
- 800 SMS messages included per month
- Additional SMS charged at 5p each, billed at end of month
- Table management with timeline grid and floor plan (restaurants only)
- Priority support

### 1.2 SMS Economics

Twilio charges approximately £0.035-0.04 per outbound SMS to UK numbers. At 5p (£0.05) per overage SMS to the customer, the margin is approximately £0.01-0.015 per message. The included allowances (200 per calendar on Standard, 800 on Business) are generous enough that most businesses won't exceed them - the overage charge exists as a safety net, not a revenue centre.

A typical solo practitioner with 20 appointments per week generates approximately:
- 20 confirmations (SMS) = 20
- 20 primary reminders (SMS) = 20
- 20 final nudges (SMS) = 20
- ~2 cancellations (email only) = 0
- ~1 no-show (email only) = 0
- ~18 post-visit (email only) = 0
Total: ~60 SMS per month. Well within the 200 allowance.

A busy salon with 4 stylists and 80 appointments per week:
- 80 confirmations = 80
- 80 primary reminders = 80
- 80 final nudges = 80
Total: ~240 SMS per month across 4 calendars (800 SMS allowance). Well within limits.

### 1.3 Stripe Products Required

Create these in the Stripe Dashboard before implementation:

**Product: "Reserve NI Standard"**
- Price: £20.00 GBP, recurring monthly, per unit (quantity = calendar count)
- Price ID → `STRIPE_STANDARD_PRICE_ID`

**Product: "Reserve NI Business"**
- Price: £79.00 GBP, recurring monthly, flat
- Price ID → `STRIPE_BUSINESS_PRICE_ID`

**Product: "Reserve NI SMS Overage"**
- Price: £0.05 GBP, metered usage (this allows billing variable amounts at month end)
- Price ID → `STRIPE_SMS_OVERAGE_PRICE_ID`

**Webhook endpoint:**
- URL: `{domain}/api/webhooks/stripe-onboarding`
- Events: checkout.session.completed, customer.subscription.updated, invoice.payment_succeeded, invoice.payment_failed, customer.subscription.deleted, invoice.upcoming
- Signing secret → `STRIPE_ONBOARDING_WEBHOOK_SECRET`

### 1.4 Environment Variables

```
STRIPE_STANDARD_PRICE_ID=price_xxxxx
STRIPE_BUSINESS_PRICE_ID=price_xxxxx
STRIPE_SMS_OVERAGE_PRICE_ID=price_xxxxx
STRIPE_ONBOARDING_WEBHOOK_SECRET=whsec_xxxxx
```

---

## 2. DATABASE SCHEMA

### 2.1 Changes to Existing Tables

#### venues table - new/modified columns

```sql
-- Run as a single migration
-- All defaults match existing restaurant data so no existing records are broken

ALTER TABLE venues ADD COLUMN IF NOT EXISTS booking_model TEXT NOT NULL DEFAULT 'table_reservation';
-- 'table_reservation' = restaurant (Model A, unchanged)
-- 'unified_scheduling' = everything else (replaces models B/C/D/E)

ALTER TABLE venues ADD COLUMN IF NOT EXISTS business_type TEXT NOT NULL DEFAULT 'restaurant';
-- Specific type: 'restaurant', 'barber', 'physiotherapist', 'escape_room', 'yoga_studio', etc.

ALTER TABLE venues ADD COLUMN IF NOT EXISTS business_category TEXT NOT NULL DEFAULT 'hospitality';
-- Broad grouping: 'hospitality', 'beauty_grooming', 'health_wellness', 'fitness', 'experiences', etc.

ALTER TABLE venues ADD COLUMN IF NOT EXISTS pricing_tier TEXT NOT NULL DEFAULT 'business';
-- 'standard', 'business', 'founding'

ALTER TABLE venues ADD COLUMN IF NOT EXISTS plan_status TEXT NOT NULL DEFAULT 'active';
-- 'active', 'past_due', 'cancelled', 'trialing'

ALTER TABLE venues ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS stripe_subscription_item_id TEXT;
-- Needed for updating quantity on Standard tier subscriptions

ALTER TABLE venues ADD COLUMN IF NOT EXISTS stripe_sms_subscription_item_id TEXT;
-- Subscription item id for STRIPE_SMS_OVERAGE_PRICE_ID (metered). Distinct from quantity line item; see §5.4.

ALTER TABLE venues ADD COLUMN IF NOT EXISTS founding_free_period_ends_at TIMESTAMPTZ;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS onboarding_step INT DEFAULT 0;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false;

ALTER TABLE venues ADD COLUMN IF NOT EXISTS terminology JSONB DEFAULT '{
  "client": "Guest",
  "clients": "Guests", 
  "booking": "Reservation",
  "bookings": "Reservations",
  "staff_member": "Staff",
  "staff_members": "Staff",
  "no_show": "No-show",
  "service": "Service",
  "services": "Services"
}';

ALTER TABLE venues ADD COLUMN IF NOT EXISTS calendar_count INT DEFAULT 1;
-- Current paid calendars (Standard tier). NULL for Business tier (unlimited).

ALTER TABLE venues ADD COLUMN IF NOT EXISTS sms_monthly_allowance INT DEFAULT 800;
-- 200 per calendar on Standard (auto-calculated), 800 flat on Business

ALTER TABLE venues ADD COLUMN IF NOT EXISTS organisation_id UUID;
-- Future: multi-venue grouping

ALTER TABLE venues ADD COLUMN IF NOT EXISTS notification_settings JSONB DEFAULT '{
  "confirmation_enabled": true,
  "confirmation_channels": ["email", "sms"],
  "reminder_1_enabled": true,
  "reminder_1_hours_before": 24,
  "reminder_1_channels": ["email", "sms"],
  "reminder_2_enabled": true,
  "reminder_2_hours_before": 2,
  "reminder_2_channels": ["sms"],
  "reschedule_notification_enabled": true,
  "cancellation_notification_enabled": true,
  "no_show_notification_enabled": true,
  "post_visit_enabled": true,
  "post_visit_timing": "4_hours_after",
  "daily_schedule_enabled": false,
  "staff_new_booking_alert": true,
  "staff_cancellation_alert": true
}';
```

**Venue timezone (use existing column):** The `venues` table already includes `timezone` (IANA identifier, e.g. `Europe/London`). Do **not** introduce a second timezone field. Unified scheduling, availability, crons, and guest-facing copy must resolve “today”, reminder windows, and post-visit cutoffs in **venue local time** using `venues.timezone`. See §3.0.

#### bookings table - new columns for unified scheduling

```sql
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS calendar_id UUID;
-- FK to unified_calendars. NULL for restaurant bookings (they use existing table/service system).

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS service_item_id UUID;
-- FK to service_items (the specific service booked). NULL for restaurants.

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS group_booking_id UUID;
-- Links multi-service bookings together. All bookings in a group share this ID.

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS final_reminder_sent_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS post_visit_sent_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reschedule_notification_sent_at TIMESTAMPTZ;

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS capacity_used INT DEFAULT 1;
-- For events/classes: number of tickets/spots this booking consumes. Default 1 for appointments.

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS ticket_type_id UUID;
-- Optional FK for event ticket selection. Prefer referencing service_items(id) where item_type = 'ticket'
-- if ticket types are modelled only as service_items; use a legacy ticket_types table only if it still exists in the DB.
```

### 2.2 New Tables - Unified Scheduling

#### unified_calendars - the core entity that replaces practitioners, events, classes, and resources

```sql
CREATE TABLE unified_calendars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  
  -- Identity
  name TEXT NOT NULL,                          -- "Sarah", "Court 1", "Vinyasa Yoga", "Escape Room"
  slug TEXT,                                   -- for personal booking links: /book/venue/sarah
  description TEXT,
  photo_url TEXT,
  colour TEXT DEFAULT '#3B82F6',               -- calendar colour coding in the UI
  
  -- Type
  calendar_type TEXT NOT NULL DEFAULT 'practitioner',
  -- 'practitioner' = one person (barber, physio, trainer)
  -- 'event' = ticketed experience (escape room, tour, workshop)
  -- 'class' = recurring group session (yoga, spin, dance)
  -- 'resource' = bookable facility (court, room, equipment)
  
  -- Capacity
  capacity INT NOT NULL DEFAULT 1,
  -- practitioner: always 1 (one client at a time, unless parallel_clients > 1)
  -- event: total tickets per session (e.g. 6 for escape room)
  -- class: spots per session (e.g. 20 for yoga class)
  -- resource: always 1 (one booking at a time)
  
  parallel_clients INT DEFAULT 1,
  -- For practitioners who can serve multiple clients simultaneously
  -- (e.g. a nail tech doing 2 clients at once). Default 1. Max = capacity.
  
  -- Availability
  working_hours JSONB NOT NULL DEFAULT '{}',
  -- {
  --   "mon": [{"start": "09:00", "end": "17:00"}],
  --   "tue": [{"start": "09:00", "end": "17:00"}],
  --   ...
  -- }
  -- For events/classes: the schedule of when sessions run
  -- For resources: the hours the resource is available
  
  break_times JSONB DEFAULT '[]',
  -- [{"start": "13:00", "end": "14:00"}] - recurring daily breaks
  
  days_off JSONB DEFAULT '[]',
  -- Specific dates: ["2026-04-15", "2026-04-16"]
  -- Recurring: handled via working_hours (day not present = day off)
  
  -- Scheduling rules
  slot_interval_minutes INT DEFAULT 15,
  -- How bookings snap: 15 = bookable at :00, :15, :30, :45
  
  min_booking_notice_hours INT DEFAULT 1,
  -- How far in advance clients must book (e.g. 1 = at least 1 hour before)
  
  max_advance_booking_days INT DEFAULT 60,
  -- How far ahead clients can book (e.g. 60 = up to 60 days ahead)
  
  buffer_minutes INT DEFAULT 0,
  -- Time between appointments for cleanup/prep (added after each booking)
  
  -- For events/classes: recurring schedule
  recurrence_rule JSONB,
  -- For classes: {"type": "weekly", "days": [1, 3, 5], "time": "18:00", "duration_minutes": 60}
  -- For events: {"type": "weekly", "days": [6, 0], "times": ["14:00", "16:00"], "duration_minutes": 90}
  -- NULL for practitioners and resources (they use working_hours + service durations)
  
  -- For resources: booking constraints
  min_booking_minutes INT,         -- e.g. 60 (minimum 1 hour)
  max_booking_minutes INT,         -- e.g. 180 (maximum 3 hours)
  price_per_slot_pence INT,        -- e.g. 2000 (£20 per slot) - for resources with flat pricing
  
  -- Metadata
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  UNIQUE(venue_id, slug) -- slug must be unique within venue (when not null)
);

CREATE INDEX idx_unified_calendars_venue ON unified_calendars(venue_id) WHERE is_active = true;
CREATE INDEX idx_unified_calendars_venue_slug ON unified_calendars(venue_id, slug) WHERE slug IS NOT NULL;
```

#### service_items - services, treatments, ticket types, class types, resource slots

```sql
CREATE TABLE service_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  
  -- Identity
  name TEXT NOT NULL,                          -- "Men's Cut", "Adult Ticket", "Vinyasa Yoga", "1 Hour Court"
  description TEXT,
  
  -- Type (mirrors parent calendar type but allows a calendar to offer multiple service types)
  item_type TEXT NOT NULL DEFAULT 'service',
  -- 'service' = bookable treatment/service (appointment model)
  -- 'ticket' = event ticket type
  -- 'class_type' = class/session type
  -- 'resource_slot' = resource time slot type
  
  -- Timing
  duration_minutes INT NOT NULL,               -- length of the service/event/class/slot
  buffer_minutes INT DEFAULT 0,                -- override buffer per service (0 = use calendar default)
  processing_time_minutes INT DEFAULT 0,       -- e.g. hair colour processing: client doesn't need attention
  
  -- Pricing
  price_pence INT,                             -- NULL = "Price on consultation" or free
  deposit_pence INT,                           -- NULL = no deposit required
  price_type TEXT DEFAULT 'fixed',             -- 'fixed', 'from', 'free', 'consultation'
  -- 'fixed' = exact price shown
  -- 'from' = "From £X" (varies by details)
  -- 'free' = no charge
  -- 'consultation' = "Price on consultation"
  
  -- Capacity (for events and classes)
  capacity_per_session INT,                    -- override of calendar capacity for this specific service
  -- NULL = use calendar's default capacity
  
  -- Pre-appointment
  pre_appointment_instructions TEXT,           -- "Please arrive with clean nails"
  
  -- Display
  colour TEXT,                                 -- override calendar colour for this service
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_bookable_online BOOLEAN NOT NULL DEFAULT true,
  -- false = only bookable by staff (e.g. internal admin time)
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_service_items_venue ON service_items(venue_id) WHERE is_active = true;
```

#### calendar_service_assignments - which calendars offer which services

```sql
CREATE TABLE calendar_service_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id UUID NOT NULL REFERENCES unified_calendars(id) ON DELETE CASCADE,
  service_item_id UUID NOT NULL REFERENCES service_items(id) ON DELETE CASCADE,
  
  -- Optional overrides per calendar-service combination
  custom_duration_minutes INT,     -- this practitioner takes longer/shorter for this service
  custom_price_pence INT,          -- this practitioner charges differently
  
  UNIQUE(calendar_id, service_item_id)
);

CREATE INDEX idx_cal_service_calendar ON calendar_service_assignments(calendar_id);
CREATE INDEX idx_cal_service_service ON calendar_service_assignments(service_item_id);
```

#### calendar_blocks - blocked time (breaks, holidays, personal time)

```sql
CREATE TABLE calendar_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id UUID NOT NULL REFERENCES unified_calendars(id) ON DELETE CASCADE,
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  
  block_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  reason TEXT,                     -- "Lunch", "Meeting", "Holiday"
  block_type TEXT DEFAULT 'manual',
  -- 'manual' = staff created
  -- 'recurring_break' = auto-generated from break_times
  -- 'day_off' = auto-generated from days_off
  
  created_by UUID REFERENCES staff(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_calendar_blocks_lookup ON calendar_blocks(calendar_id, block_date);
```

#### event_sessions - individual instances of events/classes (generated from recurrence_rule or manually created)

```sql
CREATE TABLE event_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id UUID NOT NULL REFERENCES unified_calendars(id) ON DELETE CASCADE,
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  
  session_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  
  -- Capacity
  capacity_override INT,           -- NULL = use calendar default
  
  -- Status
  is_cancelled BOOLEAN DEFAULT false,
  cancel_reason TEXT,
  
  -- For non-recurring events: direct service_item link
  service_item_id UUID REFERENCES service_items(id),
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_event_sessions_lookup ON event_sessions(calendar_id, session_date);
CREATE INDEX idx_event_sessions_venue_date ON event_sessions(venue_id, session_date);
```

#### sms_usage - tracks SMS messages sent per venue per month

```sql
CREATE TABLE sms_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  
  billing_month DATE NOT NULL,     -- first day of the month: '2026-04-01'
  messages_sent INT NOT NULL DEFAULT 0,
  messages_included INT NOT NULL,  -- the venue's allowance for this month
  overage_count INT NOT NULL DEFAULT 0,
  overage_billed BOOLEAN DEFAULT false,
  overage_amount_pence INT DEFAULT 0,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  UNIQUE(venue_id, billing_month)
);

CREATE INDEX idx_sms_usage_venue_month ON sms_usage(venue_id, billing_month);
```

#### sms_log - individual SMS message log for tracking and debugging

```sql
CREATE TABLE sms_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES bookings(id),
  
  message_type TEXT NOT NULL,      -- 'confirmation', 'reminder_1', 'reminder_2', 'deposit_request', etc.
  recipient_phone TEXT NOT NULL,
  twilio_message_sid TEXT,
  status TEXT DEFAULT 'sent',      -- 'sent', 'delivered', 'failed', 'undelivered'
  segment_count INT DEFAULT 1,     -- number of SMS segments (long messages split into multiple)
  
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sms_log_venue_month ON sms_log(venue_id, sent_at);
```

### 2.3 Migration from Existing Model B Tables

The existing `practitioners` table data should be migrated into `unified_calendars`. The existing `offered_services` table data should be migrated into `service_items`. The existing `practitioner_services` should be migrated into `calendar_service_assignments`.

```sql
-- Migration script to convert existing Model B data
-- Run AFTER creating the new tables

-- Copy practitioners → unified_calendars
INSERT INTO unified_calendars (
  id, venue_id, name, slug, description, photo_url, colour,
  calendar_type, capacity, working_hours, break_times, days_off,
  slot_interval_minutes, buffer_minutes, sort_order, is_active, created_at
)
SELECT 
  id, venue_id, name, slug, NULL, NULL, '#3B82F6',
  'practitioner', 1, 
  COALESCE(working_hours, '{}'), 
  COALESCE(break_times, '[]'), 
  COALESCE(days_off, '[]'),
  15, 0, sort_order, is_active, created_at
FROM practitioners
ON CONFLICT (id) DO NOTHING;

-- Copy offered_services → service_items
INSERT INTO service_items (
  id, venue_id, name, description, item_type,
  duration_minutes, buffer_minutes, price_pence, deposit_pence,
  pre_appointment_instructions, colour, sort_order, is_active, created_at
)
SELECT 
  id, venue_id, name, description, 'service',
  duration_minutes, COALESCE(buffer_minutes, 0), price_pence, deposit_pence,
  pre_appointment_instructions, colour, sort_order, is_active, created_at
FROM offered_services
ON CONFLICT (id) DO NOTHING;

-- Copy practitioner_services → calendar_service_assignments
INSERT INTO calendar_service_assignments (
  id, calendar_id, service_item_id, custom_duration_minutes, custom_price_pence
)
SELECT 
  id, practitioner_id, service_id, custom_duration_minutes, custom_price_pence
FROM practitioner_services
ON CONFLICT (id) DO NOTHING;

-- Update existing bookings to reference unified_calendars
UPDATE bookings SET calendar_id = practitioner_id WHERE practitioner_id IS NOT NULL;
UPDATE bookings SET service_item_id = service_id WHERE service_id IS NOT NULL;
```

### 2.4 RLS Policies

**Critical:** Reserve NI links `staff` rows to Supabase Auth by **email**, not by `staff.id = auth.uid()`. Existing policies in this codebase use patterns such as:

`venue_id IN (SELECT venue_id FROM staff WHERE email = (auth.jwt() ->> 'email'))`

Implementers **must** mirror the same pattern for every new table (and verify against current migrations in `supabase/migrations/` before shipping). Using `auth.uid()` against `staff.id` will **break access** or create **security holes** unless your project has been migrated to a different mapping.

**Recommended policy shape:**

- **SELECT:** any staff member whose `staff.email` matches the JWT email and whose `staff.venue_id` matches the row’s `venue_id`.
- **INSERT / UPDATE / DELETE:** same venue scope; restrict destructive operations to `staff.role = 'admin'` where that matches existing app conventions (Reserve NI uses `staff_role`: `admin` | `staff`).

Apply the standard venue-scoped RLS pattern to all new tables:

```sql
-- Enable RLS on all new tables
ALTER TABLE unified_calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_service_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_log ENABLE ROW LEVEL SECURITY;

-- Example pattern for unified_calendars (repeat for each table, adjusting table name)
-- SELECT: all staff at the venue
CREATE POLICY "staff_select_unified_calendars"
  ON unified_calendars FOR SELECT
  USING (
    venue_id IN (
      SELECT venue_id FROM staff
      WHERE email = (auth.jwt() ->> 'email')
    )
  );

-- ALL for venue admins only (adjust if your product allows staff to edit calendars)
CREATE POLICY "admin_manage_unified_calendars"
  ON unified_calendars FOR ALL
  USING (
    venue_id IN (
      SELECT venue_id FROM staff
      WHERE email = (auth.jwt() ->> 'email')
        AND role = 'admin'
    )
  )
  WITH CHECK (
    venue_id IN (
      SELECT venue_id FROM staff
      WHERE email = (auth.jwt() ->> 'email')
        AND role = 'admin'
    )
  );

-- Repeat for: service_items, calendar_service_assignments, calendar_blocks, event_sessions, sms_usage, sms_log
-- sms_log / sms_usage may be read-only for admin-only depending on product policy
```

**Service role / RPC:** `increment_sms_usage` runs from trusted server code using the service role client. Do **not** expose it to anonymous clients. Grant `EXECUTE` only to `service_role` (or invoke exclusively from API routes using the service role key), consistent with other privileged functions.

### 2.5 Realtime Subscriptions

Enable Supabase Realtime on:
- `unified_calendars` (calendar changes reflect immediately)
- `bookings` (new bookings, status changes)
- `calendar_blocks` (blocked time appears on calendar)
- `event_sessions` (class/event cancellations)

### 2.6 Event sessions and recurrence materialisation

`recurrence_rule` on `unified_calendars` is the **definition**; `event_sessions` are the **bookable instances**. Implementations must not assume sessions exist without a defined generation strategy.

**Horizon:** Maintain sessions for a rolling window (recommended: **90 to 180 days** ahead of “today” in venue timezone). Regenerate or extend on a schedule (e.g. daily cron) and when staff edit `recurrence_rule` or create ad-hoc sessions.

**Generation (recommended algorithm):**

1. For each `unified_calendars` row where `calendar_type IN ('event', 'class')` and `recurrence_rule` is not null, expand occurrences for dates in `[today, today + horizon]` in **venue local calendar** (see §3.0).
2. For each theoretical occurrence `(calendar_id, local_date, start_time, end_time)`, upsert into `event_sessions` using a **stable recurrence key** (e.g. hash of `calendar_id|date|start_time|service_item_id`) so re-runs are idempotent.
3. **Staff edits:** Cancelling a single session sets `is_cancelled = true` on that `event_sessions` row; future generations must **skip** creating a new row for that key or must respect an `exceptions` list on the calendar JSON.
4. **Manual sessions:** Rows with no matching recurrence (one-off workshops) are inserted with `service_item_id` set; the generator must not delete them unless staff explicitly removes them.

**Optional schema additions (if not already present) for safer ops:**

- `event_sessions.recurrence_key TEXT UNIQUE` - idempotency key for upserts.
- `event_sessions.source TEXT` - `'recurring' | 'manual' | 'import'` to protect manual rows from deletion by the generator.

**Booking linkage:** Bookings for events/classes reference `event_sessions.id` (add `event_session_id UUID REFERENCES event_sessions(id)` on `bookings` if not already implied by existing design) in addition to `calendar_id` / `service_item_id`. If the plan ships without this FK in the first migration, document it as a follow-up migration once API shapes stabilise.

### 2.7 Shared schema compatibility and Model A regression checks

Adding nullable columns to `venues` and `bookings` does **not** change restaurant semantics if defaults and NULLs are correct. **Application-layer** risk remains:

- Every API route, server action, and form that reads or writes `venues` / `bookings` must tolerate new columns and must not assume fixed row shapes without updates.
- TypeScript types and Zod parsers for venue/booking payloads must be updated so unified fields are optional for `table_reservation`.
- Regression suite (§11): always run **restaurant smoke tests** after touching shared tables or comms routing.

---

## 3. UNIFIED AVAILABILITY ENGINE

### 3.0 Venue timezone and wall-clock rules

All date-only strings (`YYYY-MM-DD`) and time-only strings (`HH:MM` in `working_hours`) for unified scheduling are interpreted in **`venues.timezone`**, not the server’s default zone.

**Rules:**

- **“Today”** for `max_advance_booking_days` and **day-of-week** lookup uses the venue’s local date.
- **Min booking notice** compares `now` (UTC instant) to candidate slot start as a **timezone-aware** datetime in the venue zone (same approach as existing appointment code: resolve local date + time → instant).
- **Crons** (reminders, post-visit) must evaluate booking fire times in venue timezone (§4.5).
- **DST:** Use IANA zones and libraries that handle DST transitions; never assume a fixed UTC offset.

Pass `venueId` (or a loaded `venue.timezone`) into `getAvailableSlots` and `getCalendarGrid` so all steps use one consistent clock.

### 3.1 Architecture

Create a new module at `lib/unified-availability.ts`. This is the single availability engine for all non-restaurant booking types. It replaces any existing availability logic for Model B and handles events, classes, and resources too.

The engine exposes two main functions:

```typescript
// Get available time slots for a specific calendar, date, and service
getAvailableSlots(params: {
  calendarId: string;
  date: string;           // YYYY-MM-DD
  serviceItemId: string;  // determines duration
  venueId: string;
}): Promise<AvailableSlot[]>

// Get full calendar grid for dashboard display (all bookings + blocks for a calendar on a date range)
getCalendarGrid(params: {
  venueId: string;
  calendarIds: string[];  // one or more calendars
  startDate: string;
  endDate: string;
}): Promise<CalendarGridData>
```

### 3.2 Availability Calculation Algorithm

The `getAvailableSlots` function works as follows:

```
INPUT: calendarId, date, serviceItemId, venueId

STEP 0: Load venue timezone
  → Fetch venues.timezone for venueId. Resolve all "today" and datetime comparisons using §3.0.

STEP 1: Fetch the calendar record (unified_calendars)
  → Get calendar_type, working_hours, break_times, capacity, parallel_clients,
    slot_interval_minutes, buffer_minutes, min_booking_notice_hours, max_advance_booking_days,
    min_booking_minutes, max_booking_minutes (resources), days_off

STEP 2: Days off (early exit)
  → If `date` is in the calendar's days_off array → return empty array

STEP 3: Validate booking window (venue-local)
  → Compute venue-local "today" from venues.timezone.
  → max_advance: if date > venue_local_today + max_advance_booking_days → reject (empty).
  → min_notice: for each candidate slot you will later evaluate, slot_start_utc must be >= now + min_booking_notice_hours;
    slots that fail are removed (or never generated).

STEP 4: Get working hours for this day of week
  → Look up working_hours[dayOfWeek] (e.g. working_hours["mon"]) in venue-local weekday for `date`
  → If no entry for this day → calendar is closed → return empty array
  → Get array of {start, end} periods

STEP 5: Fetch the service item
  → Get duration_minutes from service_items (or custom_duration from calendar_service_assignments)
  → Get buffer_minutes (use service buffer if > 0, else calendar buffer)
  → Get processing_time_minutes from service_items (default 0). See §3.6 for how this affects overlap.

STEP 6: Busy interval for overlap checks (practitioner & resource)
  → For each candidate booking, the calendar is "busy" with a guest during [start, start + duration + buffer).
  → For practitioner calendars, processing_time extends **occupancy** of the slot for overlap purposes:
      busy_occupancy = [start, start + duration + buffer + processing_time)
    i.e. the practitioner cannot accept another overlapping client until after processing ends.
  → Alternative: if product policy later allows double-booking during processing (rare), gate that behind
    an explicit venue or service flag; default MUST remain conservative (processing blocks the slot).

STEP 7: Generate candidate slots
  → For RESOURCE calendars with min_booking_minutes / max_booking_minutes: use §3.5 (variable-length).
  → Otherwise (practitioner default):
      For each working period {start, end}:
        Generate slots from start to (end - duration_minutes) at slot_interval_minutes intervals
        Each candidate: { time, end_time: time + duration, ... }

STEP 8: Remove slots that overlap with breaks
  → Fetch break_times for this calendar
  → Fetch calendar_blocks for this calendar on this date
  → For each candidate slot, test whether busy_occupancy (STEP 6) overlaps any break or block.
   Overlap rule: start1 < end2 AND start2 < end1 (using minute-of-day or instants in venue zone).

STEP 9: Remove slots that overlap with existing bookings
  → Fetch all bookings for this calendar on this date where status IN ('Pending', 'Confirmed', 'Seated')
  → For each existing booking, compute its busy_occupancy using its service duration, buffer, and processing_time
  → For PRACTITIONER calendars (capacity = 1, parallel_clients = 1):
      Candidate unavailable if its busy_occupancy overlaps any existing booking's busy_occupancy
  → For PRACTITIONER calendars with parallel_clients > 1:
      Count overlapping busy_occupancy intervals; if count >= parallel_clients → unavailable
  → For EVENT/CLASS calendars (capacity > 1):
      Slots are per-session, not per arbitrary slot grid
      Fetch event_sessions for this calendar on this date (must be materialised; see §2.6)
      For each session, sum capacity_used of bookings linked to that session
      If sum >= session capacity → unavailable; else return session with remaining_capacity
  → For RESOURCE calendars (fixed-duration service from service_items):
      Same overlap rules as practitioner with capacity = 1 unless §3.5 applies

STEP 10: Return available slots
  → Return array of { time, end_time, available, remaining_capacity (for events/classes), duration_minutes (resources) }
  → Sort by time ascending
```

### 3.3 Calendar Grid Function

The `getCalendarGrid` function powers the dashboard calendar view:

```
INPUT: venueId, calendarIds[], startDate, endDate

For each calendar in calendarIds:
  For each date in range [startDate, endDate]:
    1. Fetch working hours for this day → determine the time range to display
    2. Fetch all bookings for this calendar on this date
       → Include: booking_id, guest_name, service_name, start_time, duration, status,
         deposit_status, guest_tags, service_colour
    3. Fetch all calendar_blocks for this calendar on this date
       → Include: block_id, start_time, end_time, reason, block_type
    4. Fetch all event_sessions for this calendar on this date (if applicable)
       → Include: session_id, start_time, end_time, capacity, booked_count

Return structured data:
{
  calendars: [
    {
      calendarId: "...",
      calendarName: "Sarah",
      dates: [
        {
          date: "2026-04-01",
          workingHours: [{ start: "09:00", end: "17:00" }],
          bookings: [
            { id, guestName, serviceName, startTime, endTime, status, colour, ... }
          ],
          blocks: [
            { id, startTime, endTime, reason, type }
          ],
          sessions: [
            { id, startTime, endTime, capacity, bookedCount }
          ]
        }
      ]
    }
  ]
}
```

### 3.4 Performance Requirements

- `getAvailableSlots`: < 100ms for a single calendar + date query
- `getCalendarGrid`: < 300ms for 5 calendars over 1 day, < 1s for 5 calendars over 7 days
- Batch all database queries: fetch working hours, bookings, blocks, and sessions in parallel (Promise.all), not sequentially
- Cache calendar configuration (working hours, break times) in memory per request - it doesn't change between slot calculations

### 3.5 Variable-length resource bookings

When `calendar_type = 'resource'` and `min_booking_minutes` / `max_booking_minutes` are set, clients choose **duration** (e.g. 60, 90, 120 minutes) as well as **start time**.

**Candidate generation:**

1. Let `D` be a chosen duration such that `min_booking_minutes <= D <= max_booking_minutes` and `D` aligns to a step (e.g. 15-minute increments, or enforce `D % slot_interval_minutes === 0`).
2. For each working period `[open, close]`, for each valid `D`, iterate start times `t` from `open` to `close - D` at `slot_interval_minutes`.
3. For each `(t, D)`, compute `busy_occupancy = [t, t + D + buffer + processing_time)` and run the same break/block/booking overlap checks as §3.2.
4. **Public API:** Either expose discrete `(startTime, durationMinutes)` pairs or expose start times per selected duration (UI: user picks duration, then sees start times).

**Pricing:** Use `price_per_slot_pence` on the calendar and/or `price_pence` on `service_items` for `resource_slot` items; document whether price is per hour or per chosen block in settings.

### 3.6 Processing time and overlap rules (default policy)

`processing_time_minutes` on `service_items` models work where the client does not need the practitioner’s attention (e.g. colour developing). **Default policy for Phase 1:**

- The practitioner **cannot** start another overlapping appointment until `duration + buffer + processing_time` after slot start.
- Therefore, overlap detection uses **busy_occupancy** ending at `start + duration + buffer + processing_time` (same as STEP 6 in §3.2).

If a future release introduces “parallel processing” (e.g. second client while first is processing), add an explicit boolean on `service_items` or `venues` and narrow the busy interval to `[start, start + duration + buffer)` only; do **not** silently change behaviour without that flag.

---

## 4. COMMUNICATION ENGINE

### 4.1 Architecture Update

The existing communication engine at `lib/communications/` has a channel abstraction with EmailChannel and SMSChannel. This section specifies how to update it for the unified scheduling system with SMS tracking and tier-aware routing.

### 4.2 The 8 Message Types

Every non-restaurant booking goes through this lifecycle. Each message has a specific trigger, timing, channel rules, and content.

**Implementation note:** Variable names and placeholder lists in dashboard template editors and preview samples may not match every production HTML template one-to-one; treat the product UI and `send-templated` / cron renderers as the source of truth for what is actually substituted at send time.

#### Message 1: Booking Confirmation

**Trigger:** Booking created (online, phone, or staff-created). For bookings with deposits, sent after Stripe payment_intent.succeeded webhook. For bookings without deposits, sent immediately on creation.

**Timing:** Immediately

**Channels:**
- Standard tier: Email + SMS
- Business tier: Email + SMS

**Email template variables:**
```
subject: "Your appointment at {{business_name}} is confirmed"
body includes:
  {{client_name}}
  {{service_name}}
  {{calendar_name}} (practitioner/resource/event name)
  {{appointment_date}} (formatted: "Friday 14 March 2026")
  {{appointment_time}} (formatted: "2:00 PM")
  {{appointment_duration}} (formatted: "30 minutes")
  {{business_address}}
  {{deposit_amount}} (if paid)
  {{cancellation_policy}}
  {{manage_link}} → /manage/[bookingId]/[token]
  {{pre_appointment_instructions}} (if set on the service)
```

**SMS template:**
```
"Your {{service_name}} with {{calendar_name}} at {{business_name}} is confirmed 
for {{appointment_date}} at {{appointment_time}}. Manage: {{manage_link}}"
```
(Must be under 160 characters to avoid multi-segment billing. Use URL shortener for manage_link.)

#### Message 2: Deposit Payment Request

**Trigger:** Staff-created booking where deposit is required but not yet collected.

**Timing:** Immediately on booking creation

**Channels:**
- Standard tier: Email + SMS
- Business tier: Email + SMS

**SMS template:**
```
"{{business_name}}: Your {{service_name}} on {{appointment_date}} at {{appointment_time}} 
requires a £{{deposit_amount}} deposit. Pay here: {{payment_link}}"
```

#### Message 3: Booking Rescheduled

**Trigger:** Booking date or time changed by staff or client.

**Timing:** Immediately on change

**Channels:**
- Standard tier: Email + SMS
- Business tier: Email + SMS

**SMS template:**
```
"{{business_name}}: Your {{service_name}} has been moved to {{appointment_date}} 
at {{appointment_time}}. Manage: {{manage_link}}"
```

#### Message 4: Reminder #1 (Primary - 24 hours before)

**Trigger:** Cron job (runs every 15 minutes)

**Timing:** Configurable, default 24 hours before. Uses venue's `notification_settings.reminder_1_hours_before`.

**Channels:**
- Standard tier: Email + SMS (with confirm-or-cancel link)
- Business tier: Email + SMS (with confirm-or-cancel link)

**Cron logic:**
```
Find bookings WHERE:
  reminder_sent_at IS NULL
  AND status IN ('Confirmed', 'Pending')
  AND booking_date + booking_time BETWEEN 
    (now + reminder_hours - 30min) AND (now + reminder_hours + 30min)
  AND venue.notification_settings.reminder_1_enabled = true

For each booking:
  Generate confirm token if not exists
  Set confirm_token_hash on booking
  Set reminder_sent_at = now()
  Send via configured channels
```

**SMS template:**
```
"Reminder: {{service_name}} with {{calendar_name}} at {{business_name}} 
tomorrow at {{appointment_time}}. Confirm or cancel: {{confirm_link}}"
```

#### Message 5: Reminder #2 (Final nudge - 2 hours before)

**Trigger:** Cron job (runs every 15 minutes)

**Timing:** Configurable, default 2 hours before. Uses venue's `notification_settings.reminder_2_hours_before`.

**Channels:**
- Standard tier: SMS only
- Business tier: SMS only
(Email 2 hours before is too likely to be missed)

**Cron logic:**
```
Find bookings WHERE:
  final_reminder_sent_at IS NULL
  AND reminder_sent_at IS NOT NULL (primary reminder was already sent)
  AND status = 'Confirmed'
  AND booking_date + booking_time BETWEEN 
    (now + reminder_2_hours - 15min) AND (now + reminder_2_hours + 15min)
  AND venue.notification_settings.reminder_2_enabled = true

For each booking:
  Set final_reminder_sent_at = now()
  Send SMS only
```

**SMS template:**
```
"Your {{service_name}} with {{calendar_name}} is in 2 hours at {{appointment_time}}. 
See you at {{business_name}}!"
```

#### Message 6: Cancellation Confirmation

**Trigger:** Booking cancelled by client (via manage link or confirm-or-cancel page) or by staff.

**Timing:** Immediately

**Channels:**
- Standard tier: Email only
- Business tier: Email only
(Cancellation messages should not be sent via SMS - too aggressive)

**Email includes:** Service, date, time, refund status, rebooking link.

#### Message 7: No-Show Notification

**Trigger:** Staff marks booking as no-show.

**Timing:** Immediately

**Channels:**
- Standard tier: Email only
- Business tier: Email only
(Same reasoning as cancellations - email is appropriate, SMS is not)

**Email includes:** Missed appointment details, deposit forfeited info, cancellation policy reminder, rebooking link.

#### Message 8: Post-Visit Follow-up

**Trigger:** Cron job (runs every 30 minutes)

**Timing:** 4 hours after appointment end time. If appointment was after 5pm, send at 9am next morning.

**Channels:**
- Standard tier: Email only
- Business tier: Email only

**Cron logic:**
```
Find bookings WHERE:
  post_visit_sent_at IS NULL
  AND status = 'Completed'
  AND venue.notification_settings.post_visit_enabled = true

For each candidate booking:
  Compute appointment_end_local (venue wall-clock) using venues.timezone (§3.0).
  Let "17:00" and "09:00 next day" refer to that same timezone - not server local.

  Eligible when:
    (appointment_end_local <= 17:00 on that local day AND now_utc >= appointment_end_utc + 4 hours)
    OR
    (appointment_end_local > 17:00 AND now_utc >= next_local_day 09:00 in venue timezone)

For each booking:
  Set post_visit_sent_at = now()
  Send email with feedback link and rebooking link
```

### 4.3 Channel Routing Logic

#### 4.3.1 Implementation (production)

Routing is applied where messages are sent, rather than a single global `getChannelsForMessage` helper:

- **Transactional unified appointment messages** (confirmation, deposit request/confirm, reschedule, cancellation): [`src/lib/communications/send-templated.ts`](src/lib/communications/send-templated.ts) loads [`getVenueNotificationSettings`](src/lib/notifications/notification-settings.ts) for `unified_scheduling` / `practitioner_appointment` venues and gates sends (e.g. `confirmation_enabled`, `confirmation_channels`, `reschedule_notification_enabled`, `cancellation_notification_enabled`). Cancellation SMS is not sent for these booking models. Deposit channels still follow [`getCommSettings`](src/lib/communications/service.ts) and tier checks ([`isSmsAllowed`](src/lib/tier-enforcement.ts)).
- **Scheduled reminders and post-visit** (messages 4, 5, 8): [`src/lib/cron/unified-scheduling-comms.ts`](src/lib/cron/unified-scheduling-comms.ts) reads the same `notification_settings` JSON for toggles, hours, and channels; legacy restaurant cron skips unified venues.
- **No-show email**: [`CommunicationService`](src/lib/communications/service.ts) with `no_show_notification` and email-only `MESSAGE_CHANNELS`, gated by `no_show_notification_enabled` before send in the venue booking API.
- **Legacy / tier overrides**: [`src/lib/communications/tier-message-channels.ts`](src/lib/communications/tier-message-channels.ts) only overrides `deposit_payment_reminder` today; it does not replace the unified paths above.

The pseudocode below remains the **canonical channel matrix** for product and docs; new code should stay aligned with these rules even if the function is not literally centralized.

#### 4.3.2 Central router (reference pseudocode)

Update `lib/communications/service.ts` with this routing:

```typescript
function getChannelsForMessage(
  messageType: string, 
  pricingTier: string,
  notificationSettings: NotificationSettings
): ('email' | 'sms')[] {
  
  // Check if this message type is enabled in venue settings
  const enabledMap: Record<string, string> = {
    'booking_confirmation': 'confirmation_enabled',
    'deposit_payment_request': 'confirmation_enabled', // same toggle as confirmation
    'booking_rescheduled': 'reschedule_notification_enabled',
    'reminder_1': 'reminder_1_enabled',
    'reminder_2': 'reminder_2_enabled',
    'cancellation_confirmation': 'cancellation_notification_enabled',
    'no_show_notification': 'no_show_notification_enabled',
    'post_visit_followup': 'post_visit_enabled',
  };
  
  const settingKey = enabledMap[messageType];
  if (settingKey && !notificationSettings[settingKey]) {
    return []; // disabled by venue
  }
  
  // Channel routing
  switch (messageType) {
    case 'booking_confirmation':
    case 'deposit_payment_request':
    case 'booking_rescheduled':
      return ['email', 'sms'];  // both tiers get email + SMS
      
    case 'reminder_1':
      return ['email', 'sms'];  // both tiers get email + SMS
      
    case 'reminder_2':
      return ['sms'];           // SMS only (both tiers)
      
    case 'cancellation_confirmation':
    case 'no_show_notification':
    case 'post_visit_followup':
      return ['email'];         // email only (both tiers)
      
    default:
      return ['email'];         // fallback
  }
}
```

### 4.4 SMS Tracking Integration

Every SMS sent must be tracked for billing. Update the SMSChannel to:

1. Before sending: check the venue's current month SMS usage against their allowance
2. Send the SMS via Twilio
3. After sending: increment the sms_usage counter and create an sms_log entry
4. If over allowance: still send (don't block business-critical messages), but flag as overage

```typescript
// In SMSChannel.send():
async send(venueId: string, recipient: string, body: string, messageType: string, bookingId?: string) {
  // 1. Send via Twilio
  const twilioResult = await twilioClient.messages.create({
    to: recipient,
    from: process.env.TWILIO_PHONE_NUMBER,
    body: body,
  });
  
  // 2. Log the message
  await supabase.from('sms_log').insert({
    venue_id: venueId,
    booking_id: bookingId,
    message_type: messageType,
    recipient_phone: recipient,
    twilio_message_sid: twilioResult.sid,
    status: 'sent',
    segment_count: twilioResult.numSegments ?? estimateSegments(body), // prefer API; see §4.6
  });
  
  // 3. Update monthly usage counter
  const billingMonth = new Date().toISOString().slice(0, 7) + '-01'; // e.g. '2026-04-01'
  await supabase.rpc('increment_sms_usage', { 
    p_venue_id: venueId, 
    p_billing_month: billingMonth 
  });
}
```

Create a Supabase function for atomic counter increment:

```sql
CREATE OR REPLACE FUNCTION increment_sms_usage(p_venue_id UUID, p_billing_month DATE)
RETURNS VOID AS $$
BEGIN
  INSERT INTO sms_usage (venue_id, billing_month, messages_sent, messages_included, overage_count)
  VALUES (
    p_venue_id, 
    p_billing_month, 
    1,
    (SELECT sms_monthly_allowance FROM venues WHERE id = p_venue_id),
    0
  )
  ON CONFLICT (venue_id, billing_month) 
  DO UPDATE SET 
    messages_sent = sms_usage.messages_sent + 1,
    overage_count = GREATEST(0, sms_usage.messages_sent + 1 - sms_usage.messages_included),
    overage_amount_pence = GREATEST(0, sms_usage.messages_sent + 1 - sms_usage.messages_included) * 5,
    updated_at = now();
END;
$$ LANGUAGE plpgsql;
```

### 4.5 Timezone for crons and scheduled messages

All scheduled jobs (reminder #1, reminder #2, post-visit, optional auto-cancel) must:

1. Load `venues.timezone` for each booking’s venue.
2. Compare **instants** (UTC) derived from `booking_date` + `booking_time` in that zone against `now()`.
3. Use a consistent definition of **billing month** for `sms_usage` (recommended: **UTC calendar month** starting `YYYY-MM-01`, or venue-local month - pick one, document it in code, and use it in `increment_sms_usage` and dashboard queries).

Reminder windows described as “24 hours before” / “2 hours before” are wall-clock deltas in real time; implementing them as “UTC offset from stored local time converted to instant” avoids DST mistakes.

### 4.6 SMS segment counting and billing accuracy

Do **not** rely on `Math.ceil(body.length / 160)` for production billing analytics.

- **GSM-7** encoding allows 160 characters per segment (153 when concatenated); **UCS-2** (Unicode, emoji, many non-Latin scripts) uses 70 / 67 characters per segment.
- Prefer Twilio’s returned **`numSegments`** (or equivalent) from the send API response when logging `sms_log.segment_count`.
- If segment count is unavailable at send time, use a library that implements GSM-7 vs UCS-2 detection and multipart SMS math.
- Long URLs and special characters can flip encoding; test templates against real device character sets.

---

## 5. SMS USAGE DASHBOARD & BILLING

### 5.1 Dashboard Widget

Add an "SMS Usage" card to the dashboard home page (visible on all booking models):

```
SMS This Month
███████████░░░░░ 142 / 200 used
58 remaining

[If over allowance:]
SMS This Month  
████████████████ 234 / 200 used
⚠️ 34 additional messages at 5p each = £1.70 overage
(Billed at end of month)
```

### 5.2 Settings Page Section

In Settings → Plan / Billing, show:

- Current plan: Standard / Business
- SMS allowance: X per month
- Current month usage: X sent, X remaining
- Overage: X messages × 5p = £X.XX
- SMS log: expandable table showing recent messages (date, type, recipient, status)

### 5.3 Overage Billing (End of Month)

Create a cron job at `/api/cron/sms-overage-billing` that runs on the 1st of each month:

1. Find all sms_usage records for the previous month where `overage_count > 0` AND `overage_billed = false`
2. For each: create a Stripe usage record on the venue's subscription using `STRIPE_SMS_OVERAGE_PRICE_ID`
   ```typescript
   await stripe.subscriptionItems.createUsageRecord(
     venueSubscriptionItemId,
     { quantity: overageCount, timestamp: Math.floor(Date.now() / 1000) }
   );
   ```
3. Set `overage_billed = true` on the sms_usage record
4. Stripe automatically adds the overage charge to the next invoice

### 5.4 Stripe metered SMS: subscription items and failure handling

**Subscription shape:** Checkout must attach **two** recurring items to the customer where SMS overage applies:

1. The base plan (`STRIPE_STANDARD_PRICE_ID` with quantity, or `STRIPE_BUSINESS_PRICE_ID`).
2. The metered SMS price (`STRIPE_SMS_OVERAGE_PRICE_ID`) on its own **subscription item** with `usage_type = metered`.

Store **both** `stripe_subscription_id` and the **metered line’s** `stripe_subscription_item_id` on `venues` (the plan already references a subscription item for quantity updates - ensure the **metered** item id is distinct and stored separately, e.g. `stripe_sms_subscription_item_id`, if the quantity item and metered item cannot share one field).

**Usage records:** `createUsageRecord` must target the **metered** subscription item id, not the base price item. Timestamp should fall within the billing period Stripe expects (typically current period).

**Failures:** If usage record creation fails (network, Stripe outage), log the error with `venue_id` and `billing_month`, do **not** set `overage_billed = true`, and retry from a dead-letter queue or the next cron run. Double-reporting the same usage in one period is avoided by idempotent keys or by only marking billed after Stripe confirms success.

**Proration / plan changes:** When upgrading Standard quantity or switching Standard ↔ Business, reconcile `sms_monthly_allowance` on the venue row immediately and ensure the metered subscription item remains attached; test in Stripe test mode before production.

---

## 6. DASHBOARD ARCHITECTURE

### 6.1 Routing by Booking Model

The dashboard shell (sidebar, header) checks `venue.booking_model`:

**If 'table_reservation':** Show existing restaurant dashboard - Bookings, Day Sheet, Table Grid, Floor Plan, Reports, Guests, Settings. NO CHANGES.

**If 'unified_scheduling':** Show the unified scheduling dashboard:
- **Calendar** (primary view - the practitioner/resource/event calendar)
- **Appointments** (list view - searchable, filterable booking list)
- **Clients** (client management with tags and history)
- **Reports** (booking stats, no-show rate, revenue, SMS usage)
- **Settings** (business profile, calendars, services, notifications, plan, billing)

### 6.2 Calendar View (Primary Dashboard View)

This is the existing Model B practitioner calendar, generalised for all calendar types. It should work identically to what's already built for practitioners, with these additions:

**For practitioner calendars:** Day and week views with one column per practitioner. Drag-and-drop appointment blocks. Click to create, click to view details, right-click for context menu. Block time creation and editing (including Gap 1 fix). All existing Model B calendar functionality preserved.

**For event/class calendars:** Show sessions as blocks on a timeline. Each session shows: name, time, capacity (booked/total). Click to see attendee list. Colour-coded by capacity fill: green (<50%), amber (50-80%), red (>80%).

**For resource calendars:** Show resource bookings as blocks on a timeline. One column per resource. Similar to practitioner view but without service assignment - just time blocks.

### 6.3 Appointments List View

Carry forward the existing Model B appointments list. This is the secondary, administrative view with search, filters, and bulk operations.

### 6.4 Terminology

All dashboard text must use the venue's terminology configuration. The `t()` helper function reads from `venue.terminology` JSONB:

```typescript
import { useVenue } from '@/hooks/useVenue';

function t(key: string): string {
  const venue = useVenue();
  return venue.terminology[key] || key;
}

// Usage in components:
<h2>{t('clients')}</h2>  // "Clients" for barbers, "Patients" for physios, "Guests" for events
```

---

## 7. BOOKING PAGE ARCHITECTURE

### 7.1 Unified Booking Flow

The public booking page at `/book/[venue-slug]` must detect the venue's booking_model and render the appropriate flow:

**If 'table_reservation':** Render the existing restaurant booking page. NO CHANGES.

**If 'unified_scheduling':** Render the unified booking flow, which adapts based on the calendar types available at this venue.

### 7.2 Unified Booking Flow Steps

**Step 1: Select a Service**
- Show all active, online-bookable service_items grouped by category (if the venue has multiple calendar types)
- Each service shows: name, duration, price, description
- If the venue has only one service, auto-select it and skip this step

**Step 2: Select a Calendar (if applicable)**
- For practitioner services: show available practitioners who offer this service
- Each practitioner shows: name, photo, next available time
- If only one practitioner offers this service, auto-select and skip
- For events/classes: show available sessions (date, time, remaining capacity)
- For resources: show available resources

**Step 3: Select Date & Time**
- Date picker (calendar widget, showing available dates)
- On date selection: call `getAvailableSlots()` and show available times
- For events/classes: show session times with remaining capacity instead of individual slots

**Step 4: Guest Details**
- Name, email, phone (all required)
- Special requests / notes (optional)
- Pre-appointment instructions displayed (from service_item.pre_appointment_instructions)

**Step 5: Payment (if deposit required)**
- Show deposit amount
- Stripe Elements card input (using venue's connected Stripe account)
- Cancellation policy displayed

**Step 6: Confirmation**
- Booking details summary
- "Add to Calendar" (.ics download)
- Manage booking link

### 7.3 Practitioner-Specific Booking Links

The existing practitioner slug system (Gap 2) works with unified_calendars. When a client visits `/book/[venue-slug]/[calendar-slug]`:
- Look up the unified_calendar by slug
- Pass `lockedCalendarId` to the booking flow
- Skip Step 2 (calendar selection)
- Filter Step 1 (services) to only show services assigned to this calendar

### 7.4 Group and multi-service bookings (Phase 2)

The `bookings.group_booking_id` column reserves support for **multiple services in one checkout** (e.g. cut + colour) or **multiple family members** in one transaction. **Phase 1** implements the single-service flow in §7.2 only.

**Phase 2 specification (when prioritised):**

- Generate one `group_booking_id` (UUID) per checkout; create **one `bookings` row per service line**, all sharing that id.
- Payments: one Stripe PaymentIntent covering total deposit, or separate intents per line - document in payment module.
- Communications: send **one** confirmation summarising all lines, or one per line - product decision; avoid duplicate SMS charges where possible.
- Cancellation: cancel group or per-line - policy stored on venue.

Until Phase 2 is built, APIs and UI should not expose group booking; keep column nullable and unused.

---

## 8. ONBOARDING WIZARD

### 8.1 Routing

After payment, the user arrives at `/onboarding`. The wizard checks `venue.booking_model`:

**If 'table_reservation':** Route to existing restaurant wizard. NO CHANGES.

**If 'unified_scheduling':** Route to the unified scheduling wizard (described below).

### 8.2 Unified Scheduling Wizard Steps

**Step 1: Your Business** (identical for all types)
- Business name, address, phone, photo, description
- Business type displayed as confirmed badge
- Creates/updates venue record, generates slug

**Step 2: Your Team / Calendars**
- Heading adapts: "Your Team" for practitioners, "Your Rooms" for resources, "Your Classes" for classes, "Your Events" for events
- Pre-create calendar entries based on calendar_count from payment (e.g. if they paid for 3 calendars, show 3 rows)
- Each row: name, working hours (weekly grid picker), break times
- Pre-fill from business type defaults
- For practitioners: name of each team member, individual working hours
- For resources: name of each resource, availability hours
- For events: name of each event/experience, schedule
- For classes: name of each class type, weekly timetable

**Step 3: Your Services**
- Pre-populated from business type defaults
- Each row: service name, duration (dropdown), price (input), colour
- "Add service" button
- For practitioners: checkboxes for which calendars offer each service (if multiple calendars)
- For events: ticket types with prices and capacities
- For resources: time slot options with pricing

**Step 4: Preview & Go Live**
- Booking page preview at mobile width
- Shareable URL with copy button
- QR code with download
- iFrame embed code
- CTA: "Go to Your Dashboard"
- On click: set onboarding_completed = true, redirect to /dashboard

---

## 9. SETTINGS & CONFIGURATION

### 9.1 Settings Page Structure (Unified Scheduling)

The settings page at `/dashboard/settings` for unified scheduling venues should have these sections:

**Business Profile:** Name, address, phone, photo, description, slug. Same as setup wizard Step 1.

**Calendars:** List of unified_calendars. Add, edit, remove, reorder. Each calendar has: name, slug, working hours, break times, days off, capacity, parallel clients, buffer time, slot interval, booking window (min notice, max advance days). This is the unified version of the old "Staff" settings.

**Services:** List of service_items. Add, edit, remove, reorder. Each service has: name, description, duration, price, deposit, pre-appointment instructions, colour, online bookability toggle, calendar assignments.

**Notifications:** Toggle and configure each of the 8 message types. Reminder timing dropdowns. Channel selection per message type (where applicable).

**Plan & Billing:** Current tier, calendar count, SMS usage this month, upgrade/downgrade, cancel subscription.

**Booking Page:** URL, QR code, iFrame embed code, booking page preview link.

---

## 10. CURSOR PROMPTS

### Prompt 1: Database Schema & Migration

> **Cursor Prompt:**
>
> "Create Supabase migrations for the ReserveNI unified scheduling engine. This replaces the separate Models B/C/D/E with a single system. Model A (restaurants) must remain completely unchanged.
>
> Create the following new tables exactly as specified:
>
> 1. `unified_calendars` - [paste the full CREATE TABLE from Section 2.2 above]
> 2. `service_items` - [paste the full CREATE TABLE from Section 2.2 above]
> 3. `calendar_service_assignments` - [paste the full CREATE TABLE from Section 2.2 above]
> 4. `calendar_blocks` - [paste the full CREATE TABLE from Section 2.2 above]
> 5. `event_sessions` - [paste the full CREATE TABLE from Section 2.2 above]
> 6. `sms_usage` - [paste the full CREATE TABLE from Section 2.2 above]
> 7. `sms_log` - [paste the full CREATE TABLE from Section 2.2 above]
>
> Add all columns to the `venues` table as specified in Section 2.1 (use ALTER TABLE ADD COLUMN IF NOT EXISTS for safety).
>
> Add all columns to the `bookings` table as specified in Section 2.1.
>
> Create the `increment_sms_usage` database function as specified in Section 4.4.
>
> Add all RLS policies as specified in Section 2.4 - policies MUST use the Reserve NI pattern (staff matched by JWT email), not auth.uid() on staff.id, unless you have verified a different auth mapping.
>
> Add optional columns if implementing §2.6: e.g. bookings.event_session_id REFERENCES event_sessions(id); event_sessions.recurrence_key / source for idempotent generation.
>
> Grant EXECUTE on increment_sms_usage to service_role only (or equivalent); never expose to anon/authenticated clients.
>
> Create all indexes as specified in each table definition.
>
> Enable Supabase Realtime on: unified_calendars, bookings, calendar_blocks, event_sessions.
>
> Run the data migration from existing Model B tables as specified in Section 2.3 (copy practitioners → unified_calendars, offered_services → service_items, practitioner_services → calendar_service_assignments, update bookings references).
>
> IMPORTANT: Do NOT drop the old practitioners, offered_services, or practitioner_services tables. Keep them for safety. They will be deprecated but not removed.
>
> IMPORTANT: All defaults on new venue columns must match existing restaurant data so no existing records break.
>
> Test: Run the migration on the dev database. Verify all existing restaurant data is intact. Verify Model B data has been copied to new tables. Verify all indexes and RLS policies are applied."

### Prompt 2: Unified Availability Engine

> **Cursor Prompt:**
>
> "Build the unified availability engine for ReserveNI at `lib/unified-availability.ts`. This is the single availability calculation module for all non-restaurant booking types (practitioners, events, classes, resources). It replaces any existing availability logic for Model B appointments.
>
> Export two functions:
>
> **Function 1: `getAvailableSlots(params)`**
> Implement exactly as specified in Sections 3.0, 3.2, 3.5, and 3.6. In summary:
> - Resolve venues.timezone for venueId; all "today" and window checks use venue-local dates/times (§3.0).
> - Early exit for days_off; validate min/max booking window (§3.2 STEPS 2–4).
> - Compute busy intervals using duration + buffer + processing_time_minutes per §3.6 default policy.
> - Generate slots per calendar_type; for resources with min/max duration, follow §3.5.
> - Subtract breaks, blocks, and existing bookings using overlap rule: s1 < e2 AND s2 < e1.
> - Events/classes: use materialised event_sessions (§2.6) and capacity remaining.
>
> Use proper interval overlap logic: two intervals [s1,e1] and [s2,e2] overlap if s1 < e2 AND s2 < e1.
>
> **Function 2: `getCalendarGrid(params)`**
> Implement exactly as specified in Section 3.3. Returns structured data for the dashboard calendar view with all bookings, blocks, and sessions for the requested calendars and date range.
>
> **Performance:** Batch all database queries using Promise.all. Target: getAvailableSlots < 100ms, getCalendarGrid < 300ms for 5 calendars over 1 day.
>
> **API endpoints:**
> Create `GET /api/booking/unified-availability?calendar_id=X&date=YYYY-MM-DD&service_item_id=Y` - public endpoint for booking page, returns available slots.
> Create `GET /api/venue/calendar-grid?calendar_ids=X,Y,Z&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD` - authenticated venue staff endpoint for dashboard calendar.
>
> **Event session materialisation:** Implement `/api/cron/materialize-event-sessions` (CRON_SECRET) that expands recurrence_rule into event_sessions per Section 2.6 (rolling horizon, idempotent upserts). Schedule daily in vercel.json.
>
> **Unit tests:** Write tests covering:
> 1. Practitioner with simple availability: 9-5 working hours, no bookings → all slots available
> 2. Practitioner with one booking at 10:00 for 30min + 10min buffer → 10:00 and 10:15 slots unavailable, 10:45 available
> 3. Practitioner with break 13:00-14:00 → no slots in that window
> 4. Calendar block (manual) on a specific date → those slots removed
> 5. Day off → empty result
> 6. Min booking notice: booking for 30 minutes from now when min_notice = 1 hour → rejected
> 7. Max advance days: booking 90 days out when max = 60 → rejected
> 8. Event with capacity 6: 5 booked → 1 remaining → available. 6 booked → unavailable.
> 9. Parallel clients = 2: one booking at 10:00 → 10:00 still available. Two bookings at 10:00 → unavailable.
> 10. Two services with different durations: 30min and 60min → different slots unavailable.
> 11. Processing time: service with 30min duration + 30min processing → next slot cannot start until 60min after prior start (plus buffer).
> 12. Resource variable length: min 60, max 180, valid durations produce distinct slot grids per §3.5.
> 13. Timezone: venue in Europe/London - \"today\" and DST boundaries behave correctly."

### Prompt 3: Communication Engine Update

> **Cursor Prompt:**
>
> "Update the ReserveNI communication engine to support the unified scheduling system with SMS tracking, 8 message types, and tier-aware routing. This must work for both restaurant (Model A) and unified scheduling venues.
>
> **Update `lib/communications/service.ts`:**
>
> Update the channel routing to use the function specified in Section 4.3 of the implementation plan. The routing logic:
> - booking_confirmation, deposit_payment_request, booking_rescheduled, reminder_1: email + SMS (both tiers)
> - reminder_2: SMS only (both tiers)
> - cancellation_confirmation, no_show_notification, post_visit_followup: email only (both tiers)
> - Each message type respects the venue's notification_settings toggles
>
> **Update `lib/communications/channels/sms.ts`:**
>
> After every SMS send, log to sms_log table and increment sms_usage counter using the increment_sms_usage database function. Track the Twilio message SID and segment count - prefer Twilio’s numSegments from the API response (see Section 4.6). The SMS must be sent regardless of whether the venue is over their allowance - never block a business-critical message.
>
> **Create/update email templates** in `lib/communications/templates/` for all 8 message types as specified in Section 4.2:
> 1. booking_confirmation - service, practitioner/calendar, date, time, duration, address, deposit, cancellation policy, manage link, pre-appointment instructions
> 2. deposit_payment_request - amount, service, date, time, payment link, 24h expiry
> 3. booking_rescheduled - new date, new time, service, calendar, manage link
> 4. reminder_1 - date, time, service, calendar, address, deposit info, confirm-or-cancel link
> 5. reminder_2 - short SMS template only: service, calendar, time, business name
> 6. cancellation_confirmation - service, date, time, refund status, rebooking link
> 7. no_show_notification - missed details, deposit forfeited info, policy reminder, rebooking link
> 8. post_visit_followup - thank you, feedback buttons (thumbs up/down linking to /feedback/[id]), rebooking link
>
> **Create/update SMS templates** for messages 1-5 as specified in Section 4.2. Keep SMS under 160 characters where possible to avoid multi-segment billing.
>
> **Update cron jobs:**
>
> Update `/api/cron/reminder-24h` (or create unified version at `/api/cron/send-reminders`):
> - Query bookings for BOTH restaurant and unified scheduling venues
> - For reminder_1: find bookings where reminder_sent_at IS NULL, status IN ('Confirmed', 'Pending'), appointment time within the reminder window (venue-configurable, default 24h)
> - For reminder_2: find bookings where final_reminder_sent_at IS NULL, reminder_sent_at IS NOT NULL, status = 'Confirmed', appointment time within the reminder_2 window (default 2h), venue has reminder_2_enabled
> - For each booking: generate confirm token if needed, send via configured channels, update sent timestamps
> - Evaluate fire times using venues.timezone (Section 4.5); compare instants in UTC derived from local booking date/time.
>
> Create `/api/cron/post-visit-followup`:
> - Find bookings where post_visit_sent_at IS NULL, status = 'Completed', venue has post_visit_enabled
> - Apply timing logic from Section 4.2 Message 8 (venue-local 17:00 / 09:00 rules; Section 4.5)
> - Send email with feedback link and rebooking link
>
> All cron endpoints secured with CRON_SECRET bearer token.
>
> **Update Vercel cron config** (vercel.json):
> ```json
> {
>   \"crons\": [
>     { \"path\": \"/api/cron/send-reminders\", \"schedule\": \"*/15 * * * *\" },
>     { \"path\": \"/api/cron/post-visit-followup\", \"schedule\": \"*/30 * * * *\" },
>     { \"path\": \"/api/cron/auto-cancel-bookings\", \"schedule\": \"*/15 * * * *\" }
>   ]
> }
> ```
>
> Test: Create a booking for a unified scheduling venue → confirmation email + SMS sent → SMS logged in sms_log → sms_usage incremented. Wait for reminder cron window → reminder sent with confirm-or-cancel link. Mark booking as completed → post-visit email sent 4 hours later. Check sms_usage → correct count. Verify restaurant venue communications still work unchanged."

### Prompt 4: SMS Usage Dashboard & Overage Billing

> **Cursor Prompt:**
>
> "Build the SMS usage tracking dashboard and overage billing system for ReserveNI.
>
> **Dashboard SMS widget:**
> Add an 'SMS Usage' card to the dashboard home page for all venue types. Show: a progress bar of messages used vs allowance this month, messages remaining, and if over allowance show the overage count and estimated charge (count × 5p). The data comes from the sms_usage table for the current billing month.
>
> **Settings billing section:**
> In Settings → Plan & Billing, add an 'SMS Usage' section showing:
> - Current month: X of Y messages used (progress bar)
> - Remaining: X messages
> - If over: '⚠️ X additional messages at 5p each = £X.XX (billed at end of month)'
> - SMS allowance explanation: 'Your plan includes Y SMS per month. Additional messages are charged at 5p each.'
> - Recent SMS log: expandable table showing the last 50 messages: date/time, type (confirmation/reminder/etc), recipient (last 4 digits of phone), status (sent/delivered/failed)
>
> **SMS allowance calculation:**
> When a venue's calendar_count or pricing_tier changes, recalculate sms_monthly_allowance:
> - Standard tier: 200 × calendar_count
> - Business tier: 800
> - Founding tier: 800
> Update this on the venue record whenever the subscription quantity changes.
>
> **Overage billing cron job** at `/api/cron/sms-overage-billing`:
> Runs on the 1st of each month (add to vercel.json: schedule '0 2 1 * *' - 2am on the 1st).
> 1. Find all sms_usage records for the previous month where overage_count > 0 AND overage_billed = false
> 2. For each venue with overage:
>    a. Load venues.stripe_sms_subscription_item_id (metered line item - see Section 5.4). Do not use the Standard quantity subscription item id.
>    b. Report usage using stripe.subscriptionItems.createUsageRecord() against that item only; handle failures per Section 5.4 (retry, do not mark billed on error).
>    c. Set overage_billed = true on the sms_usage record only after Stripe confirms success
> 3. Stripe automatically adds the charge to the venue's next invoice
>
> **Environment:** Ensure STRIPE_SMS_OVERAGE_PRICE_ID is used. The Stripe Price must be created as a metered/usage-based price. Onboarding webhook must persist stripe_sms_subscription_item_id when attaching the metered item at signup.
>
> **Test:** Send 5 SMS messages for a venue → sms_usage shows 5 sent. Check dashboard widget → shows 5/200. Send 201 messages (simulate by calling increment_sms_usage directly) → widget shows '1 additional message at 5p = £0.05'. Run overage billing cron → verify Stripe usage record created. New month starts → usage resets to 0."

### Prompt 5: Unified Dashboard & Calendar View

> **Cursor Prompt:**
>
> "Update the ReserveNI dashboard to support the unified scheduling system. The dashboard must route between the restaurant experience and the unified scheduling experience based on the venue's booking_model.
>
> **Dashboard routing** in `DashboardSidebar.tsx` and the dashboard layout:
> Check `venue.booking_model`:
> - If 'table_reservation': show the EXISTING restaurant sidebar (Bookings, Day Sheet, Table Grid, Floor Plan, Reports, Guests, Settings). NO CHANGES to any restaurant dashboard code.
> - If 'unified_scheduling': show the unified sidebar: Calendar, Appointments, Clients, Reports, Settings.
>
> **Calendar view** at `/dashboard/calendar`:
> This is the EXISTING practitioner calendar view, refactored to use unified_calendars instead of practitioners.
>
> Update `PractitionerCalendarView.tsx` (or create a new `UnifiedCalendarView.tsx` that copies and extends it):
> 1. Fetch data from unified_calendars instead of practitioners
> 2. Fetch bookings using calendar_id instead of practitioner_id
> 3. Fetch blocks from calendar_blocks instead of practitioner_calendar_blocks
> 4. All existing functionality must be preserved: day/week view toggle, drag-and-drop, click to create, click to view details, block time creation and editing (Gap 1), context menu
> 5. Add support for event/class calendar types: show sessions as blocks with capacity indicators
> 6. Add support for resource calendar types: show bookings as blocks (same as practitioner but labelled differently)
>
> **Appointments list** at `/dashboard/appointments`:
> Carry forward the existing appointments list view. Update to query bookings by calendar_id.
>
> **Clients page** at `/dashboard/clients`:
> Carry forward from the Gap 3 implementation. Should already work with the guests table.
>
> **Reports** at `/dashboard/reports`:
> Carry forward existing reports. Add SMS usage to the reports page (same data as the dashboard widget but with monthly trend chart).
>
> **Settings** at `/dashboard/settings`:
> Reorganise into sections: Business Profile, Calendars (replaces Staff), Services, Notifications, Plan & Billing, Booking Page.
>
> **Terminology:** All text in the unified scheduling dashboard must use the venue's terminology JSONB. Create or update a `t()` helper that reads from `venue.terminology`.
>
> **Test:** Log in as a Model B venue → see Calendar as the default dashboard view → existing calendar functionality works → bookings display → drag and drop works → block creation and editing works → clients page shows guest list → reports show data → settings show all sections. Log in as a restaurant → see the existing restaurant dashboard, completely unchanged."

### Prompt 6: Unified Booking Page

> **Cursor Prompt:**
>
> "Update the ReserveNI public booking page at `/book/[venue-slug]` to handle unified scheduling venues alongside the existing restaurant booking flow.
>
> **Routing:** On page load, fetch the venue by slug. Check `venue.booking_model`:
> - If 'table_reservation': render the EXISTING restaurant booking page. NO CHANGES.
> - If 'unified_scheduling': render the unified booking flow.
>
> **Unified booking flow** (implemented as a multi-step React component):
>
> Step 1 - Select Service: fetch all active, bookable service_items for this venue. Show as cards: name, duration, price (formatted by price_type), description. Group by category if multiple calendar types exist. If only one service, auto-select and skip.
>
> Step 2 - Select Calendar: fetch calendars that offer the selected service (via calendar_service_assignments). Show as cards: name, photo, next available slot. If only one calendar, auto-select and skip. For events/classes: show available sessions instead (date, time, remaining spots).
>
> Step 3 - Select Date & Time: date picker showing available dates (greyed out dates with no availability). On date select, call GET /api/booking/unified-availability to get available slots. Display slots as selectable time pills. For events/classes: show session times with 'X spots remaining'.
>
> Step 4 - Your Details: name (required), email (required), phone (required), special requests (optional). Show pre_appointment_instructions from the selected service.
>
> Step 5 - Payment (if deposit required): deposit amount displayed, Stripe Elements card form (direct charge on venue's connected Stripe account). Cancellation policy clearly shown.
>
> Step 6 - Confirmed: booking details summary, 'Add to Calendar' button (.ics download), manage booking link, QR code to share.
>
> **Practitioner-specific URLs:** Support `/book/[venue-slug]/[calendar-slug]` for direct links. Fetch the calendar by slug, pass lockedCalendarId to the booking flow, skip Step 2, filter Step 1 to this calendar's services.
>
> **Booking creation:** On form submission, call POST /api/booking/create (or a new unified endpoint). The endpoint:
> 1. Re-validates availability (prevent race conditions)
> 2. Creates guest record (or matches existing by email then phone)
> 3. Creates booking with calendar_id, service_item_id, status, deposit info
> 4. If deposit: create Stripe PaymentIntent, return client_secret for Stripe Elements
> 5. After payment success (or immediately if no deposit): trigger booking confirmation via communication engine
> 6. Log booking.created event
>
> **Mobile-first design.** The booking flow must work perfectly on a phone. Large tap targets, clear step indicators, no horizontal scrolling.
>
> **Test:** Visit /book/[venue-slug] for a Model B venue → see services → select service → see practitioners → select practitioner → see available dates → pick date → see time slots → pick slot → enter details → pay deposit → see confirmation → booking appears on dashboard calendar. Visit /book/[venue-slug]/[practitioner-slug] → practitioner pre-selected → services filtered. Visit /book/[venue-slug] for a restaurant → see the existing restaurant booking page, unchanged."

### Prompt 7: Onboarding Flow & Plan Selection

> **Cursor Prompt:**
>
> "Build the complete onboarding flow for ReserveNI: landing page updates, signup, business type selection, plan selection, payment, and setup wizard. This handles all business types with the two-tier pricing model (Standard £20/calendar/month, Business £79/month flat).
>
> **Landing page** at `/`:
> Update the landing page pricing section to show two cards:
> Card 1 - Standard: £20/month per team member. All features. 200 SMS per calendar. 'Best for: solo practitioners and small teams.'
> Card 2 - Business: £79/month flat. Unlimited calendars. 800 SMS. Table management. Priority support. 'Best for: restaurants and large teams.'
> Include interactive calculator on Standard card. Founding Partner banner for restaurants.
>
> **Signup** at `/signup`:
> Email, password, terms checkbox. Create account. Redirect to /signup/business-type.
>
> **Business type selection** at `/signup/business-type`:
> Visual selector grouped by category. Selection determines booking_model, terminology, defaults. Create the business config file at `lib/business-config.ts` with all supported business types as specified in the implementation plan.
>
> **Plan selection** at `/signup/plan`:
> - If booking_model is 'table_reservation': show ONLY Business plan at £79/month. No Standard option. Founding Partner option if ?plan=founding and spots remain.
> - If booking_model is 'unified_scheduling': show Standard (with calendar count selector, dynamic pricing showing X × £20 = £Y) and Business side by side. At 4+ calendars on Standard, show nudge: 'Business is £79/month with unlimited calendars, 800 SMS, and priority support.'
>
> **Payment** at `/signup/payment`:
> Order summary → Stripe Checkout. Standard: STRIPE_STANDARD_PRICE_ID with quantity. Business: STRIPE_BUSINESS_PRICE_ID. Founding: skip Stripe.
>
> **Stripe webhook** at `/api/webhooks/stripe-onboarding/route.ts`:
> Handle checkout.session.completed → create venue with all fields from metadata. Handle subscription updates, payment failures, cancellation.
>
> **Setup wizard** at `/onboarding`:
> Route by booking_model:
> - 'table_reservation': existing restaurant wizard, NO CHANGES
> - 'unified_scheduling': 4-step wizard (Your Business → Your Team/Calendars → Your Services → Preview & Go Live) as specified in Section 8.2
>
> **Dashboard first-time experience:**
> Welcome banner, setup checklist, empty state with action prompts.
>
> **Access control middleware:**
> Not authenticated → /login. No venue → /signup/business-type. Onboarding incomplete → /onboarding. Cancelled → resubscribe. Complete → /dashboard (routed by booking_model).
>
> **Calendar limit enforcement:**
> Standard tier: when adding a calendar beyond paid count, prompt to increase subscription quantity. At 4+ calendars, suggest Business tier.
>
> **Test the full flow for each path:**
> 1. Restaurant: signup → Business plan only → pay £79 → restaurant wizard → restaurant dashboard
> 2. Solo barber: signup → Standard 1 calendar → pay £20 → unified wizard → calendar dashboard
> 3. Salon 3 stylists: signup → Standard 3 calendars → pay £60 → unified wizard → add 3 practitioners → calendar dashboard
> 4. Founding Partner restaurant: signup → founding → skip payment → restaurant wizard → dashboard
> 5. Large clinic: signup → select 5 calendars → sees nudge for Business → switches to Business → pays £79 → unlimited calendars"

### Prompt 8: Integration Testing & Polish

> **Cursor Prompt:**
>
> "Perform a complete integration test and polish pass on the ReserveNI unified scheduling system. Verify every flow end-to-end and fix any issues.
>
> **End-to-end test scenarios to verify:**
>
> 1. ONBOARDING: Solo barber signs up → Standard plan 1 calendar (£20/month) → setup wizard creates venue, 1 practitioner, 4 default services → booking page live → dashboard shows calendar
>
> 2. ONBOARDING: Restaurant signs up → Business plan only shown → £79/month → existing restaurant wizard → all restaurant features working including table management
>
> 3. ONLINE BOOKING: Client visits barber's booking page → selects 'Men's Cut' → sees barber's available slots → picks 2pm tomorrow → enters name/email/phone → pays £5 deposit → sees confirmation → booking appears on barber's calendar → confirmation email AND SMS sent to client → SMS logged in sms_log → sms_usage incremented
>
> 4. PRACTITIONER URL: Client visits /book/barber-shop/sarah → practitioner pre-selected → services filtered to Sarah's → completes booking → assigned to Sarah
>
> 5. REMINDER FLOW: Booking exists for tomorrow at 2pm → reminder cron runs → 24h reminder email + SMS sent with confirm-or-cancel link → client clicks confirm → booking status updated → 2 hours before: final SMS nudge sent → client arrives → staff checks in → status Completed → 4 hours later: post-visit email sent with feedback link
>
> 6. CANCELLATION: Client receives confirmation email → clicks manage link → cancels booking → if within cancellation window: deposit refunded → if outside: deposit forfeited → cancellation email sent → slot freed on calendar
>
> 7. NO-SHOW: Appointment time passes → staff marks no-show → no-show email sent → deposit forfeited → event logged
>
> 8. CALENDAR: Staff opens calendar → sees all today's appointments → drags appointment to different time → booking updated → client receives rescheduled notification → creates block (lunch break) → block appears on calendar → edits block end time → block resizes → deletes block → removed
>
> 9. SMS TRACKING: Send 5 SMS messages → dashboard shows '5/200 used'. Send messages until over allowance (simulate) → dashboard shows overage count and estimated charge. Run overage billing cron → Stripe usage record created.
>
> 10. CALENDAR LIMIT: Standard venue with 1 calendar tries to add second practitioner → prompted to increase subscription → confirms → Stripe quantity updated → venue calendar_count updated → second practitioner added successfully
>
> 11. RESTAURANT REGRESSION: All existing restaurant functionality works: booking page, deposits, confirmations, SMS reminders, confirm-or-cancel, day sheet, table grid, floor plan, reporting, guest management. NOTHING has changed for restaurants.
>
> 12. TERMINOLOGY: Barber dashboard shows 'Clients', 'Appointments'. Physio dashboard shows 'Patients', 'Appointments'. Restaurant shows 'Guests', 'Reservations'.
>
> **Polish items:**
> - Loading states on all async operations
> - Error messages that are human-readable (not technical errors)
> - Mobile responsiveness on booking page and dashboard
> - Accessibility: all buttons have aria labels, forms have proper labelling
> - Empty states on all list views with helpful action prompts
> - Consistent design system: same colours, typography, spacing throughout
>
> **Fix any failing scenarios** from the list above. Every scenario must pass completely before this prompt is considered done."

---

## 11. TESTING PROTOCOL

After ALL prompts are complete, run this final verification:

### Smoke Tests (must all pass)

| Test | Expected Result |
|---|---|
| Restaurant signup → dashboard | Full restaurant experience, table management available |
| Solo barber signup → dashboard | Calendar view, 1 practitioner column, all services |
| Online booking → calendar | Booking appears in real-time on calendar |
| Practitioner URL booking | Practitioner pre-selected, services filtered |
| 24h reminder cron | SMS + email sent with confirm-or-cancel link |
| 2h reminder cron | SMS only sent for confirmed bookings |
| Post-visit cron | Email sent 4+ hours after completed booking |
| Confirm via link | Booking status updates to Confirmed |
| Cancel via link | Booking cancelled, deposit refunded if applicable |
| No-show marking | Email sent, deposit forfeited |
| SMS usage tracking | Counter increments, dashboard shows correct count |
| Calendar drag-and-drop | Booking time updated, reschedule notification sent |
| Block creation/edit/delete | Calendar blocks work correctly |
| Add calendar (Standard) | Subscription quantity increases, billing updates |
| Terminology | Business-type-specific labels throughout dashboard |
| Venue timezone | Reminders and post-visit use `venues.timezone`; booking “today” matches venue local date |
| Event/class sessions | `event_sessions` materialised per §2.6; capacity enforced; cancelled session not bookable |
| RLS | New tables use staff JWT email pattern (§2.4); `increment_sms_usage` not callable by anon |
| SMS segments | `sms_log.segment_count` matches Twilio (or GSM/UCS-2 estimate per §4.6) |
| Stripe SMS overage | Usage records hit metered `stripe_sms_subscription_item_id` (§5.4) |

### Performance Targets

| Operation | Target |
|---|---|
| Availability query (single calendar, single date) | < 100ms |
| Calendar grid load (5 calendars, 1 day) | < 300ms |
| Booking creation | < 500ms |
| Dashboard initial load | < 1s |
| SMS send | < 2s |
| Email send | < 3s |

---

## APPENDIX: Environment Variables (Complete List)

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=xxx
SUPABASE_SECRET_KEY=xxx

# Stripe (deposits - existing)
STRIPE_SECRET_KEY=sk_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx

# Stripe (subscriptions - new)
STRIPE_STANDARD_PRICE_ID=price_xxx
STRIPE_BUSINESS_PRICE_ID=price_xxx
STRIPE_SMS_OVERAGE_PRICE_ID=price_xxx
STRIPE_ONBOARDING_WEBHOOK_SECRET=whsec_xxx

# Communications
SENDGRID_API_KEY=SG.xxx
SENDGRID_FROM_EMAIL=bookings@reserveni.com
TWILIO_ACCOUNT_SID=xxx
TWILIO_AUTH_TOKEN=xxx
TWILIO_PHONE_NUMBER=+44xxx

# Cron
CRON_SECRET=xxx

# App
NEXT_PUBLIC_BASE_URL=http://localhost:3000  (or https://reserve-ni.vercel.app in production)
```
