import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/emails/send-email';
import { formatGuestDisplayName } from '@/lib/guests/name';

interface BookingLogVenue {
  id: string;
  name: string;
  timezone: string | null;
}

interface BookingLogBookingRow {
  id: string;
  guest_id: string;
  booking_date: string;
  booking_time: string;
  party_size: number | null;
  source: string | null;
  created_at: string;
  created_by_staff_id: string | null;
  cancelled_by_staff_id: string | null;
  cancellation_actor_type: string | null;
}

interface GuestRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
}

interface StaffRow {
  id: string;
  name: string | null;
  email: string | null;
}

interface CancellationEventRow {
  id: string;
  booking_id: string | null;
  event_type: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

interface BookingLogItem {
  booking: BookingLogBookingRow;
  guest: GuestRow | null;
  actor: string;
  eventAt: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDateTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(new Date(value));
}

function formatBookingWhen(row: BookingLogBookingRow, timezone: string): string {
  const time = typeof row.booking_time === 'string' ? row.booking_time.slice(0, 5) : '';
  const date = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: timezone,
  }).format(new Date(`${row.booking_date}T12:00:00Z`));
  return `${date} at ${time}`;
}

function sourceLabel(source: string | null): string {
  const map: Record<string, string> = {
    online: 'Customer online',
    booking_page: 'Customer booking page',
    widget: 'Customer website widget',
    phone: 'Phone booking',
    'walk-in': 'Walk-in',
    import: 'Data import',
  };
  return map[source ?? ''] ?? (source || 'Unknown source');
}

function actorLabel(actorType: string | null, staff: StaffRow | null, fallback: string): string {
  if (staff) return staff.name?.trim() || staff.email || 'Named staff user';
  if (actorType === 'system') return 'Resneo automation';
  if (actorType === 'staff') return 'Staff user';
  if (actorType === 'import') return 'Data import';
  if (actorType === 'customer') return 'Customer';
  return fallback;
}

function bookingCard(item: BookingLogItem, timezone: string, accent: string): string {
  const guestName = formatGuestDisplayName(item.guest?.first_name, item.guest?.last_name);
  const contact = [item.guest?.email, item.guest?.phone].filter(Boolean).join(' · ');
  return `
    <tr>
      <td style="padding:14px 0;border-bottom:1px solid #e5edf1;">
        <div style="border-left:4px solid ${accent};padding:12px 14px;background:#f8fafc;border-radius:12px;">
          <div style="font-size:15px;font-weight:700;color:#0f172a;">${escapeHtml(guestName)}</div>
          <div style="margin-top:4px;font-size:13px;color:#475569;">${escapeHtml(formatBookingWhen(item.booking, timezone))} · ${item.booking.party_size ?? 1} place${item.booking.party_size === 1 ? '' : 's'}</div>
          ${contact ? `<div style="margin-top:4px;font-size:12px;color:#64748b;">${escapeHtml(contact)}</div>` : ''}
          <div style="margin-top:8px;font-size:12px;color:#334155;">By <strong>${escapeHtml(item.actor)}</strong> · ${escapeHtml(sourceLabel(item.booking.source))}</div>
          <div style="margin-top:2px;font-size:11px;color:#94a3b8;">Logged ${escapeHtml(formatDateTime(item.eventAt, timezone))}</div>
        </div>
      </td>
    </tr>
  `;
}

