-- Reserve NI - Database schema reference
-- Apply via Supabase migrations in supabase/migrations/ (in order).

-- =============================================================================
-- ENUMS
-- =============================================================================

-- CREATE TYPE staff_role AS ENUM ('admin', 'staff');
-- CREATE TYPE booking_status AS ENUM ('Pending','Confirmed','Cancelled','No-Show','Completed','Seated');
-- CREATE TYPE booking_source AS ENUM ('online', 'phone', 'walk-in');
-- CREATE TYPE deposit_status AS ENUM ('Not Required','Pending','Paid','Refunded','Forfeited');

-- =============================================================================
-- TABLES
-- =============================================================================

-- venues - core venue profile
-- id (uuid PK), name, slug (unique), address, phone, email, cover_photo_url,
-- opening_hours (jsonb), booking_rules (jsonb), deposit_config (jsonb),
-- availability_config (jsonb), daily_booking_log_email_config (jsonb),
-- require_account_login_for_bookings (boolean), timezone (default 'Europe/London'), created_at, updated_at

-- staff - venue staff; email retained for invites; user_id preferred for auth linkage
-- id (uuid PK), venue_id (FK → venues), user_id (FK → auth.users, nullable), email, name, role (staff_role),
-- permissions (jsonb), invited_at, accepted_at, revoked_at, phone, created_at, updated_at

-- user_profiles - application profile 1:1 with auth.users (customer + staff overlap)
-- id (uuid PK, FK → auth.users), display_name, first_name, last_name, phone, profile_image_url,
-- locale, timezone, notification_preferences (jsonb), default_login_destination ('account'|'dashboard'|'ask'),
-- stripe_customer_id, account_claimed_at, last_active_at, deleted_at (soft-delete grace), created_at, updated_at

-- user_devices - optional push device rows (future mobile)
-- id (uuid PK), user_id (FK), platform, push_token, device_name, app_version, os_version, last_seen_at, created_at

-- guests - one per guest per venue; unique (venue_id, email); index (venue_id, phone)
-- id (uuid PK), venue_id (FK), user_id (FK → auth.users, nullable), name, email, phone (E.164),
-- marketing_consent, marketing_consent_at, marketing_opt_out, source, first_booked_at, last_booked_at,
-- total_bookings_count, total_spent_minor, waiver_signed_at, waiver_version, tags, custom_fields,
-- global_guest_hash, visit_count, identifiability_tier (generated), created_at, updated_at
-- guests_account_safe view: customer-safe projection excluding venue-private CRM fields

-- RPC/helpers: handle_new_user (auth trigger), claim_user_account, request_account_deletion,
-- refresh_guest_booking_aggregates, lookup_auth_user_id_by_email (service_role)

-- bookings
-- id (uuid PK), venue_id (FK), guest_id (FK), booking_date, booking_time, party_size,
-- status (booking_status), source (booking_source), dietary_notes, occasion, special_requests,
-- deposit_amount_pence, deposit_status, stripe_payment_intent_id, cancellation_deadline,
-- created_by_staff_id, cancelled_by_staff_id, cancellation_actor_type, created_at, updated_at

-- events - immutable append-only audit log; no UPDATE/DELETE
-- id (uuid PK), venue_id (FK), booking_id (FK nullable), event_type (text), payload (jsonb), created_at

-- =============================================================================
-- MULTI-MODEL BOOKING (added 2026-03-27)
-- =============================================================================

-- CREATE TYPE booking_model AS ENUM ('table_reservation','practitioner_appointment','event_ticket','class_session','resource_booking');

-- venues additions:
--   booking_model (booking_model, default 'table_reservation')
--   business_type (text), business_category (text), terminology (jsonb)

-- bookings additions:
--   guest_attendance_confirmed_at (timestamptz, nullable) - guest tapped "I'll be there" on reminder link
--   practitioner_id (FK → practitioners), appointment_service_id (FK → appointment_services)
--   experience_event_id (FK → experience_events), class_instance_id (FK → class_instances)
--   resource_id (FK → venue_resources), booking_end_time (time)

-- practitioners - staff who take appointments (Model B)
-- id (uuid PK), venue_id (FK), staff_id (FK nullable), name, email, phone,
-- working_hours (jsonb), break_times (jsonb), days_off (jsonb), is_active, sort_order

-- appointment_services - service menu (Model B)
-- id (uuid PK), venue_id (FK), name, description, duration_minutes, buffer_minutes,
-- price_pence, deposit_pence, colour, is_active, sort_order

-- practitioner_services - which practitioners offer which services (Model B)
-- id (uuid PK), practitioner_id (FK), service_id (FK), custom_duration_minutes, custom_price_pence

-- experience_events - ticketed events/experiences (Model C)
-- id (uuid PK), venue_id (FK), name, description, event_date, start_time, end_time,
-- capacity, image_url, is_recurring, recurrence_rule, parent_event_id, is_active

-- event_ticket_types - ticket tiers per event (Model C)
-- id (uuid PK), event_id (FK), name, price_pence, capacity, sort_order

-- class_types - recurring class definitions (Model D)
-- id (uuid PK), venue_id (FK), name, description, duration_minutes, capacity,
-- instructor_id (FK → practitioners), price_pence, colour, is_active

-- class_timetable - weekly schedule entries (Model D)
-- id (uuid PK), class_type_id (FK), day_of_week, start_time, is_active

-- class_instances - individual scheduled class sessions (Model D)
-- id (uuid PK), class_type_id (FK), timetable_entry_id (FK), instance_date,
-- start_time, capacity_override, is_cancelled, cancel_reason

-- venue_resources - bookable facilities/equipment (Model E)
-- id (uuid PK), venue_id (FK), name, resource_type, min_booking_minutes,
-- max_booking_minutes, slot_interval_minutes, price_per_slot_pence,
-- availability_hours (jsonb), is_active, sort_order

-- booking_ticket_lines - ticket breakdown per booking (Models C/D)
-- id (uuid PK), booking_id (FK), ticket_type_id (FK nullable), label, quantity, unit_price_pence

-- =============================================================================
-- ROW-LEVEL SECURITY
-- =============================================================================
-- Staff identified by auth.jwt() ->> 'email'. Staff can only read/write rows
-- where venue_id IN (SELECT venue_id FROM staff WHERE email = current_user_email).
-- All new tables follow the same pattern. Public read policies allow anon to
-- read active practitioners, services, events, classes, and resources.

-- =============================================================================
-- TRIGGERS
-- =============================================================================
-- events_append_only: BEFORE UPDATE/DELETE on events → raise exception.
-- booking_events_trigger: AFTER INSERT OR UPDATE on bookings → insert into events
--   (booking_created on INSERT; booking_status_changed when status changes).

-- =============================================================================
-- PLATFORM SUPPORT SESSIONS (see migration 20260426180000_support_sessions_and_audit.sql)
-- =============================================================================
-- support_sessions — superuser sign-in-as venue context (60m default, normal selected-staff access).
-- support_audit_events — append-only log (session lifecycle + api_mutation rows).
