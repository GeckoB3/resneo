/**
 * A host switching a calendar permission off clears the matching values at every venue, not only
 * its own (D6, D56, N15; W5).
 *
 * The Services route already clears the host's own calendars. A member's calendars hold the same
 * kind of values for its copy of the service, and without this they would sit there, inert while
 * the permission is off, and come back unnoticed the day the host ticks it again: exactly what D6
 * exists to stop. Each clear goes through the engine, so it is audited and bumped like any other
 * change to another venue's calendar, and each venue that lost a value is told once for the save.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyVenue } from '@/lib/linked-accounts/notifications';
import { currencySymbolFromCode } from '@/lib/money/currency-symbol';
import { collectiveCopy } from '@/lib/linked-accounts/collective-copy';
import {
  calendarValueFieldsTurnedOff,
  type ClearedCalendarValueLabel,
} from '@/lib/venue/calendar-values-flag-off';
import { describeCalendarValue, joinNames } from '@/lib/linked-accounts/replicas/collective-notices';
import type { MasterSaveContext } from '@/lib/linked-accounts/replicas/master-save';

export interface MemberValuesCleared {
  venue_id: string;
  venue_name: string;
  calendars: string[];
  fields: ClearedCalendarValueLabel[];
}

/**
 * Clear, at every member, the values the host's save switched off, and tell each member what went.
 * Returns what was cleared, per venue. Best effort per row: a failure is logged and the rest still
 * clears, because under D56 a value under a switched-off permission no longer applies anyway.
 */
export async function clearMemberCalendarValues(
  admin: SupabaseClient,
  params: {
    context: MasterSaveContext | null;
    serviceName: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    actorVenueId: string;
    actorUserId: string | null;
  },
): Promise<MemberValuesCleared[]> {
  const { context } = params;
  if (!context || context.linkIds.length === 0) return [];
  const turnedOff = calendarValueFieldsTurnedOff(params.before, params.after);
  if (turnedOff.length === 0) return [];

  const { data: links } = await admin
    .from('collective_service_replicas')
    .select('venue_id, replica_service_id, venues!venue_id (name)')
    .in('id', context.linkIds)
    .is('released_at', null);
  const replicas = (links ?? [])
    .filter((l) => l.replica_service_id)
    .map((l) => {
      const venue = l.venues as { name?: string } | { name?: string }[] | null;
      return {
        venueId: l.venue_id as string,
        venueName: (Array.isArray(venue) ? venue[0]?.name : venue?.name) ?? 'A venue',
        serviceId: l.replica_service_id as string,
      };
    });
  if (replicas.length === 0) return [];

  const columns = turnedOff.map((f) => f.column);
  const { data: rows } = await admin
    .from('calendar_service_assignments')
    .select(`calendar_id, service_item_id, ${columns.join(', ')}, unified_calendars!calendar_id (name)`)
    .in(
      'service_item_id',
      replicas.map((r) => r.serviceId),
    );

  const cleared = new Map<string, MemberValuesCleared>();
  for (const row of (rows ?? []) as unknown as Record<string, unknown>[]) {
    const replica = replicas.find((r) => r.serviceId === row.service_item_id);
    if (!replica) continue;
    const fields = turnedOff.filter((f) => row[f.column] !== null && row[f.column] !== undefined);
    if (fields.length === 0) continue;

    const { error } = await admin.rpc('collective_set_calendar_values', {
      p_calendar_id: row.calendar_id as string,
      p_service_item_id: replica.serviceId,
      p_values: Object.fromEntries(fields.map((f) => [f.column, null])),
      p_actor_venue_id: params.actorVenueId,
      p_actor_user_id: params.actorUserId,
    });
    if (error) {
      console.error('[collective] could not clear a member calendar value:', error.message);
      continue;
    }

    const calendar = row.unified_calendars as { name?: string } | { name?: string }[] | null;
    const calendarName = (Array.isArray(calendar) ? calendar[0]?.name : calendar?.name) ?? 'A calendar';
    const entry = cleared.get(replica.venueId) ?? {
      venue_id: replica.venueId,
      venue_name: replica.venueName,
      calendars: [],
      fields: [],
    };
    entry.calendars.push(calendarName);
    for (const field of fields) if (!entry.fields.includes(field.label)) entry.fields.push(field.label);
    cleared.set(replica.venueId, entry);
  }

  if (cleared.size === 0) return [];

  // N15: once per venue for the save, naming its own calendars and what they now use. The prices
  // are the host's, so they are written in the host's currency, which every member shares.
  const { data: hostVenue } = await admin.from('venues').select('currency').eq('id', params.actorVenueId).maybeSingle();
  const standard = standardValueWords(
    params.after,
    turnedOff.map((f) => f.column),
    currencySymbolFromCode((hostVenue?.currency as string | null) ?? null),
  );
  for (const venue of cleared.values()) {
    const subject = collectiveCopy('notify.valuesCleared.subject', { service: params.serviceName });
    const body = collectiveCopy(venue.calendars.length === 1 ? 'notify.valuesCleared.bodyOne' : 'notify.valuesCleared.body', {
      host: context.hostVenueName,
      field: joinNames(venue.fields),
      service: params.serviceName,
      calendars: joinNames(venue.calendars),
      value: standard,
    });
    await notifyVenue(
      admin,
      venue.venue_id,
      subject,
      { heading: subject, paragraphs: [body] },
      { type: 'collective_values_cleared', category: 'collective', collectiveId: context.collectiveId },
    ).catch(() => undefined);
  }

  return [...cleared.values()];
}

/** The service's own values for the fields that were cleared: what every calendar now uses. */
function standardValueWords(
  service: Record<string, unknown>,
  clearedColumns: string[],
  currencySymbol: string,
): string {
  const serviceColumn: Record<string, string> = {
    custom_price_pence: 'price_pence',
    custom_deposit_pence: 'deposit_pence',
    custom_duration_minutes: 'duration_minutes',
    custom_buffer_minutes: 'buffer_minutes',
  };
  return joinNames(
    clearedColumns.map((column) => {
      const value = service[serviceColumn[column] ?? ''];
      // The service's own value is the standard; a service with none says so rather than "null".
      if (value === null || value === undefined) {
        return column === 'custom_deposit_pence' ? 'no deposit' : 'the service setting';
      }
      return describeCalendarValue(column, value, currencySymbol);
    }),
  );
}