async function hydrateLookups(
  supabase: SupabaseClient,
  bookings: BookingLogBookingRow[],
): Promise<{ guests: Map<string, GuestRow>; staff: Map<string, StaffRow> }> {
  const guestIds = [...new Set(bookings.map((row) => row.guest_id).filter(Boolean))];
  const staffIds = [
    ...new Set(
      bookings
        .flatMap((row) => [row.created_by_staff_id, row.cancelled_by_staff_id])
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const [guestRes, staffRes] = await Promise.all([
    guestIds.length
      ? supabase.from('guests').select('id, first_name, last_name, email, phone').in('id', guestIds)
      : Promise.resolve({ data: [] as GuestRow[], error: null }),
    staffIds.length
      ? supabase.from('staff').select('id, name, email').in('id', staffIds)
      : Promise.resolve({ data: [] as StaffRow[], error: null }),
  ]);

  if (guestRes.error) console.error('[booking-log-email] guest lookup failed:', guestRes.error);
  if (staffRes.error) console.error('[booking-log-email] staff lookup failed:', staffRes.error);

  return {
    guests: new Map(((guestRes.data ?? []) as GuestRow[]).map((row) => [row.id, row])),
    staff: new Map(((staffRes.data ?? []) as StaffRow[]).map((row) => [row.id, row])),
  };
}

export async function sendBookingLogEmail(params: {
  supabase: SupabaseClient;
  venue: BookingLogVenue;
  recipientEmail: string;
  periodStartIso: string;
  periodEndIso: string;
}): Promise<string | null> {
  const { supabase, venue, recipientEmail, periodStartIso, periodEndIso } = params;
  const timezone = venue.timezone || 'Europe/London';

  const { data: createdRows, error: createdError } = await supabase
    .from('bookings')
    .select(
      'id, guest_id, booking_date, booking_time, party_size, source, created_at, created_by_staff_id, cancelled_by_staff_id, cancellation_actor_type',
    )
    .eq('venue_id', venue.id)
    .gte('created_at', periodStartIso)
    .lt('created_at', periodEndIso)
    .order('created_at', { ascending: true });

  if (createdError) throw createdError;

  const { data: eventRows, error: eventError } = await supabase
    .from('events')
    .select('id, booking_id, event_type, payload, created_at')
    .eq('venue_id', venue.id)
    .gte('created_at', periodStartIso)
    .lt('created_at', periodEndIso)
    .in('event_type', ['booking_status_changed', 'auto_cancelled'])
    .order('created_at', { ascending: true });

  if (eventError) throw eventError;

  const rawCancellationEvents = ((eventRows ?? []) as CancellationEventRow[]).filter((event) => {
    if (event.event_type === 'auto_cancelled') return true;
    return event.payload?.new_status === 'Cancelled';
  });
  const autoCancelledBookingIds = new Set(
    rawCancellationEvents
      .filter((event) => event.event_type === 'auto_cancelled')
      .map((event) => event.booking_id)
      .filter(Boolean),
  );
  const cancellationEvents = rawCancellationEvents.filter((event) => {
    if (event.event_type === 'auto_cancelled') return true;
    return !event.booking_id || !autoCancelledBookingIds.has(event.booking_id);
  });

  const cancelledIds = [...new Set(cancellationEvents.map((event) => event.booking_id).filter(Boolean))] as string[];
  const { data: cancelledRows, error: cancelledError } = cancelledIds.length
    ? await supabase
        .from('bookings')
        .select(
          'id, guest_id, booking_date, booking_time, party_size, source, created_at, created_by_staff_id, cancelled_by_staff_id, cancellation_actor_type',
        )
        .in('id', cancelledIds)
    : { data: [] as BookingLogBookingRow[], error: null };

  if (cancelledError) throw cancelledError;

  const created = (createdRows ?? []) as BookingLogBookingRow[];
  const cancelled = (cancelledRows ?? []) as BookingLogBookingRow[];
  const { guests, staff } = await hydrateLookups(supabase, [...created, ...cancelled]);
  const cancelledById = new Map(cancelled.map((row) => [row.id, row]));

  const createdItems: BookingLogItem[] = created.map((booking) => ({
    booking,
    guest: guests.get(booking.guest_id) ?? null,
    actor: actorLabel(
      booking.source === 'import' ? 'import' : null,
      booking.created_by_staff_id ? staff.get(booking.created_by_staff_id) ?? null : null,
      'Customer',
    ),
    eventAt: booking.created_at,
  }));

  const cancelledItems: BookingLogItem[] = cancellationEvents
    .map((event) => {
      const booking = event.booking_id ? cancelledById.get(event.booking_id) : null;
      if (!booking) return null;
      const isAuto = event.event_type === 'auto_cancelled';
      return {
        booking,
        guest: guests.get(booking.guest_id) ?? null,
        actor: actorLabel(
          isAuto ? 'system' : booking.cancellation_actor_type,
          booking.cancelled_by_staff_id ? staff.get(booking.cancelled_by_staff_id) ?? null : null,
          'Customer',
        ),
        eventAt: event.created_at,
      };
    })
    .filter((item): item is BookingLogItem => Boolean(item));

  const periodLabel = `${formatDateTime(periodStartIso, timezone)} - ${formatDateTime(periodEndIso, timezone)}`;
  const subject = `${venue.name} booking log: ${createdItems.length} new, ${cancelledItems.length} cancelled`;
  const html = `
    <div style="margin:0;padding:0;background:#f1f5f9;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a;">
      <div style="max-width:720px;margin:0 auto;padding:28px 16px;">
        <div style="overflow:hidden;border-radius:24px;background:#ffffff;box-shadow:0 20px 45px rgba(15,23,42,.08);">
          <div style="background:linear-gradient(135deg,#003B6F,#00C2C7);padding:28px;color:#ffffff;">
            <div style="font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;opacity:.85;">Resneo daily booking log</div>
            <h1 style="margin:10px 0 0;font-size:28px;line-height:1.2;">${escapeHtml(venue.name)}</h1>
            <p style="margin:8px 0 0;font-size:14px;opacity:.9;">${escapeHtml(periodLabel)}</p>
          </div>
          <div style="padding:24px 28px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
              <tr>
                <td style="width:50%;padding:0 8px 18px 0;">
                  <div style="border-radius:18px;background:#ecfdf5;padding:18px;text-align:center;">
                    <div style="font-size:30px;font-weight:800;color:#047857;">${createdItems.length}</div>
                    <div style="font-size:12px;font-weight:700;color:#065f46;text-transform:uppercase;letter-spacing:.08em;">New bookings</div>
                  </div>
                </td>
                <td style="width:50%;padding:0 0 18px 8px;">
                  <div style="border-radius:18px;background:#fff7ed;padding:18px;text-align:center;">
                    <div style="font-size:30px;font-weight:800;color:#c2410c;">${cancelledItems.length}</div>
                    <div style="font-size:12px;font-weight:700;color:#9a3412;text-transform:uppercase;letter-spacing:.08em;">Cancellations</div>
                  </div>
                </td>
              </tr>
            </table>

            <h2 style="margin:10px 0 4px;font-size:18px;">New bookings</h2>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
              ${
                createdItems.length
                  ? createdItems.map((item) => bookingCard(item, timezone, '#059669')).join('')
                  : '<tr><td style="padding:14px 0;color:#64748b;font-size:14px;">No new bookings in this period.</td></tr>'
              }
            </table>

            <h2 style="margin:26px 0 4px;font-size:18px;">Cancellations</h2>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
              ${
                cancelledItems.length
                  ? cancelledItems.map((item) => bookingCard(item, timezone, '#f97316')).join('')
                  : '<tr><td style="padding:14px 0;color:#64748b;font-size:14px;">No cancellations in this period.</td></tr>'
              }
            </table>
          </div>
        </div>
        <p style="margin:16px 8px 0;text-align:center;font-size:12px;color:#64748b;">Sent by Resneo. You can change this schedule in Dashboard → Reports.</p>
      </div>
    </div>
  `.trim();

  const text = [
    `${venue.name} booking log`,
    periodLabel,
    '',
    `New bookings: ${createdItems.length}`,
    ...createdItems.map((item) => {
      const guest = formatGuestDisplayName(item.guest?.first_name, item.guest?.last_name);
      return `- ${guest}, ${formatBookingWhen(item.booking, timezone)}, by ${item.actor}`;
    }),
    '',
    `Cancellations: ${cancelledItems.length}`,
    ...cancelledItems.map((item) => {
      const guest = formatGuestDisplayName(item.guest?.first_name, item.guest?.last_name);
      return `- ${guest}, ${formatBookingWhen(item.booking, timezone)}, by ${item.actor}`;
    }),
  ].join('\n');

  return sendEmail({
    to: recipientEmail,
    subject,
    html,
    text,
    fromDisplayName: 'Resneo',
    disableTracking: true,
  });
}
