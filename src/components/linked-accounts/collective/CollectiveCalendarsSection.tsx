'use client';

/**
 * Which calendars offer a service, at every venue in the collective (UX spec §2 item 1
 * `CollectiveCalendarsSection`; plan §6.7; W5).
 *
 * This replaces the host's own calendars list on the service page. The host's venue comes first,
 * then members A to Z, and every row is the same row wherever it lives: a tick box, what that
 * calendar charges or times differently, and who last changed it. The ticks are held as a diff
 * (`add` and `remove`), never as a picture of the whole set, so two venues saving at once cannot
 * silently undo each other; the save sends the diff to the engine, which is the only writer of
 * another venue's assignments.
 *
 * Nothing here writes: the page's Save does.
 */
import { useMemo } from 'react';
import { Pill } from '@/components/ui/dashboard/Pill';
import { Button } from '@/components/ui/primitives/Button';
import { EditReachNote, VenueSyncPill } from './CollectivePills';
import { collectiveCopy } from '@/lib/linked-accounts/collective-copy';
import type {
  CollectiveCalendarAssignment,
  CollectiveCalendarGroup,
} from '@/lib/linked-accounts/replicas/host-calendars';
import type { CollectiveHiddenReason } from '@/lib/linked-accounts/replicas/status';

export interface CollectiveCalendarRef {
  calendar_id: string;
  venue_id: string;
}

/** What the host has changed but not saved: intent, never a picture of the whole set. */
export interface CollectiveCalendarsValue {
  add: CollectiveCalendarRef[];
  remove: CollectiveCalendarRef[];
}

export const EMPTY_CALENDARS_VALUE: CollectiveCalendarsValue = { add: [], remove: [] };

export interface CollectiveCalendarsSectionProps {
  groups: CollectiveCalendarGroup[];
  /** The offering this service is; null while it is not on the page, when nothing is shown. */
  itemId: string | null;
  collectiveName: string;
  currencySymbol?: string;
  value: CollectiveCalendarsValue;
  onChange: (next: CollectiveCalendarsValue) => void;
  onEditValues?: (venueId: string, calendarId: string) => void;
  /** From the service's `collective.hidden_reasons`: where guests cannot book it, and why. */
  hiddenReasons?: CollectiveHiddenReason[];
  /** One venue only, for the grid's cell popover. */
  scope?: string | null;
  loading?: boolean;
  /**
   * The service's own values, shown in the comparison where a calendar keeps them, so a row reads
   * "30 min" rather than a bare "Standard". A calendar's own value is shown in bold.
   */
  defaults?: CompareDefaults;
}

