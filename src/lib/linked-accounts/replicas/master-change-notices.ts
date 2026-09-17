/**
 * Telling members what the host changed (UX spec §4 N6 and N7; plan D23; W5).
 *
 * Every host save that changed what the collective copies is a `master_changed` row, with the
 * before and after. Two notices read those rows, split by what changed:
 *
 *   N6  commercial: price, deposit or fee, online payment, length, buffer, cancellation notice and
 *       options. These change what a guest pays or gets, so every member is emailed and rung, and
 *       it is not a preference. A host's burst of saves is one notice: rows are sent once the
 *       newest is 15 minutes old. An undo inside that window is announced as "put back".
 *   N7  everything else the collective copies (name, description, colour, heading, option names,
 *       booking window, start times, schedule, location). A daily digest at 18:00 the member's time,
 *       skipped when empty; the bell always rings, the email follows `collective_digest`.
 *
 * Add-on and form changes are not `master_changed` rows, so neither notice covers them yet.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyVenue } from '@/lib/linked-accounts/notifications';
import { collectiveCopy, COLLECTIVE_DIFF_LABELS } from '@/lib/linked-accounts/collective-copy';
import { recordBell } from '@/lib/linked-accounts/replicas/collective-notices';
import { resolveLinkedNotificationPrefs } from '@/lib/linked-accounts/notification-prefs';
import { currencySymbolFromCode } from '@/lib/money/currency-symbol';

/** A commercial burst is announced once its newest save is this old. */
export const COMMERCIAL_QUIET_MS = 15 * 60 * 1000;
/** The digest goes at this hour, the member's own time. */
export const DIGEST_HOUR = 18;

type Service = Record<string, unknown>;
interface Projection {
  service?: Service;
  heading?: { name?: string } | null;
  variants?: Array<Record<string, unknown>>;
}

export interface ChangeLine {
  label: string;
  from: string;
  to: string;
}

const COMMERCIAL_FIELDS: Record<string, keyof typeof COLLECTIVE_DIFF_LABELS> = {
  price_pence: 'price',
  deposit_pence: 'deposit',
  payment_requirement: 'payment',
  duration_minutes: 'length',
  buffer_minutes: 'buffer',
  cancellation_notice_hours: 'cancellation',
};

const OTHER_FIELDS: Record<string, string> = {
  name: 'Name',
  description: 'Description',
  colour: 'Colour',
  max_advance_booking_days: 'How far ahead guests can book',
  min_booking_notice_hours: 'Notice needed',
  allow_same_day_booking: 'Same-day booking',
  booking_interval_minutes: 'Start times',
  booking_minute_marks: 'Start times',
  booking_start_times: 'Start times',
  custom_availability_enabled: 'When it can be booked',
  custom_working_hours: 'When it can be booked',
  location_type: 'Where it happens',
  is_bookable_online: 'Staff bookings only',
};

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function money(value: unknown, symbol: string): string {
  if (value === null || value === undefined) return collectiveCopy('diff.none');
  return `${symbol}${(Number(value) / 100).toFixed(2)}`;
}

function commercialValue(field: string, value: unknown, symbol: string): string {
  if (field === 'price_pence' || field === 'deposit_pence') return money(value, symbol);
  if (field === 'duration_minutes' || field === 'buffer_minutes') {
    return value === null || value === undefined ? collectiveCopy('diff.none') : `${Number(value)} min`;
  }
  if (field === 'cancellation_notice_hours') {
    return value === null || value === undefined ? collectiveCopy('diff.none') : `${Number(value)} hours`;
  }
  if (field === 'payment_requirement') {
    const words: Record<string, string> = {
      none: 'Nothing online',
      deposit: 'A deposit',
      full_payment: 'Paid in full',
      card_hold: 'A card held',
    };
    return words[String(value)] ?? collectiveCopy('diff.none');
  }
  return value === null || value === undefined ? collectiveCopy('diff.none') : String(value);
}

/** What an option list looks like for a line: "Short (£40.00), Long (£60.00)". */
function optionsWords(variants: Array<Record<string, unknown>> | undefined, symbol: string): string {
  const active = (variants ?? []).filter((v) => v.is_active !== false);
  if (active.length === 0) return collectiveCopy('diff.none');
  return active
    .map((v) => (v.price_pence != null ? `${String(v.name)} (${money(v.price_pence, symbol)})` : String(v.name)))
    .join(', ');
}

