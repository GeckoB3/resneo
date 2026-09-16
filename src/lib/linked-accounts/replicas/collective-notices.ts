/**
 * Telling venues what the host just did (UX spec §4, notices N8, N11, N14 and N32; W5).
 *
 * The rule these follow: a venue hears about a change to its own account from the venue that made
 * it, in the words that say what it means for them, and never with another venue's client details
 * in it. Grouping matches the action, so one save that ticks three calendars is one notice, not
 * three.
 *
 * Every one of these is a no-op today, because no collective is on the replicas model.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyVenue } from '@/lib/linked-accounts/notifications';
import { collectiveCopy } from '@/lib/linked-accounts/collective-copy';

const dashboardUrl = (path: string): string => {
  const base = (process.env.NEXT_PUBLIC_BASE_URL || 'https://www.resneo.com').replace(/\/$/, '');
  return `${base}${path}`;
};

/**
 * A bell without an email: the venue sees it next time it looks, and nothing lands in its inbox.
 * Used where an email would be noise (one line in the day's digest, or a page that books all day).
 */
export async function recordBell(
  admin: SupabaseClient,
  venueId: string,
  title: string,
  body: string,
  meta: { type: string; collectiveId: string; actorVenueId?: string | null },
): Promise<void> {
  try {
    await admin.from('account_link_notifications').insert({
      venue_id: venueId,
      type: meta.type,
      category: 'collective',
      collective_id: meta.collectiveId,
      actor_venue_id: meta.actorVenueId ?? null,
      payload: { title, body },
    });
  } catch (err) {
    console.error('[collective] could not record a notice:', err);
  }
}

/** "Chair 2", "Chair 2 and Room 1", "Chair 2, Room 1 and Studio". */
export function joinNames(names: string[]): string {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (clean.length === 0) return '';
  if (clean.length === 1) return clean[0]!;
  return `${clean.slice(0, -1).join(', ')} and ${clean[clean.length - 1]}`;
}

/**
 * The names a notice needs: what the service is called on the collective page (the host's own name
 * for it, which every venue's copy carries), and the calendars it names.
 */
