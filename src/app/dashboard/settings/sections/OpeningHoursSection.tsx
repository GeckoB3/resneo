'use client';

import { useCallback, useState } from 'react';
import type { VenueSettings, OpeningHoursSettings, OpeningHoursDaySettings } from '../types';
import { BusinessClosuresSection } from './BusinessClosuresSection';
import { OpeningHoursControl } from '@/components/scheduling/OpeningHoursControl';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { readResponseJson } from '@/lib/http/read-response-json';
import { describeVenueWeeklyMismatch, type CalendarLike } from '@/lib/calendar/hours-mismatch';

const DAYS: { key: string; label: string }[] = [
  { key: '0', label: 'Sunday' },
  { key: '1', label: 'Monday' },
  { key: '2', label: 'Tuesday' },
  { key: '3', label: 'Wednesday' },
  { key: '4', label: 'Thursday' },
  { key: '5', label: 'Friday' },
  { key: '6', label: 'Saturday' },
];

/** Loads the roster and says which calendars the given weekly hours leave outside; null when none. */
async function venueWeeklyAdvice(openingHours: OpeningHoursSettings): Promise<string | null> {
  try {
    const res = await fetch('/api/venue/practitioners?roster=1', { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { practitioners?: CalendarLike[] };
    return describeVenueWeeklyMismatch(body.practitioners ?? [], openingHours);
  } catch {
    return null;
  }
}

function getDayConfig(oh: OpeningHoursSettings | null, day: string): OpeningHoursDaySettings {
  const d = oh?.[day] as { closed?: boolean; periods?: { open: string; close: string }[]; open?: string; close?: string } | undefined;
  if (!d) return { closed: true };
  if (d.periods?.length) return { periods: d.periods };
  if (d.closed === true) return { closed: true };
  if (typeof d.open === 'string' && typeof d.close === 'string') return { periods: [{ open: d.open, close: d.close }] };
  return { closed: true };
}

interface OpeningHoursSectionProps {
  venue: VenueSettings;
  onUpdate: (patch: Partial<VenueSettings>) => void;
  isAdmin: boolean;
  bookingModel: string;
  onInitialLoadComplete?: () => void;
  /** Weekly hours only; the closures card is rendered elsewhere (the diary's hours dialog tabs). */
  hideClosures?: boolean;
}

export function OpeningHoursSection({
  venue,
  onUpdate,
  isAdmin,
  bookingModel,
  onInitialLoadComplete,
  hideClosures = false,
}: OpeningHoursSectionProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** After a save: which calendars the new hours leave outside (guests cannot book those hours). */
  const [advice, setAdvice] = useState<string | null>(null);

  const [local, setLocal] = useState<OpeningHoursSettings>(() => {
    const o: OpeningHoursSettings = {};
    for (const { key } of DAYS) {
      o[key] = getDayConfig(venue.opening_hours, key);
    }
    return o;
  });

  const save = useCallback(async () => {
    setError(null);
    setSaving(true);
    try {
      const doSave = async (acknowledge: boolean): Promise<void> => {
        const res = await fetch(
          acknowledge ? '/api/venue/opening-hours?acknowledge_affected_bookings=true' : '/api/venue/opening-hours',
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(local),
          },
        );
        const body = await readResponseJson<{
          error?: string;
          opening_hours?: OpeningHoursSettings;
          requires_confirmation?: boolean;
          message?: string;
        }>(res);
        // Narrowing hours that leaves upcoming bookings outside the new hours is allowed,
        // but confirmed first so the change is made knowingly (the bookings are kept).
        if (res.status === 409 && body.requires_confirmation) {
          if (
            typeof window !== 'undefined' &&
            window.confirm(`${body.message ?? 'Some upcoming bookings fall outside the new hours.'}\n\nSave these hours anyway?`)
          ) {
            await doSave(true);
          }
          return;
        }
        if (!res.ok) {
          throw new Error(body.error ?? 'Failed to save');
        }
        if (!body.opening_hours) {
          throw new Error('Failed to save');
        }
        onUpdate({ opening_hours: body.opening_hours });
        setAdvice(await venueWeeklyAdvice(body.opening_hours));
      };
      await doSave(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [local, onUpdate]);

  return (
    <div className="space-y-6">
      <SectionCard elevated>
        <SectionCard.Header
          eyebrow="Hours"
          title="Weekly opening hours"
          description="Set the hours you are normally open each day. This is used for availability and guest messaging. Review carefully before publishing."
        />
        <SectionCard.Body className="space-y-4">
          <OpeningHoursControl value={local} onChange={setLocal} disabled={!isAdmin} />
          {error && <p className="text-sm text-red-600">{error}</p>}
          {advice ? (
            <div className="mb-4 flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 sm:flex-row sm:items-start sm:justify-between">
          <p>{advice}</p>
          <div className="flex shrink-0 items-center gap-2">
            <a
              href="/dashboard/calendar-availability?tab=hours"
              className="whitespace-nowrap rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
            >
              Open calendar hours
            </a>
            <button
              type="button"
              onClick={() => setAdvice(null)}
              className="text-xs font-medium text-amber-800 underline-offset-2 hover:underline"
            >
              Dismiss
            </button>
          </div>
        </div>
          ) : null}
          {isAdmin && (
            <div className="sticky bottom-0 z-10 -mx-4 border-t border-slate-100 bg-white/95 px-4 py-4 backdrop-blur-sm sm:-mx-6 sm:px-6">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-slate-500">Opening hours are saved explicitly so you can review the full week.</p>
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving}
                  className="inline-flex min-h-10 items-center justify-center rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save opening hours'}
                </button>
              </div>
            </div>
          )}
        </SectionCard.Body>
      </SectionCard>

      {hideClosures ? null : (
      <SectionCard elevated>
        <SectionCard.Header
          eyebrow="Exceptions"
          title="Closures & special days"
          description="Add bank holidays, private events, or other dates when you are closed or on different hours."
        />
        <SectionCard.Body>
          <BusinessClosuresSection
            bookingModel={bookingModel}
            venue={venue}
            isAdmin={isAdmin}
            onUpdate={onUpdate}
            onInitialLoadComplete={onInitialLoadComplete}
          />
        </SectionCard.Body>
      </SectionCard>
      )}
    </div>
  );
}
