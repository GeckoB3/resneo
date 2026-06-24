'use client';

import { useEffect, useState } from 'react';
import { Skeleton } from '@/components/ui/Skeleton';

export interface GuestClassInstanceOption {
  instance_id: string;
  instance_date: string;
  start_time: string;
  duration_minutes: number;
  remaining: number;
}

function formatInstanceDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * Lists FUTURE bookable instances of the booking's class type (from
 * /api/booking/class-instances) and lets the guest pick one to move to. The
 * currently-booked instance is excluded server-side from the "move" choice; we
 * additionally hide it here if present. Selection is lifted via callback; the
 * move is re-validated (and capacity re-checked) on submit.
 */
export function GuestClassModifyInstancePicker({
  venueId,
  classTypeId,
  currentInstanceId,
  selectedInstanceId,
  onSelect,
  disabled = false,
}: {
  venueId: string;
  classTypeId: string;
  currentInstanceId: string;
  selectedInstanceId: string | null;
  onSelect: (instance: GuestClassInstanceOption) => void;
  disabled?: boolean;
}) {
  const [instances, setInstances] = useState<GuestClassInstanceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const url = `/api/booking/class-instances?venue_id=${encodeURIComponent(
          venueId,
        )}&class_type_id=${encodeURIComponent(classTypeId)}`;
        const res = await fetch(url);
        const data = (await res.json()) as {
          instances?: GuestClassInstanceOption[];
          error?: string;
        };
        if (!res.ok) throw new Error(data.error ?? 'Failed to load sessions');
        if (!cancelled) {
          setInstances(
            (data.instances ?? []).filter((i) => i.instance_id !== currentInstanceId),
          );
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load sessions');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [venueId, classTypeId, currentInstanceId]);

  if (loading) {
    return (
      <div className="space-y-2" role="status" aria-label="Loading sessions">
        <Skeleton.Block className="h-12" />
        <Skeleton.Block className="h-12" />
        <Skeleton.Block className="h-12 w-2/3" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
    );
  }

  if (instances.length === 0) {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        There are no other upcoming sessions of this class to move to right now.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-slate-800">Choose a new session</p>
      <div className="space-y-2">
        {instances.map((inst) => {
          const selected = inst.instance_id === selectedInstanceId;
          return (
            <button
              key={inst.instance_id}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(inst)}
              aria-pressed={selected}
              className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left transition-colors ${
                selected
                  ? 'border-brand-600 bg-brand-50 ring-2 ring-brand-500/30'
                  : 'border-slate-200 bg-white hover:border-brand-300 hover:bg-brand-50/40'
              } disabled:opacity-50`}
            >
              <span className="text-sm font-medium text-slate-800">
                {formatInstanceDate(inst.instance_date)} · {inst.start_time.slice(0, 5)}
              </span>
              <span className="text-xs text-slate-500">
                {inst.remaining} {inst.remaining === 1 ? 'space' : 'spaces'} left
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
