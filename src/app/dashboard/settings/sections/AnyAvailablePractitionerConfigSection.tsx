'use client';

import { useCallback, useMemo, useState } from 'react';
import type { AnyAvailablePractitionerConfig } from '@/lib/feature-flags/any-available-practitioner-config';

interface CalendarRow {
  id: string;
  name: string;
}

function buildOrderFromCalendars(
  calendars: CalendarRow[],
  savedOrder: string[],
): string[] {
  const ids = calendars.map((c) => c.id);
  const fromSaved = savedOrder.filter((id) => ids.includes(id));
  const seen = new Set(fromSaved);
  for (const id of ids) {
    if (!seen.has(id)) {
      fromSaved.push(id);
      seen.add(id);
    }
  }
  return fromSaved;
}

export function AnyAvailablePractitionerConfigSection({
  enabled,
  initialConfig,
  calendars,
  saving,
  onSave,
}: {
  enabled: boolean;
  initialConfig: AnyAvailablePractitionerConfig;
  calendars: CalendarRow[];
  saving: boolean;
  onSave: (config: AnyAvailablePractitionerConfig) => Promise<void>;
}) {
  const [mode, setMode] = useState<AnyAvailablePractitionerConfig['mode']>(initialConfig.mode);
  const [order, setOrder] = useState<string[]>(() =>
    buildOrderFromCalendars(calendars, initialConfig.calendar_order),
  );

  const configSyncKey = `${initialConfig.mode}\0${initialConfig.calendar_order.join(',')}\0${calendars.map((c) => c.id).join(',')}`;
  const [appliedConfigSyncKey, setAppliedConfigSyncKey] = useState(configSyncKey);
  if (configSyncKey !== appliedConfigSyncKey) {
    setAppliedConfigSyncKey(configSyncKey);
    setMode(initialConfig.mode);
    setOrder(buildOrderFromCalendars(calendars, initialConfig.calendar_order));
  }

  const orderedCalendars = useMemo(() => {
    const byId = new Map(calendars.map((c) => [c.id, c]));
    return order.map((id) => byId.get(id)).filter((c): c is CalendarRow => Boolean(c));
  }, [calendars, order]);

  const persist = useCallback(
    async (nextMode: AnyAvailablePractitionerConfig['mode'], nextOrder: string[]) => {
      await onSave({
        mode: nextMode,
        calendar_order: nextOrder,
      });
    },
    [onSave],
  );

  if (!enabled) return null;

  return (
    <div className="mt-3 rounded-xl border border-brand-100 bg-white px-4 py-4">
      <p className="text-sm font-semibold text-slate-900">Who gets the booking?</p>
      <p className="mt-1 text-xs text-slate-600">
        When several calendars are free at the same time, choose how the system picks who receives the
        appointment.
      </p>

      <div className="mt-4 space-y-2">
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 px-3 py-2.5 hover:bg-slate-50/80">
          <input
            type="radio"
            name="any-available-mode"
            className="mt-0.5"
            checked={mode === 'priority'}
            disabled={saving}
            onChange={() => {
              setMode('priority');
              void persist('priority', order);
            }}
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-slate-900">Priority order</span>
            <span className="mt-0.5 block text-xs text-slate-600">
              Use the first calendar in your list that is available at that time.
            </span>
          </span>
        </label>

        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 px-3 py-2.5 hover:bg-slate-50/80">
          <input
            type="radio"
            name="any-available-mode"
            className="mt-0.5"
            checked={mode === 'random'}
            disabled={saving}
            onChange={() => {
              setMode('random');
              void persist('random', order);
            }}
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-slate-900">Random</span>
            <span className="mt-0.5 block text-xs text-slate-600">
              Each booking is assigned to a random available calendar at that time.
            </span>
          </span>
        </label>
      </div>

      {mode === 'priority' && orderedCalendars.length > 0 ? (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Calendar priority</p>
          <p className="mt-0.5 text-xs text-slate-600">Top of the list is checked first when a guest picks a time.</p>
          <ol className="mt-2 space-y-1.5">
            {orderedCalendars.map((cal, index) => (
              <li
                key={cal.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2"
              >
                <span className="min-w-0 truncate text-sm font-medium text-slate-900">
                  {index + 1}. {cal.name}
                </span>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    disabled={saving || index === 0}
                    onClick={() => {
                      const next = [...order];
                      const tmp = next[index - 1]!;
                      next[index - 1] = next[index]!;
                      next[index] = tmp;
                      setOrder(next);
                      void persist('priority', next);
                    }}
                    className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                    aria-label={`Move ${cal.name} up`}
                  >
                    Up
                  </button>
                  <button
                    type="button"
                    disabled={saving || index === orderedCalendars.length - 1}
                    onClick={() => {
                      const next = [...order];
                      const tmp = next[index + 1]!;
                      next[index + 1] = next[index]!;
                      next[index] = tmp;
                      setOrder(next);
                      void persist('priority', next);
                    }}
                    className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                    aria-label={`Move ${cal.name} down`}
                  >
                    Down
                  </button>
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {mode === 'priority' && orderedCalendars.length === 0 ? (
        <p className="mt-3 text-xs text-amber-800">
          Add active calendars under Calendar availability before setting a priority order.
        </p>
      ) : null}
    </div>
  );
}
