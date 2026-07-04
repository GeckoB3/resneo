-- =============================================================================
-- Reserve NI — Database schema reference (curated map)
-- =============================================================================
-- Last regenerated: 4 Jul 2026, from supabase/migrations/ (230 migrations).
--
-- THIS FILE IS NOT THE SOURCE OF TRUTH.
-- The canonical schema is the ordered migration set in `supabase/migrations/`.
-- This file is a hand-curated, domain-grouped INVENTORY to help you find your
-- way around — it deliberately omits column-level detail, because that detail
-- drifts. For the authoritative definition of any table, open the migration
-- that creates it.
--
-- To get a real, complete schema dump from a live database, run:
--     supabase db dump --schema public > schema.generated.sql
-- (or `pg_dump --schema-only --schema=public <connection-string>`).
--
-- When you add a migration that creates or drops a table or enum, update the
-- inventory below and bump the "Last regenerated" date.
-- =============================================================================


-- =============================================================================
-- ENUMS
-- =============================================================================
-- Values below are current as of the regeneration date. Enums gain values via
-- `ALTER TYPE ... ADD VALUE`; check the latest migration if in doubt.

-- staff_role                    ('admin','staff')
-- booking_status                ('Pending','Booked','Confirmed','Cancelled','No-Show','Completed','Seated')
-- booking_source                ('online','phone','walk-in','booking_page','import','widget')
-- deposit_status                ('Not Required','Pending','Paid','Refunded','Forfeited','Failed','Waived')
-- booking_model                 ('table_reservation','practitioner_appointment','unified_scheduling',
--                                'event_ticket','class_session','resource_booking')
--                               NB: 6 enum values; conceptually 5 booking models —
--                               Model B has both 'practitioner_appointment' and 'unified_scheduling'.
--                               See Docs/Resneo_Booking_Models_Reference.md (canonical).
-- waitlist_status               ('waiting','offered','confirmed','expired','cancelled')
-- class_payment_requirement     ('none','deposit','full_payment')
-- block_type                    calendar/availability block kinds (incl. 'amended_hours')

-- Class-commerce enums — see migrations 20260701/20260702* and 20260729*:
--   class_course_enrollment_status, class_credit_ledger_reason,
--   class_membership_status, class_recurring_reservation_status

-- Linked-accounts enums — see migration 20260919120000_linked_accounts.sql:
--   link_status, link_action_level, link_calendar_visibility, link_termination_reason

-- referral_status               ('pending','referee_signed_up','credited','failed','void')
--                               Venue-to-venue referral lifecycle; see 20260527120200_referrals.sql
-- sales_attribution_status      ('pending','active','churned')
--                               Sales-agent signup attribution lifecycle; see 20261211130000_sales_programme.sql


-- =============================================================================
-- TABLE INVENTORY (public schema, grouped by domain)
-- =============================================================================
-- ~123 tables. For each table's columns, FKs and RLS, open the creating migration.

-- --- Core venue & identity ---------------------------------------------------
-- venues                         Core venue profile, booking_model, enabled_models,
--                                terminology, opening_hours / booking_rules /
--                                deposit_config / availability_config (jsonb), feature_flags
-- staff                          Venue staff; admin/staff role; invite + auth linkage
-- staff_calendar_assignments      Staff scoped to specific bookable calendars
-- user_profiles                  App profile 1:1 with auth.users (customer + staff)
-- user_devices                   Push device rows (future mobile)
-- platform_superusers            Resneo platform-side admin access

-- --- Guests & CRM ------------------------------------------------------------
-- guests                          One row per guest per venue (unique venue_id+email)
-- guest_documents                 Uploaded / signed documents on a contact
-- guest_households                CRM household grouping
-- guest_household_members         Household membership
-- guest_loyalty_ledger            Loyalty point ledger (manual admin adjustments)
-- guest_marketing_consent_events  GDPR consent change audit
-- guest_merge_events              Contact-merge audit
-- contact_audit_events            General contact-change audit
-- custom_client_fields            Venue-defined custom CRM fields

-- --- Bookings core & audit ---------------------------------------------------
-- bookings                         Central booking row for ALL models; model FKs:
--                                  practitioner_id, appointment_service_id,
--                                  experience_event_id, class_instance_id,
--                                  resource_id, event_session_id, calendar_id
-- booking_ticket_lines             Ticket / line breakdown (Models C/D)
-- booking_short_links              Short links for manage/confirm pages
-- events                           IMMUTABLE append-only booking audit log
-- webhook_events                   Stripe / external webhook idempotency log
-- reconciliation_alerts            Payment / data reconciliation findings
-- cron_runs                        Run history for scheduled cron jobs (success,
--                                  duration, response detail); powers platform health page

