/**
 * P0.6 baseline metrics — shapes stored in snapshots and returned from reports API.
 */

export interface VenueBaselineNoShowMetrics {
  no_show_count: number;
  eligible_count: number;
  rate_pct: number;
}

export interface VenueBaselineRescheduleMetrics {
  /** Date/time changes detected from booking_modified events. */
  modifications_count: number;
  /** booking_modification email/SMS sent (proxy for staff-mediated reschedule comms). */
  modification_notifications_count: number;
  /** modification_notifications / modifications (0 if none). */
  reschedule_via_email_rate_pct: number;
  guest_self_reschedule_count: number;
  staff_reschedule_count: number;
  unknown_actor_reschedule_count: number;
  /** guest_self / modifications where actor is known. */
  guest_self_reschedule_rate_pct: number;
}

export interface VenueBaselineCancellationRebookMetrics {
  cancellations_with_guest: number;
  rebooked_within_7d: number;
  rebooked_within_30d: number;
  rebook_rate_7d_pct: number;
  rebook_rate_30d_pct: number;
  median_rebook_gap_hours: number | null;
  p75_rebook_gap_hours: number | null;
}

export interface VenueBaselineStaffTimeToBookMetrics {
  sample_count: number;
  median_duration_ms: number | null;
  p75_duration_ms: number | null;
  returning_guest: {
    sample_count: number;
    median_duration_ms: number | null;
  };
}

export interface VenueBaselineMetrics {
  period: { from: string; to: string };
  scope: 'appointments' | 'all';
  no_show: VenueBaselineNoShowMetrics;
  reschedule: VenueBaselineRescheduleMetrics;
  cancellation_rebook: VenueBaselineCancellationRebookMetrics;
  staff_time_to_book: VenueBaselineStaffTimeToBookMetrics;
  computed_at: string;
}

export type BaselineSnapshotKind = 'rolling_90d' | 'weekly' | 'manual';
