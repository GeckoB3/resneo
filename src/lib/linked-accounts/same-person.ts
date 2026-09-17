/**
 * One person with a calendar at two venues of a collective (plan §6.17, D47; SB-38; test DIARY-02).
 *
 * People are not modelled above the venue, so nothing stops the same practitioner being booked at
 * two venues for the same moment. D47 chose to warn rather than model: when a calendar at another
 * venue of the live collective has the same name and the same staff email as the calendar just
 * booked, and already has a booking at that time, whoever booked second is told. Nothing is written
 * and no guest is named; a calendar with no linked staff email is never compared, because a shared
 * name alone ("Chair 1") says nothing about a person.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { eligibleMemberVenueIds, findStaffCollectiveForVenue } from '@/lib/linked-accounts/collective-staff-scope';
import { collectiveCopy } from '@/lib/linked-accounts/collective-copy';

type Row = Record<string, unknown>;

const INACTIVE_STATUSES = ['Cancelled', 'No-Show'];

/** Names compared the way people read them: case, spacing and punctuation ignored. */
export function normalisePersonName(name: string | null | undefined): string {
  return (name ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const normaliseEmail = (email: string | null | undefined) => (email ?? '').trim().toLowerCase();

const toMinutes = (time: string) => {
  const [h, m] = time.split(':').map((part) => Number(part));
  return (h ?? 0) * 60 + (m ?? 0);
};

export interface SamePersonClash {
  code: 'COLLECTIVE_SAME_PERSON';
  message: string;
}

export async function findSamePersonClash(
  admin: SupabaseClient,
  booking: {
    venueId: string;
    calendarId: string;
    date: string;
    startTime: string;
    endTime: string | null;
    /** The booking just made, which is never a clash with itself. */
    bookingId?: string;
  },
): Promise<SamePersonClash | null> {
  const collective = await findStaffCollectiveForVenue(admin, booking.venueId);
  if (!collective) return null;
  const others = (await eligibleMemberVenueIds(admin, collective.collectiveId)).filter((v) => v !== booking.venueId);
  if (others.length === 0) return null;

  const { data: calendar } = await admin
    .from('unified_calendars')
    .select('id, name, staff_id, venue_id')
    .eq('id', booking.calendarId)
    .maybeSingle();
  if (!calendar?.staff_id || calendar.venue_id !== booking.venueId) return null;
  const name = normalisePersonName(calendar.name as string);
  if (!name) return null;

  const { data: candidates } = await admin
    .from('unified_calendars')
    .select('id, name, staff_id, venue_id')
    .in('venue_id', others)
    .eq('is_active', true)
    .not('staff_id', 'is', null);
  const sameName = ((candidates ?? []) as Row[]).filter((c) => normalisePersonName(c.name as string) === name);
  if (sameName.length === 0) return null;

  const staffIds = [calendar.staff_id as string, ...sameName.map((c) => c.staff_id as string)];
  const { data: staffRows } = await admin.from('staff').select('id, email').in('id', staffIds);
  const emailOf = new Map(((staffRows ?? []) as Row[]).map((s) => [s.id as string, normaliseEmail(s.email as string)]));
  const email = emailOf.get(calendar.staff_id as string);
  if (!email) return null;
  const samePerson = sameName.filter((c) => emailOf.get(c.staff_id as string) === email);
  if (samePerson.length === 0) return null;

  const { data: bookings } = await admin
    .from('bookings')
    .select('id, calendar_id, booking_time, booking_end_time, status')
    .in('calendar_id', samePerson.map((c) => c.id as string))
    .eq('booking_date', booking.date)
    .not('status', 'in', `(${INACTIVE_STATUSES.map((s) => `"${s}"`).join(',')})`);
  const start = toMinutes(booking.startTime);
  const end = booking.endTime ? toMinutes(booking.endTime) : start + 1;
  const overlapping = ((bookings ?? []) as Row[]).find((b) => {
    if (b.id === booking.bookingId) return false;
    const bStart = toMinutes(b.booking_time as string);
    const bEnd = b.booking_end_time ? toMinutes(b.booking_end_time as string) : bStart + 1;
    return bStart < end && start < bEnd;
  });
  if (!overlapping) return null;

  const other = samePerson.find((c) => c.id === overlapping.calendar_id)!;
  const { data: venues } = await admin
    .from('venues')
    .select('id, name')
    .in('id', [booking.venueId, other.venue_id as string]);
  const venueName = (id: string) => (((venues ?? []) as Row[]).find((v) => v.id === id)?.name as string | undefined) ?? 'another venue';
  return {
    code: 'COLLECTIVE_SAME_PERSON',
    message: collectiveCopy('clash.samePerson', {
      calendar: calendar.name as string,
      venue: venueName(booking.venueId),
      otherCalendar: other.name as string,
      otherVenue: venueName(other.venue_id as string),
    }),
  };
}