export async function noticeNames(
  admin: SupabaseClient,
  params: { itemId: string; calendarIds: string[] },
): Promise<{ serviceName: string; calendarName: (id: string) => string }> {
  const [{ data: item }, { data: calendars }] = await Promise.all([
    admin
      .from('collective_service_items')
      .select('master_service_id, service_items:master_service_id (name)')
      .eq('id', params.itemId)
      .maybeSingle(),
    params.calendarIds.length > 0
      ? admin.from('unified_calendars').select('id, name').in('id', params.calendarIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const joined = (item?.service_items ?? null) as { name?: string } | { name?: string }[] | null;
  const serviceName = (Array.isArray(joined) ? joined[0]?.name : joined?.name) ?? 'A service';
  const names = new Map((calendars ?? []).map((c) => [c.id as string, (c.name as string) ?? 'A calendar']));
  return { serviceName, calendarName: (id) => names.get(id) ?? 'A calendar' };
}

/** N8: the host put a service on the page, so every member now has a copy to give calendars to. */
export async function notifyServiceOffered(
  admin: SupabaseClient,
  params: {
    memberVenueIds: string[];
    collectiveId: string;
    collectiveName: string;
    hostVenueId: string;
    hostVenueName: string;
    serviceName: string;
  },
): Promise<void> {
  const subject = collectiveCopy('notify.offered.subject', {
    host: params.hostVenueName,
    service: params.serviceName,
    collective: params.collectiveName,
  });
  const body = collectiveCopy('notify.offered.body', { service: params.serviceName });
  await Promise.all(
    params.memberVenueIds
      .filter((venueId) => venueId !== params.hostVenueId)
      // Bell now; the day's other changes reach them in the digest email (N7), so no email here.
      .map((venueId) =>
        recordBell(admin, venueId, subject, body, {
          type: 'collective_service_offered',
          collectiveId: params.collectiveId,
          actorVenueId: params.hostVenueId,
        }),
      ),
  );
}

/** N11: the host ticked or unticked one of a member's calendars, grouped into one notice per save. */
export async function notifyHostCalendarChange(
  admin: SupabaseClient,
  params: {
    memberVenueId: string;
    collectiveId: string;
    collectiveName: string;
    hostVenueName: string;
    serviceName: string;
    calendarNames: string[];
    action: 'assign' | 'unassign';
    /** Bookings the removal leaves behind, which stay exactly as they are. */
    keptBookings?: number;
  },
): Promise<void> {
  if (params.calendarNames.length === 0) return;
  const calendar = joinNames(params.calendarNames);
  const added = params.action === 'assign';
  const subject = collectiveCopy(added ? 'notify.hostCalendar.added.subject' : 'notify.hostCalendar.removed.subject', {
    host: params.hostVenueName,
    calendar,
    service: params.serviceName,
  });
  const body = added
    ? collectiveCopy('notify.hostCalendar.added.body', {
        service: params.serviceName,
        calendar,
        collective: params.collectiveName,
      })
    : collectiveCopy('notify.hostCalendar.removed.body', {
        calendar,
        service: params.serviceName,
        count: params.keptBookings ?? 0,
      });
  await notifyVenue(
    admin,
    params.memberVenueId,
    subject,
    {
      heading: subject,
      paragraphs: [body],
      ctaLabel: 'Calendar availability',
      ctaUrl: dashboardUrl('/dashboard/availability'),
    },
    { type: 'collective_calendar', category: 'collective', collectiveId: params.collectiveId },
  ).catch(() => undefined);
}

/** The seven stored values in the words a venue uses for them, for a notice. */
export const CALENDAR_VALUE_WORDS: Record<string, string> = {
  custom_price_pence: 'price',
  custom_duration_minutes: 'length',
  custom_buffer_minutes: 'buffer',
  custom_deposit_pence: 'deposit',
  custom_colour: 'colour',
  custom_name: 'name',
  custom_description: 'description',
};

/** What a calendar now uses, in the venue's own terms: "£70.00", "45 min", "the standard value". */
export function describeCalendarValue(
  field: string,
  value: unknown,
  currencySymbol: string,
): string {
  if (value === null || value === undefined) return 'the standard value';
  if (field === 'custom_price_pence' || field === 'custom_deposit_pence') {
    return `${currencySymbol}${(Number(value) / 100).toFixed(2)}`;
  }
  if (field === 'custom_duration_minutes' || field === 'custom_buffer_minutes') {
    return `${Number(value)} min`;
  }
  return String(value);
}

/** N14: the host changed what one of a member's calendars charges or times for a shared service. */
export async function notifyCalendarValuesChanged(
  admin: SupabaseClient,
  params: {
    memberVenueId: string;
    collectiveId: string;
    hostVenueName: string;
    calendarName: string;
    serviceName: string;
    /** Plain words: "price", "length", "buffer", "deposit", "colour". */
    fields: string[];
    /** What the calendar now uses, already formatted ("£70.00", "45 min"). */
    value: string;
  },
): Promise<void> {
  if (params.fields.length === 0) return;
  const subject = collectiveCopy('notify.values.subject', {
    host: params.hostVenueName,
    calendar: params.calendarName,
    field: joinNames(params.fields),
    service: params.serviceName,
  });
  const body = collectiveCopy('notify.values.body', {
    calendar: params.calendarName,
    value: params.value,
    service: params.serviceName,
  });
  await notifyVenue(
    admin,
    params.memberVenueId,
    subject,
    { heading: subject, paragraphs: [body] },
    { type: 'collective_values', category: 'collective', collectiveId: params.collectiveId },
  ).catch(() => undefined);
}

/**
 * N32 from a booking route: work out whether this booking needs the notice at all, and look up the
 * names it reads with. A booking at the host's own venue is the host's own diary, so nothing is
 * sent; so is a booking that did not come through a collective page.
 */
export async function notifyPageBooking(
  admin: SupabaseClient,
  params: {
    collectiveId: string;
    owningVenueId: string;
    serviceName: string | null;
    calendarId: string | null;
    /** The booking's own date, formatted for reading ("12 June"). */
    date: string;
  },
): Promise<void> {
  const { data: collective } = await admin
    .from('venue_collectives')
    .select('id, name, host_venue_id, status, service_model')
    .eq('id', params.collectiveId)
    .maybeSingle();
  if (!collective || collective.status !== 'active' || collective.service_model !== 'replicas') return;
  const hostVenueId = collective.host_venue_id as string;
  if (hostVenueId === params.owningVenueId) return;

  const [{ data: venue }, { data: calendar }] = await Promise.all([
    admin.from('venues').select('name').eq('id', params.owningVenueId).maybeSingle(),
    params.calendarId
      ? admin.from('unified_calendars').select('name').eq('id', params.calendarId).maybeSingle()
      : Promise.resolve({ data: null as { name?: string } | null }),
  ]);

  await notifyCollectivePageBooking(admin, {
    hostVenueId,
    collectiveId: params.collectiveId,
    memberVenueId: params.owningVenueId,
    memberVenueName: (venue?.name as string) ?? 'A venue',
    collectiveName: (collective.name as string) ?? 'the collective',
    serviceName: params.serviceName ?? 'a service',
    calendarName: (calendar?.name as string) ?? 'a calendar',
    date: params.date,
  });
}

/**
 * N32: a guest booked a member's calendar on the collective page. The host runs the page, so it is
 * told a booking happened; the member holds the booking and the client's details, and this notice
 * carries none of them (D34).
 */
export async function notifyCollectivePageBooking(
  admin: SupabaseClient,
  params: {
    hostVenueId: string;
    collectiveId: string;
    memberVenueName: string;
    memberVenueId: string;
    collectiveName: string;
    serviceName: string;
    calendarName: string;
    /** The day, as the guest sees it. No time, no client, no contact details. */
    date: string;
  },
): Promise<void> {
  const subject = collectiveCopy('notify.pageBooking.subject', {
    venue: params.memberVenueName,
    collective: params.collectiveName,
  });
  const body = collectiveCopy('notify.pageBooking.body', {
    service: params.serviceName,
    calendar: params.calendarName,
    venue: params.memberVenueName,
    date: params.date,
  });
  // Bell only: a busy page would otherwise email the host all day.
  await recordBell(admin, params.hostVenueId, subject, body, {
    type: 'collective_page_booking',
    collectiveId: params.collectiveId,
    actorVenueId: params.memberVenueId,
  });
}
