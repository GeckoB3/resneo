import type { SupabaseClient } from '@supabase/supabase-js';
import type { BookingDetailCommunicationRow } from '@/lib/booking/booking-detail-communications';

export interface StaffBookingDetailBundle {
  area_name: string | null;
  service_variant_name: string | null;
  service_variant_price_pence: number | null;
  guest: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
    visit_count?: number | null;
    last_visit_date?: string | null;
    tags?: string[] | null;
    customer_profile_notes?: string | null;
  } | null;
  events: Array<{
    id: string;
    event_type: string;
    payload: unknown;
    created_at: string;
  }>;
  communications: BookingDetailCommunicationRow[];
  table_assignments: Array<{ id: string; name: string }>;
  addons: Array<Record<string, unknown>>;
}

type CommLogRow = {
  id: string;
  message_type: string;
  channel: string;
  status: string;
  created_at: string;
  sent_at: string | null;
  recipient: string | null;
  error_message: string | null;
};

type LegacyCommRow = {
  id: string;
  message_type: string;
  channel: string;
  status: string;
  created_at: string;
  recipient_email: string | null;
  recipient_phone: string | null;
};

type TableAssignmentRow = {
  table_id: string;
  table: { id: string; name: string } | null;
};

function mergeCommunications(
  logs: CommLogRow[],
  legacy: LegacyCommRow[],
): BookingDetailCommunicationRow[] {
  const fromLogs = logs.map((r) => ({
    id: r.id,
    message_type: r.message_type,
    channel: r.channel,
    status: r.status,
    created_at: r.sent_at ?? r.created_at,
    recipient: r.recipient,
    error_message: r.error_message,
  }));

  const fromLegacy = legacy.map((r) => ({
    id: r.id,
    message_type: r.message_type,
    channel: r.channel,
    status: r.status,
    created_at: r.created_at,
    recipient: r.recipient_email ?? r.recipient_phone ?? null,
    error_message: null,
  }));

  return [...fromLogs, ...fromLegacy].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

function mapTableAssignments(rows: TableAssignmentRow[]): Array<{ id: string; name: string }> {
  return rows.map((a) => {
    const tbl = a.table;
    return { id: tbl?.id ?? a.table_id, name: tbl?.name ?? 'Unknown' };
  });
}

/**
 * Loads booking detail satellite rows in a single `staff_booking_detail_bundle` RPC.
 */
export async function loadStaffBookingDetailBundle(
  db: SupabaseClient,
  bookingId: string,
  venueId: string,
  options?: { includeTimeline?: boolean },
): Promise<StaffBookingDetailBundle | null> {
  const { data, error } = await db.rpc('staff_booking_detail_bundle', {
    p_booking_id: bookingId,
    p_venue_id: venueId,
    p_include_timeline: options?.includeTimeline ?? true,
  });

  if (error) {
    console.error('[loadStaffBookingDetailBundle] rpc failed:', error.message, {
      bookingId,
      venueId,
    });
    throw error;
  }

  if (data == null || typeof data !== 'object') {
    return null;
  }

  const raw = data as Record<string, unknown>;
  const logs = Array.isArray(raw.communication_logs)
    ? (raw.communication_logs as CommLogRow[])
    : [];
  const legacy = Array.isArray(raw.legacy_communications)
    ? (raw.legacy_communications as LegacyCommRow[])
    : [];

  const tableRows = Array.isArray(raw.table_assignments)
    ? (raw.table_assignments as TableAssignmentRow[])
    : [];

  const variantPriceRaw = raw.service_variant_price_pence;
  let service_variant_price_pence: number | null = null;
  if (typeof variantPriceRaw === 'number' && Number.isFinite(variantPriceRaw)) {
    service_variant_price_pence = variantPriceRaw;
  } else if (variantPriceRaw != null) {
    const parsed = Number(variantPriceRaw);
    if (Number.isFinite(parsed)) service_variant_price_pence = parsed;
  }

  return {
    area_name: typeof raw.area_name === 'string' ? raw.area_name : null,
    service_variant_name:
      typeof raw.service_variant_name === 'string' ? raw.service_variant_name : null,
    service_variant_price_pence,
    guest:
      raw.guest && typeof raw.guest === 'object' && !Array.isArray(raw.guest)
        ? (raw.guest as StaffBookingDetailBundle['guest'])
        : null,
    events: Array.isArray(raw.events)
      ? (raw.events as StaffBookingDetailBundle['events'])
      : [],
    communications: mergeCommunications(logs, legacy),
    table_assignments: mapTableAssignments(tableRows),
    addons: Array.isArray(raw.addons) ? (raw.addons as Array<Record<string, unknown>>) : [],
  };
}