/**
 * Split one save into the lines each notice reads. Commercial lines carry from and to; the other
 * lines only need to say what moved.
 */
export function classifyMasterChange(
  changes: { before?: Projection; after?: Projection } | null,
  currencySymbol: string,
): { commercial: ChangeLine[]; other: string[] } {
  const before = changes?.before ?? {};
  const after = changes?.after ?? {};
  const b = before.service ?? {};
  const a = after.service ?? {};
  const commercial: ChangeLine[] = [];
  const other = new Set<string>();

  for (const [field, labelKey] of Object.entries(COMMERCIAL_FIELDS)) {
    if (same(b[field], a[field])) continue;
    commercial.push({
      label: COLLECTIVE_DIFF_LABELS[labelKey],
      from: commercialValue(field, b[field], currencySymbol),
      to: commercialValue(field, a[field], currencySymbol),
    });
  }

  // Options: a price or length change is commercial; a rename alone is not.
  const commercialOption = (v: Record<string, unknown>) =>
    JSON.stringify([v.key, v.is_active, v.price_pence, v.deposit_pence, v.duration_minutes, v.buffer_minutes]);
  const namesOnly = (v: Record<string, unknown>) => JSON.stringify([v.key, v.name]);
  const beforeVariants = before.variants ?? [];
  const afterVariants = after.variants ?? [];
  if (!same(beforeVariants.map(commercialOption), afterVariants.map(commercialOption))) {
    commercial.push({
      label: COLLECTIVE_DIFF_LABELS.options,
      from: optionsWords(beforeVariants, currencySymbol),
      to: optionsWords(afterVariants, currencySymbol),
    });
  } else if (!same(beforeVariants.map(namesOnly), afterVariants.map(namesOnly))) {
    other.add('Option names');
  }

  for (const [field, label] of Object.entries(OTHER_FIELDS)) {
    if (!same(b[field], a[field])) other.add(label);
  }
  if (!same(before.heading?.name, after.heading?.name)) other.add('Heading');

  return { commercial, other: [...other] };
}

interface MasterChangeRow {
  id: string;
  collective_id: string;
  event_type: string;
  service_id: string | null;
  changes: { before?: Projection; after?: Projection } | null;
  created_at: string;
}

interface CollectiveFacts {
  id: string;
  name: string;
  hostVenueId: string;
  hostName: string;
  currency: string | null;
  members: { venueId: string; timezone: string; prefs: unknown }[];
}

export interface MasterNoticeOutcome {
  commercial: number;
  digests: number;
}

/**
 * One pass for both notices, run by the 5-minute cron. Cheap when there is nothing to say: one
 * read of the live replicas-model collectives, and nothing more unless one has a member.
 */
export async function sendMasterChangeNotices(
  admin: SupabaseClient,
  opts: { now?: () => number } = {},
): Promise<MasterNoticeOutcome> {
  const now = (opts.now ?? Date.now)();
  const collectives = await loadCollectives(admin);
  let commercial = 0;
  let digests = 0;
  for (const collective of collectives) {
    for (const member of collective.members) {
      commercial += await sendCommercial(admin, collective, member, now);
      digests += await sendDigest(admin, collective, member, now);
    }
  }
  return { commercial, digests };
}

