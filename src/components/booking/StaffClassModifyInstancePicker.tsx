'use client';

import { useEffect, useMemo, useState } from 'react';
import { classOfferingsUrl } from '@/lib/booking/booking-flow-api';
import { todayYmdLocal } from '@/components/booking/ResourceCalendarMonth';
import { Skeleton } from '@/components/ui/Skeleton';

interface ClassOfferingInstance {
  instance_id: string;
  class_type_id: string;
  class_name?: string;
  instance_date: string;
  start_time: string;
  remaining: number;
  capacity: number;
}

function formatInstanceDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * Staff class slot-move picker (§5.6 #1). Lists upcoming instances of the SAME
 * class type as the booking and moves it via PATCH /api/venue/bookings/[id] with
 * `target_class_instance_id`. The class type is derived from the booking's
 * current instance via the staff class-offerings catalogue (so callers don't
 * need to thread class_type_id through). The move is re-validated + capacity
 * re-checked server-side (capacity-safe via the enforce_cde_capacity trigger).
 */
export function StaffClassModifyInstancePicker({
  bookingId,
  venueId,
  currentInstanceId,
  ownerVenueId,
  onSaved,
  onClose,
}: {
  bookingId: string;
  venueId: string;
  currentInstanceId: string;
  /** Linked-venue catalogue owner; passed to the staff offerings route. */
  ownerVenueId?: string | null;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [instances, setInstances] = useState<ClassOfferingInstance[]>([]);
  const [classTypeId, setClassTypeId] = useState<string | null>(null);
  const [className, setClassName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch(classOfferingsUrl('staff', venueId, ownerVenueId ?? undefined));
        const data = (await res.json()) as { instances?: ClassOfferingInstance[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? 'Failed to load class sessions');
        const all = data.instances ?? [];
        const current = all.find((i) => i.instance_id === currentInstanceId) ?? null;
        if (!cancelled) {
          setClassTypeId(current?.class_type_id ?? null);
          setClassName(current?.class_name ?? null);
          setInstances(all);
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Could not load class sessions');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [venueId, ownerVenueId, currentInstanceId]);

  const today = todayYmdLocal();
  const options = useMemo(() => {
    if (!classTypeId) return [];
    return instances
      .filter(
        (i) =>
          i.class_type_id === classTypeId &&
          i.instance_id !== currentInstanceId &&
          i.remaining > 0 &&
          i.instance_date >= today,
      )
      .sort(
        (a, b) =>
          a.instance_date.localeCompare(b.instance_date) || a.start_time.localeCompare(b.start_time),
      );
  }, [instances, classTypeId, currentInstanceId, today]);

  const handleSave = async () => {
    if (!selectedId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/venue/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_class_instance_id: selectedId }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setSaveError(j.error ?? 'Could not move the booking.');
        return;
      }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-2" role="status" aria-label="Loading sessions">
        <Skeleton.Block className="h-12" />
        <Skeleton.Block className="h-12" />
        <Skeleton.Block className="h-12 w-2/3" />
      </div>
    );
  }

  if (loadError) {
    return (
      <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">{loadError}</p>
    );
  }

  if (!classTypeId) {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        This class session can&rsquo;t be matched to a class type, so it can&rsquo;t be moved here.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-slate-800">
        Move to another {className ? `${className} ` : ''}session
      </p>

      {options.length === 0 ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          No other upcoming sessions of this class have space right now.
        </p>
      ) : (
        <div className="space-y-2">
          {options.map((inst) => {
            const selected = inst.instance_id === selectedId;
            return (
              <button
                key={inst.instance_id}
                type="button"
                disabled={saving}
                onClick={() => setSelectedId(inst.instance_id)}
                aria-pressed={selected}
                className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-colors ${
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
      )}

      {saveError ? (
        <p className="rounded-lg border border-red-100 bg-red-50 px-2 py-1.5 text-xs text-red-700">{saveError}</p>
      ) : null}

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          disabled={saving || !selectedId}
          onClick={() => void handleSave()}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? 'Moving…' : 'Move booking'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Close
        </button>
      </div>
    </div>
  );
}
