-- Truncate all application data in `public` (venues, bookings, staff, imports, etc.).
--
-- This is a manual maintenance script — NOT a migration. It does not run automatically.
-- Run from Supabase Dashboard → SQL → SQL Editor for each project (staging, then production).
--
-- Inventory: 86 `public` tables (alphabetical), from every `CREATE TABLE` in
-- `supabase/migrations`. When you add a migration that creates a new `public` table,
-- add its name to the TRUNCATE list and to the drift-check array below.
--
-- What this does NOT clear (do separately if needed):
--   - auth.users (Dashboard → Authentication, or Admin API)
--   - Storage (bucket objects / files, e.g. imports CSV uploads)
--   - Migration history (supabase_migrations.* — left untouched)
--   - Other schemas (storage, realtime, vault, etc.)
--
-- Append-only tables (row DELETE/UPDATE blocked by trigger): PostgreSQL still
-- allows TRUNCATE TABLE on those tables; row-level DELETE triggers are not fired for TRUNCATE.
--
-- Drift check (run in SQL Editor; both result sets should be empty when this script matches the DB):
--   WITH listed AS (
--     SELECT unnest(ARRAY[
--       'areas','appointment_services','availability_blocks','booking_log_email_deliveries',
--       'booking_restriction_exceptions','booking_restrictions','booking_short_links',
--       'booking_table_assignments','booking_ticket_lines','bookings','calendar_blocks',
--       'calendar_service_assignments','class_booking_groups','class_checkout_transactions',
--       'class_course_enrollments','class_course_products','class_course_session_enrollments',
--       'class_credit_ledger','class_credit_products','class_credit_purchase_fulfillments',
--       'class_instances','class_membership_allowance_ledger','class_membership_products',
--       'class_memberships','class_payment_allocations','class_recurring_materialization_events',
--       'class_recurring_reservations','class_timetable','class_types','combination_auto_overrides',
--       'communication_logs','communication_settings','communications','contact_audit_events',
--       'custom_client_fields','event_sessions','event_ticket_types','events','experience_events',
--       'floor_plan_table_positions','floor_plans','guest_documents','guest_household_members',
--       'guest_households','guest_loyalty_ledger','guest_marketing_consent_events',
--       'guest_merge_events','guests','import_booking_references','import_booking_rows',
--       'import_column_mappings','import_files','import_records','import_sessions',
--       'import_validation_issues','party_size_durations','practitioner_calendar_blocks',
--       'practitioner_leave_periods','practitioner_services','practitioners',
--       'reconciliation_alerts','service_capacity_rules','service_items',
--       'service_schedule_exceptions','service_variants','sms_log','sms_usage','staff',
--       'staff_calendar_assignments','support_audit_events','support_sessions','table_blocks',
--       'table_combination_members','table_combinations','table_statuses','unified_calendars',
--       'user_class_credit_balances','user_devices','user_profiles','venue_customer_stripe',
--       'venue_resources','venue_services','venue_tables','venues','waitlist_entries','webhook_events'
--     ]) AS tablename
--   )
--   SELECT 'extra_in_public_schema'::text AS drift_kind, t.tablename
--   FROM pg_tables t
--   WHERE t.schemaname = 'public'
--     AND NOT EXISTS (SELECT 1 FROM listed l WHERE l.tablename = t.tablename)
--   UNION ALL
--   SELECT 'missing_table_apply_migrations_first', l.tablename
--   FROM listed l
--   WHERE NOT EXISTS (
--     SELECT 1 FROM pg_tables t
--     WHERE t.schemaname = 'public' AND t.tablename = l.tablename
--   )
--   ORDER BY 1, 2;
--
-- Requires migrations to be applied so every table exists.

BEGIN;

TRUNCATE TABLE
  areas,
  appointment_services,
  availability_blocks,
  booking_log_email_deliveries,
  booking_restriction_exceptions,
  booking_restrictions,
  booking_short_links,
  booking_table_assignments,
  booking_ticket_lines,
  bookings,
  calendar_blocks,
  calendar_service_assignments,
  class_booking_groups,
  class_checkout_transactions,
  class_course_enrollments,
  class_course_products,
  class_course_session_enrollments,
  class_credit_ledger,
  class_credit_products,
  class_credit_purchase_fulfillments,
  class_instances,
  class_membership_allowance_ledger,
  class_membership_products,
  class_memberships,
  class_payment_allocations,
  class_recurring_materialization_events,
  class_recurring_reservations,
  class_timetable,
  class_types,
  combination_auto_overrides,
  communication_logs,
  communication_settings,
  communications,
  contact_audit_events,
  custom_client_fields,
  event_sessions,
  event_ticket_types,
  events,
  experience_events,
  floor_plan_table_positions,
  floor_plans,
  guest_documents,
  guest_household_members,
  guest_households,
  guest_loyalty_ledger,
  guest_marketing_consent_events,
  guest_merge_events,
  guests,
  import_booking_references,
  import_booking_rows,
  import_column_mappings,
  import_files,
  import_records,
  calendar_date_overrides,
  import_sessions,
  import_validation_issues,
  party_size_durations,
  practitioner_calendar_blocks,
  practitioner_leave_periods,
  practitioner_services,
  practitioners,
  reconciliation_alerts,
  service_capacity_rules,
  service_items,
  service_schedule_exceptions,
  service_variants,
  sms_log,
  sms_usage,
  staff,
  staff_calendar_assignments,
  support_audit_events,
  support_sessions,
  table_blocks,
  table_combination_members,
  table_combinations,
  table_statuses,
  unified_calendars,
  user_class_credit_balances,
  user_devices,
  user_profiles,
  venue_customer_stripe,
  venue_resources,
  venue_services,
  venue_tables,
  venues,
  waitlist_entries,
  webhook_events
RESTART IDENTITY CASCADE;

COMMIT;