-- --- Appointments & unified scheduling (Model B) -----------------------------
-- practitioners                    Bookable staff who take appointments
-- practitioner_services            Which practitioners offer which services
-- practitioner_leave_periods       Leave / days off
-- practitioner_calendar_blocks     Manual calendar blocks (block-time UI)
-- appointment_services             Service catalogue (duration, buffers, price, deposit)
-- service_variants                 Per-service variants
-- service_items                    Service catalogue items
-- service_capacity_rules           Capacity rules per service
-- service_schedule_exceptions      Per-service availability exceptions
-- venue_services                   Venue-level service configuration
-- unified_calendars                Bookable calendar columns
-- calendar_service_assignments     Which services a calendar offers
-- calendar_blocks                  Calendar-level blocks
-- availability_blocks              Availability block entries
-- party_size_durations             Duration by party size
-- processing time blocks           (columns on services/bookings — see 20260830* migration)

-- --- Add-ons -----------------------------------------------------------------
-- addon_groups                     Container for selection constraints on optional add-ons
-- addons                           Selectable options within an addon_group (soft-delete via archived_at)
-- service_addon_groups             Junction linking an addon_group to one or many services
-- booking_addons                   Immutable snapshot of add-ons chosen at booking time

-- --- Restaurant tables (Model A) ---------------------------------------------
-- venue_tables                     Physical tables
-- areas                            Dining areas / sections
-- floor_plans                      Floor plan definitions
-- floor_plan_table_positions       Table positions on a floor plan
-- table_blocks                     Table block-outs
-- table_statuses                   Live table status
-- table_combinations               Combined-table groupings
-- table_combination_members        Members of a combination
-- combination_auto_overrides       Auto-combination engine overrides
-- booking_table_assignments        Booking ↔ table assignment

-- --- Events (Model C) --------------------------------------------------------
-- experience_events                Ticketed events / experiences
-- event_ticket_types               Ticket tiers per event
-- event_sessions                   Calendar sessions materialised from events

-- --- Classes (Model D) -------------------------------------------------------
-- class_types                      Recurring class definitions
-- class_timetable                  Weekly schedule entries
-- class_instances                  Individual scheduled class sessions
-- class_booking_groups             Group bookings for classes
-- class_recurring_reservations     Recurring class reservations
-- class_recurring_materialization_events  Recurring-materialisation audit

-- --- Class commerce ----------------------------------------------------------
-- class_credit_products            Purchasable credit packs
-- class_credit_ledger              Credit earn / spend ledger
-- class_credit_purchase_fulfillments  Credit purchase fulfilment
-- user_class_credit_balances       Computed per-user credit balance
-- class_course_products            Course / series products
-- class_course_enrollments         Course enrolments
-- class_course_session_enrollments Per-session enrolment within a course
-- class_membership_products        Membership products
-- class_memberships                Active memberships
-- class_membership_allowance_ledger  Membership allowance usage
-- class_checkout_transactions      Class-commerce checkout transactions
-- class_payment_allocations        Payment ↔ entitlement allocation

-- --- Resources (Model E) -----------------------------------------------------
-- venue_resources                  Bookable facilities / equipment

-- --- Waitlist ----------------------------------------------------------------
-- waitlist_entries                 Waitlist joins (restaurant + appointment waitlist v2)
-- waitlist_slot_opportunities      Appointment-waitlist slot offers

-- --- Booking rules & restrictions --------------------------------------------
-- booking_restrictions             Venue booking restriction rules
-- booking_restriction_exceptions   Exceptions to restriction rules

-- --- Communications ----------------------------------------------------------
-- communications                   Outbound communication records
-- communication_logs               Per-booking send log (unique booking_id+message_type)
-- communication_settings           Venue comms configuration
-- sms_log                           SMS send log
-- sms_usage                          SMS usage / allowance metering
-- booking_log_email_deliveries      Daily booking-log email delivery records

-- --- Payments ----------------------------------------------------------------
-- venue_customer_stripe             Venue ↔ Stripe customer linkage (per-venue Connect)

