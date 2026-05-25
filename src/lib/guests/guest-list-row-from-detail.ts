import type { GuestDetailResponse, GuestListRow } from '@/types/contacts';

/** Build a directory list row from GET /api/venue/guests/[id] (e.g. deep link from a booking). */
export function guestListRowFromDetailResponse(detail: GuestDetailResponse): GuestListRow {
  const g = detail.guest;
  const s = detail.stats;
  return {
    id: g.id,
    first_name: g.first_name,
    last_name: g.last_name,
    email: g.email,
    phone: g.phone,
    tags: Array.isArray(g.tags) ? g.tags : [],
    visit_count: g.visit_count ?? 0,
    no_show_count: g.no_show_count ?? 0,
    last_visit_date: g.last_visit_date ?? null,
    created_at: g.created_at,
    identifiability_tier: 'named',
    marketing_opt_out: Boolean(g.marketing_opt_out),
    marketing_consent: Boolean(g.marketing_consent),
    total_bookings: s.total_bookings ?? 0,
    cancelled_count: s.cancellations ?? 0,
    upcoming_booking_count: 0,
    next_booking_date: null,
    next_booking_time: null,
    paid_deposit_pence: s.total_deposit_pence_paid ?? 0,
    ...(g.custom_fields ? { custom_fields: g.custom_fields } : {}),
  };
}