async function loadCollectives(admin: SupabaseClient): Promise<CollectiveFacts[]> {
  const { data: rows } = await admin
    .from('venue_collectives')
    .select('id, name, host_venue_id')
    .eq('status', 'active')
    .eq('service_model', 'replicas');
  if (!rows || rows.length === 0) return [];

  const ids = rows.map((r) => r.id as string);
  const { data: memberRows } = await admin
    .from('venue_collective_members')
    .select('collective_id, venue_id')
    .in('collective_id', ids)
    .eq('status', 'active');
  const venueIds = [
    ...new Set([...(memberRows ?? []).map((m) => m.venue_id as string), ...rows.map((r) => r.host_venue_id as string)]),
  ];
  const { data: venues } = await admin
    .from('venues')
    .select('id, name, timezone, currency, linked_notification_prefs')
    .in('id', venueIds.length > 0 ? venueIds : ['00000000-0000-0000-0000-000000000000']);
  const byId = new Map((venues ?? []).map((v) => [v.id as string, v]));

  return rows.map((row) => {
    const host = byId.get(row.host_venue_id as string);
    return {
      id: row.id as string,
      name: (row.name as string) ?? 'your collective',
      hostVenueId: row.host_venue_id as string,
      hostName: (host?.name as string) ?? 'The host',
      currency: (host?.currency as string | null) ?? null,
      members: (memberRows ?? [])
        .filter((m) => m.collective_id === row.id && m.venue_id !== row.host_venue_id)
        .map((m) => {
          const venue = byId.get(m.venue_id as string);
          return {
            venueId: m.venue_id as string,
            timezone: (venue?.timezone as string | null) ?? 'Europe/London',
            prefs: venue?.linked_notification_prefs ?? null,
          };
        }),
    };
  });
}

async function readMark(admin: SupabaseClient, collectiveId: string, venueId: string, kind: 'commercial' | 'digest') {
  const { data } = await admin
    .from('collective_notice_marks')
    .select('sent_through')
    .eq('collective_id', collectiveId)
    .eq('venue_id', venueId)
    .eq('kind', kind)
    .maybeSingle();
  return (data?.sent_through as string | undefined) ?? null;
}

async function writeMark(
  admin: SupabaseClient,
  collectiveId: string,
  venueId: string,
  kind: 'commercial' | 'digest',
  through: string,
) {
  const { error } = await admin
    .from('collective_notice_marks')
    .upsert(
      { collective_id: collectiveId, venue_id: venueId, kind, sent_through: through, updated_at: new Date().toISOString() },
      { onConflict: 'collective_id,venue_id,kind' },
    );
  if (error) console.error('[collective] could not record how far a venue was told:', error.message);
  return !error;
}

async function readChanges(admin: SupabaseClient, collectiveId: string, after: string | null, until: string) {
  let query = admin
    .from('collective_audit_events')
    .select('id, collective_id, event_type, service_id, changes, created_at')
    .eq('collective_id', collectiveId)
    .in('event_type', ['master_changed', 'master_change_undone'])
    .lte('created_at', until)
    .order('created_at', { ascending: true })
    .limit(500);
  if (after) query = query.gt('created_at', after);
  const { data } = await query;
  return (data ?? []) as MasterChangeRow[];
}

async function serviceNames(admin: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await admin.from('service_items').select('id, name').in('id', ids);
  return new Map((data ?? []).map((s) => [s.id as string, (s.name as string) ?? 'A service']));
}

/**
 * N6 for one member. A venue that has never been told starts from now, so joining a collective
 * never replays its whole history as a flood of emails.
 */
async function sendCommercial(
  admin: SupabaseClient,
  collective: CollectiveFacts,
  member: CollectiveFacts['members'][number],
  now: number,
): Promise<number> {
  const mark = await readMark(admin, collective.id, member.venueId, 'commercial');
  if (!mark) {
    await writeMark(admin, collective.id, member.venueId, 'commercial', new Date(now).toISOString());
    return 0;
  }
  const rows = await readChanges(admin, collective.id, mark, new Date(now).toISOString());
  if (rows.length === 0) return 0;
  // Still in a burst: wait until the newest save has been quiet for the window.
  const newest = Date.parse(rows[rows.length - 1]!.created_at);
  if (now - newest < COMMERCIAL_QUIET_MS) return 0;

  const symbol = currencySymbolFromCode(collective.currency);
  const names = await serviceNames(admin, [...new Set(rows.map((r) => r.service_id).filter(Boolean) as string[])]);
  // In the order it happened, per service, so a change and its undo read as what they were.
  const blocks = new Map<string, { name: string; lines: string[] }>();
  for (const row of rows) {
    const serviceId = row.service_id ?? 'unknown';
    const block = blocks.get(serviceId) ?? { name: names.get(serviceId) ?? 'A service', lines: [] };
    if (row.event_type === 'master_change_undone') {
      // An undo is only news if the members were about to hear about what it undid. The undo window
      // (60 seconds) is far shorter than the quiet window, so the change is always in this burst.
      if (block.lines.length > 0) {
        block.lines.push(collectiveCopy('notify.commercial.putBack', { host: collective.hostName, service: block.name }));
      }
    } else {
      for (const line of classifyMasterChange(row.changes, symbol).commercial) {
        block.lines.push(`${block.name}: ${collectiveCopy('diff.row', { label: line.label, from: line.from, to: line.to })}`);
      }
    }
    blocks.set(serviceId, block);
  }
  const announced = [...blocks.values()].filter((b) => b.lines.length > 0);
  const through = rows[rows.length - 1]!.created_at;
  if (announced.length === 0) {
    // Only non-commercial saves in the window: nothing to email, but they are behind us now.
    await writeMark(admin, collective.id, member.venueId, 'commercial', through);
    return 0;
  }

  const subject =
    announced.length === 1
      ? collectiveCopy('notify.commercial.subject', { host: collective.hostName, service: announced[0]!.name })
      : collectiveCopy('notify.commercial.subjectMany', { host: collective.hostName, count: announced.length });
  const paragraphs = [collectiveCopy('notify.commercial.body')];
  const bullets = announced.flatMap((block) => block.lines);

  await notifyVenue(
    admin,
    member.venueId,
    subject,
    { heading: subject, paragraphs, bullets },
    { type: 'collective_commercial_change', category: 'collective', collectiveId: collective.id, actorVenueId: collective.hostVenueId },
  ).catch(() => undefined);
  await writeMark(admin, collective.id, member.venueId, 'commercial', through);
  return 1;
}