-- --- Linked accounts & collectives -------------------------------------------
-- account_links                     Pairwise venue links
-- account_link_audit_log            Link lifecycle audit
-- account_link_notifications        Per-venue in-app notification feed for Linked Accounts
-- venue_collectives                 Multi-venue collective groupings
-- venue_collective_members          Collective membership
-- collective_service_items          Combined booking page service items (Model B collectives)
-- collective_service_providers      Which collective member/venue service fulfils an item

-- --- Import tool -------------------------------------------------------------
-- import_sessions                   Import wizard sessions
-- import_files                      Uploaded import files
-- import_records                    Parsed import records (clients etc.)
-- import_column_mappings            AI-assisted column mapping
-- import_validation_issues          Validation findings
-- import_booking_rows               Parsed booking rows
-- import_booking_references         Resolved booking FK references
-- import_ai_mapping_cache           Cached AI header-to-field mappings (service-role only)
-- external_record_refs              Mapping to source-platform record ids

-- --- Platform support --------------------------------------------------------
-- support_sessions                  Superuser sign-in-as venue context
-- support_audit_events              Append-only support action log

-- --- Platform admin ----------------------------------------------------------
-- platform_invoices                 Subscription revenue ledger (Stripe invoice webhook)
-- platform_audit_events             Append-only log of superuser platform actions
-- platform_announcements            Dismissible dashboard banners set by superusers
-- platform_announcement_dismissals  Per-venue dismissal of an announcement

-- --- Referrals ---------------------------------------------------------------
-- referral_codes                    Per-venue referral code (unique per venue)
-- referrals                         Venue-to-venue referral records + credit state
-- referral_audit                    Append-only referral status-change audit

-- --- Sales programme ---------------------------------------------------------
-- salespeople                       External Resneo sales agents
-- sales_codes                       Signup codes issued to salespeople
-- sales_attributions                Venue signups attributed to a salesperson/code
-- sales_invoice_revenue             Per-venue monthly paid revenue for a signup
-- sales_bonus_tiers                 Per-salesperson bonus thresholds
-- sales_bonus_awards                Bonus awards earned per month
-- sales_monthly_statements          Per-salesperson monthly commission statements

-- --- Metrics -----------------------------------------------------------------
-- venue_baseline_metrics_snapshots  Weekly per-venue baseline metric snapshots

-- --- Compliance records (appointment tiers) ----------------------------------
-- compliance_types                  Venue definitions of a record type (patch test, consent, …)
-- compliance_type_versions          Immutable form-schema snapshots per type
-- compliance_records                Captured instances of a type against a guest
-- service_compliance_requirements   Links Model B services (appointment_services
--                                   or service_items) to required types
-- compliance_form_links             Single-use public submission links (/p/forms/{code})
-- compliance_audit_events           Append-only compliance audit trail


-- =============================================================================
-- ROW-LEVEL SECURITY
-- =============================================================================
-- Staff are identified by auth.jwt() ->> 'email'. Staff may read/write rows
-- where venue_id IN (SELECT venue_id FROM staff WHERE email = current_user_email).
-- Customer-facing access goes through guests.user_id and account-safe views/RPCs.
-- Public (anon) read policies expose active practitioners, services, events,
-- classes and resources for the public booking flows.
-- New tables follow the same per-venue tenancy pattern; see each migration.


-- =============================================================================
-- TRIGGERS & APPEND-ONLY GUARANTEES
-- =============================================================================
-- events_append_only        BEFORE UPDATE/DELETE on `events` → raise exception.
-- booking_events_trigger     AFTER INSERT/UPDATE on `bookings` → write `events`
--                            rows (booking_created, booking_status_changed, …).
-- support_audit_events and account_link_audit_log are likewise append-only.
-- compliance_audit_append_only  BEFORE UPDATE/DELETE on `compliance_audit_events`.


-- =============================================================================
-- RPC / HELPERS (selected — see migrations for the full set)
-- =============================================================================
-- handle_new_user                     auth.users insert trigger → user_profiles
-- claim_user_account                  Link a guest to an authenticated account
-- request_account_deletion            Start the GDPR deletion grace period
-- refresh_guest_booking_aggregates    Recompute guest visit/spend aggregates
-- lookup_auth_user_id_by_email        service_role email → auth user id
-- reconcileCollectivesAfterLinkChange Collective membership cascade (see linked accounts)