export interface CompareDefaults {
  durationMinutes: number | null;
  bufferMinutes: number | null;
  pricePence: number | null;
  depositPence: number | null;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const sameRef = (a: CollectiveCalendarRef, b: CollectiveCalendarRef) =>
  a.calendar_id === b.calendar_id && a.venue_id === b.venue_id;

export function CollectiveCalendarsSection({
  groups,
  itemId,
  collectiveName,
  currencySymbol = '£',
  value,
  onChange,
  onEditValues,
  hiddenReasons = [],
  scope = null,
  loading = false,
  defaults,
}: CollectiveCalendarsSectionProps) {
  const shown = useMemo(
    () => (scope ? groups.filter((g) => g.venue_id === scope) : groups),
    [groups, scope],
  );
  /** Every calendar that offers this service, for the comparison. */
  const compareRows = useMemo(
    () =>
      shown.flatMap((group) =>
        group.calendars.flatMap((calendar) => {
          const assignment = calendar.assigned.find((a) => a.item_id === itemId);
          return assignment ? [{ group, calendar, assignment }] : [];
        }),
      ),
    [shown, itemId],
  );
  const reasonsByVenue = useMemo(() => {
    const map = new Map<string, CollectiveHiddenReason[]>();
    for (const reason of hiddenReasons) {
      map.set(reason.venue_id, [...(map.get(reason.venue_id) ?? []), reason]);
    }
    return map;
  }, [hiddenReasons]);

  const toggle = (ref: CollectiveCalendarRef, savedOn: boolean, nowOn: boolean) => {
    const add = value.add.filter((r) => !sameRef(r, ref));
    const remove = value.remove.filter((r) => !sameRef(r, ref));
    if (nowOn && !savedOn) add.push(ref);
    if (!nowOn && savedOn) remove.push(ref);
    onChange({ add, remove });
  };

  if (!itemId) return null;

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{collectiveCopy('svc.cal.heading')}</h3>
        <EditReachNote>{collectiveCopy('svc.cal.help.collective', { collective: collectiveName })}</EditReachNote>
      </div>

      {loading
        ? shown.map((group) => <GroupSkeleton key={group.venue_id} name={group.venue_name} />)
        : shown.map((group) => {
            const warnings = venueWarnings(group, reasonsByVenue.get(group.venue_id) ?? [], collectiveName, itemId);
            return (
              <div key={group.venue_id} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-sm font-semibold text-slate-800">
                    {group.is_host ? collectiveCopy('svc.cal.venueYou', { venue: group.venue_name }) : group.venue_name}
                  </h4>
                  <VenueSyncPill status={groupStatus(group)} reason={warnings[0] ?? null} />
                </div>
                {warnings.map((warning) => (
                  <p key={warning} className="mt-1 text-xs text-amber-800">
                    {warning}
                  </p>
                ))}

                {group.calendars.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-500">
                    {collectiveCopy('svc.cal.noCalendars', { venue: group.venue_name })}
                  </p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {group.calendars.map((calendar) => {
                      const ref = { calendar_id: calendar.id, venue_id: group.venue_id };
                      const assignment = calendar.assigned.find((a) => a.item_id === itemId) ?? null;
                      const savedOn = assignment !== null;
                      const pendingAdd = value.add.some((r) => sameRef(r, ref));
                      const pendingRemove = value.remove.some((r) => sameRef(r, ref));
                      const checked = pendingAdd || (savedOn && !pendingRemove);
                      const chips = valueChips(assignment, currencySymbol);
                      return (
                        <li key={calendar.id} className="flex flex-wrap items-center gap-2">
                          <label className="flex items-center gap-2 text-sm text-slate-800">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => toggle(ref, savedOn, e.target.checked)}
                              aria-label={`${calendar.name} at ${group.venue_name}`}
                              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                            />
                            <span>{calendar.name}</span>
                          </label>
                          {!calendar.is_active ? (
                            <span className="text-xs text-slate-500">
                              {collectiveCopy('svc.cal.inactiveOther', { venue: group.venue_name })}
                            </span>
                          ) : null}
                          {chips.map((chip) => (
                            <Pill key={chip} variant="neutral" size="sm">
                              {chip}
                            </Pill>
                          ))}
                          {pendingAdd ? (
                            <span className="text-xs font-medium text-brand-700">
                              {collectiveCopy('svc.cal.notSaved.add')}
                            </span>
                          ) : null}
                          {pendingRemove ? (
                            <span className="text-xs font-medium text-amber-800">
                              {collectiveCopy('svc.cal.notSaved.remove')}
                            </span>
                          ) : null}
                          {savedOn && onEditValues ? (
                            <Button
                              variant="link"
                              size="sm"
                              type="button"
                              onClick={() => onEditValues(group.venue_id, calendar.id)}
                            >
                              {collectiveCopy('svc.cal.editValues')}
                            </Button>
                          ) : null}
                          {recentChange(assignment) ? (
                            <span className="text-xs text-slate-500">
                              {collectiveCopy('svc.cal.lastChanged', {
                                venue: assignment!.last_changed!.venue_name,
                                date: formatDay(assignment!.last_changed!.at),
                              })}
                            </span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}

      {!loading && shown.length > 0 ? (
        <details className="rounded-xl border border-slate-200 bg-white p-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">
            {collectiveCopy('svc.cal.compare')}
          </summary>
          {/* Phones read one calendar at a time; wider screens get the side-by-side table. */}
          <ul className="mt-2 space-y-2 sm:hidden">
            {compareRows.map(({ group, calendar, assignment }) => (
              <li key={`${group.venue_id}-${calendar.id}`} className="rounded-lg border border-slate-100 p-2 text-xs">
                <p className="font-medium text-slate-800">
                  {calendar.name} <span className="font-normal text-slate-500">({group.venue_name})</span>
                </p>
                <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
                  {compareFields(assignment, defaults, currencySymbol).map((field) => (
                    <div key={field.label} className="flex justify-between gap-2">
                      <dt className="text-slate-500">{field.label}</dt>
                      <dd className={field.own ? 'font-semibold text-slate-900' : 'text-slate-500'}>{field.text}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
          <div className="mt-2 hidden overflow-x-auto sm:block">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1 pr-3 font-medium">Calendar</th>
                  <th className="py-1 pr-3 font-medium">Venue</th>
                  <th className="py-1 pr-3 font-medium">Length</th>
                  <th className="py-1 pr-3 font-medium">Buffer</th>
                  <th className="py-1 pr-3 font-medium">Price</th>
                  <th className="py-1 font-medium">Deposit</th>
                </tr>
              </thead>
              <tbody>
                {compareRows.map(({ group, calendar, assignment }) => (
                  <tr key={`${group.venue_id}-${calendar.id}`} className="border-t border-slate-100">
                    <td className="py-1 pr-3 text-slate-800">{calendar.name}</td>
                    <td className="py-1 pr-3 text-slate-600">{group.venue_name}</td>
                    {compareFields(assignment, defaults, currencySymbol).map((field, i, all) => (
                      <td
                        key={field.label}
                        className={`whitespace-nowrap py-1 ${i < all.length - 1 ? 'pr-3' : ''} ${
                          field.own ? 'font-semibold text-slate-900' : 'text-slate-500'
                        }`}
                      >
                        {field.text}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </section>
  );
}

function GroupSkeleton({ name }: { name: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-sm font-semibold text-slate-800">{name}</p>
      <div className="mt-2 space-y-2" aria-hidden="true">
        <div className="h-4 w-40 animate-pulse rounded bg-slate-100" />
        <div className="h-4 w-32 animate-pulse rounded bg-slate-100" />
      </div>
    </div>
  );
}

/** First the copies, then where guests cannot book it: the same order the sentences are read in. */
export function venueWarnings(
  group: CollectiveCalendarGroup,
  reasons: CollectiveHiddenReason[],
  collectiveName: string,
  itemId: string | null = null,
): string[] {
  const out: string[] = [];
  // The venue was asked whether to use its own same-named service (plan L13): no copy until it answers.
  if (itemId && (group.awaiting_answer ?? []).includes(itemId)) {
    out.push(collectiveCopy('svc.cal.warn.awaiting', { venue: group.venue_name }));
  }
  for (const venue of group.sync.pending) {
    out.push(collectiveCopy('svc.cal.warn.settingUp', { venue: venue.venue_name }));
  }
  for (const venue of group.sync.failed) {
    out.push(
      collectiveCopy('svc.cal.warn.failed', {
        venue: venue.venue_name,
        reason: venue.message || collectiveCopy('sync.reason.unknown'),
      }),
    );
  }
  for (const reason of reasons) {
    if (reason.reason === 'payments') out.push(collectiveCopy('svc.cal.warn.noStripe', { venue: reason.venue_name }));
    if (reason.reason === 'forms') out.push(collectiveCopy('svc.cal.warn.formsOff', { venue: reason.venue_name }));
    if (reason.reason === 'suspended') {
      out.push(collectiveCopy('svc.cal.warn.suspended', { venue: reason.venue_name, collective: collectiveName }));
    }
  }
  return out;
}

function groupStatus(group: CollectiveCalendarGroup) {
  if (group.sync.failed.length > 0) return 'failed' as const;
  if (group.sync.pending.length > 0) return 'updating' as const;
  return 'up_to_date' as const;
}

/** A change is worth naming for 30 days; after that it is just how the calendar is. */
function recentChange(assignment: CollectiveCalendarAssignment | null): boolean {
  const at = assignment?.last_changed?.at;
  if (!at) return false;
  const when = Date.parse(at);
  return Number.isFinite(when) && Date.now() - when <= THIRTY_DAYS_MS;
}

export function valueChips(
  assignment: CollectiveCalendarAssignment | null,
  currencySymbol: string,
): string[] {
  if (!assignment) return [];
  const v = assignment.values;
  const chips: string[] = [];
  if (v.custom_price_pence != null) {
    chips.push(collectiveCopy('svc.cal.chip.price', { price: money(v.custom_price_pence, currencySymbol) }));
  }
  if (v.custom_duration_minutes != null) {
    chips.push(collectiveCopy('svc.cal.chip.length', { minutes: v.custom_duration_minutes }));
  }
  if (v.custom_buffer_minutes != null) {
    chips.push(collectiveCopy('svc.cal.chip.buffer', { minutes: v.custom_buffer_minutes }));
  }
  if (v.custom_deposit_pence != null) {
    chips.push(collectiveCopy('svc.cal.chip.deposit', { price: money(v.custom_deposit_pence, currencySymbol) }));
  }
  if (v.custom_colour) chips.push(collectiveCopy('svc.cal.chip.colour'));
  if (v.custom_name) chips.push(collectiveCopy('svc.cal.chip.name'));
  return chips;
}

const money = (pence: number, symbol: string) => `${symbol}${(pence / 100).toFixed(2)}`;
/**
 * Length, buffer, price and deposit for one calendar: its own value (`own`, shown in bold),
 * otherwise the service's, or "Standard" when that is unknown.
 */
export function compareFields(
  assignment: CollectiveCalendarAssignment,
  defaults: CompareDefaults | undefined,
  currencySymbol: string,
): { label: string; text: string; own: boolean }[] {
  const minutes = (m: number) => `${m} min`;
  const price = (p: number) => money(p, currencySymbol);
  const v = assignment.values;
  const field = (
    label: string,
    own: number | null,
    fallback: number | null | undefined,
    format: (n: number) => string,
  ) =>
    own != null
      ? { label, text: format(own), own: true }
      : {
          label,
          text:
            fallback === 0
              ? 'None'
              : fallback != null
                ? format(fallback)
                : collectiveCopy('svc.cal.compare.standard'),
          own: false,
        };
  return [
    field('Length', v.custom_duration_minutes, defaults?.durationMinutes, minutes),
    field('Buffer', v.custom_buffer_minutes, defaults?.bufferMinutes, minutes),
    field('Price', v.custom_price_pence, defaults?.pricePence, price),
    field('Deposit', v.custom_deposit_pence, defaults?.depositPence, price),
  ];
}

function formatDay(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