/** The member's local date and hour, for the 18:00 digest. */
export function localClock(now: number, timezone: string): { date: string; hour: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(now));
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
    return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
  } catch {
    return localClock(now, 'Europe/London');
  }
}

/** N7 for one member: once a day, at or after 18:00 its time, when there is something to say. */
async function sendDigest(
  admin: SupabaseClient,
  collective: CollectiveFacts,
  member: CollectiveFacts['members'][number],
  now: number,
): Promise<number> {
  const clock = localClock(now, member.timezone);
  if (clock.hour < DIGEST_HOUR) return 0;
  const mark = await readMark(admin, collective.id, member.venueId, 'digest');
  if (!mark) {
    await writeMark(admin, collective.id, member.venueId, 'digest', new Date(now).toISOString());
    return 0;
  }
  // Already sent today, their time.
  const lastSent = localClock(Date.parse(mark), member.timezone);
  if (lastSent.date === clock.date && lastSent.hour >= DIGEST_HOUR) return 0;

  const through = new Date(now).toISOString();
  const rows = (await readChanges(admin, collective.id, mark, through)).filter((r) => r.event_type === 'master_changed');
  const symbol = currencySymbolFromCode(collective.currency);
  const names = await serviceNames(admin, [...new Set(rows.map((r) => r.service_id).filter(Boolean) as string[])]);
  const byService = new Map<string, Set<string>>();
  for (const row of rows) {
    const other = classifyMasterChange(row.changes, symbol).other;
    if (other.length === 0) continue;
    const name = names.get(row.service_id ?? '') ?? 'A service';
    byService.set(name, new Set([...(byService.get(name) ?? []), ...other]));
  }

  if (byService.size > 0) {
    const subject = collectiveCopy('notify.digest.subject', { host: collective.hostName });
    const body = collectiveCopy('notify.digest.body', { host: collective.hostName, collective: collective.name });
    const bullets = [...byService.entries()].map(([name, fields]) => `${name}: ${[...fields].join(', ')}`);
    const prefs = resolveLinkedNotificationPrefs(member.prefs);
    if (prefs.collective_digest) {
      await notifyVenue(
        admin,
        member.venueId,
        subject,
        { heading: subject, paragraphs: [body], bullets },
        { type: 'collective_digest', category: 'collective', collectiveId: collective.id, actorVenueId: collective.hostVenueId },
      ).catch(() => undefined);
    } else {
      // The email is the member's choice; the day's bell is not.
      await recordBell(admin, member.venueId, subject, `${body} ${bullets.join('; ')}`, {
        type: 'collective_digest',
        collectiveId: collective.id,
        actorVenueId: collective.hostVenueId,
      });
    }
  }
  await writeMark(admin, collective.id, member.venueId, 'digest', through);
  return byService.size > 0 ? 1 : 0;
}
