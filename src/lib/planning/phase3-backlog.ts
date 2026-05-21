/**
 * Phase 3 product backlog (reference for prioritisation - not a commitment schedule).
 * Updated May 2026 after Phase 1a completion — see Docs/ReserveNI-Appointments-Review-And-Roadmap.md.
 */
export const PHASE_3_BACKLOG_COMPLETED = [
  'Any-available-practitioner appointment pooling (flag: any_available_practitioner)',
  'Guest-facing appointment reschedule on manage link (flag: guest_self_reschedule)',
  'Appointment waitlist v2 with modes and dashboard page (flag: waitlist_v2)',
  'Calendar blocks UI on practitioner calendar day/week',
  'Playwright E2E: book/pay/confirm + guest self-reschedule (RUN_E2E_SMOKE)',
] as const;

export const PHASE_3_BACKLOG_ITEMS = [
  'Phase 1b: saved cards (guest account) + late reschedule fees',
  'Phase 1b: pay-balance link on booking',
  'Phase 1b: appointment packages (prepaid service bundles)',
  'Patch test registry + expiry booking gate (P1b.5 or P2.2)',
  'Consultation form builder (P2.1)',
  'Review request automation post-visit (P2.3)',
  'Reporting enhancements and guest CRM export',
  'Reserve with Google / Book with Google (P3.1)',
] as const;
