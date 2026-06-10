'use client';

import { useCallback, useEffect, useState } from 'react';

interface FlagVenue {
  id: string;
  name: string;
  slug: string;
  plan: string;
  plan_status: string;
  flags: Record<string, boolean>;
}

interface FlagsPayload {
  flag_keys: string[];
  adoption: Array<{ key: string; enabled_count: number }>;
  venues: FlagVenue[];
}

const FLAG_LABELS: Record<string, { label: string; description: string }> = {
  waitlist_v2: { label: 'Waitlist v2', description: 'Appointment waitlist with automated offers' },
  guest_self_reschedule: { label: 'Guest self-reschedule', description: 'Guests can move their own bookings' },
  any_available_practitioner: {
    label: 'Any practitioner',
    description: '“Any available” practitioner option at booking',
  },
  class_commerce_enabled: { label: 'Class commerce', description: 'Paid classes, passes and memberships' },
  compliance_records_enabled: { label: 'Compliance records', description: 'Practitioner compliance tracking' },
};

function flagMeta(key: string): { label: string; description: string } {
  return FLAG_LABELS[key] ?? { label: key.replace(/_/g, ' '), description: '' };
}

export function FlagsPageClient() {
  const [data, setData] = useState<FlagsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null); // `${venueId}:${key}`

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/platform/feature-flags', { credentials: 'same-origin' });
      const body = (await res.json().catch(() => ({}))) as FlagsPayload & { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Failed to load feature flags');
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(venueId: string, key: string, value: boolean) {
    const busyKey = `${venueId}:${key}`;
    setBusy(busyKey);
    // Optimistic update.
    setData((prev) =>
      prev
        ? {
            ...prev,
            venues: prev.venues.map((v) =>
              v.id === venueId ? { ...v, flags: { ...v.flags, [key]: value } } : v,
            ),
            adoption: prev.adoption.map((a) =>
              a.key === key ? { ...a, enabled_count: a.enabled_count + (value ? 1 : -1) } : a,
            ),
          }
        : prev,
    );
    try {
      const res = await fetch('/api/platform/feature-flags', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venue_id: venueId, key, value }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Failed to update flag');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update flag');
      await load(); // revert optimistic state
    } finally {
      setBusy(null);
    }
  }

  const venues = (data?.venues ?? []).filter(
    (v) => !search || `${v.name} ${v.slug}`.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Feature flags</h1>
        <p className="mt-1 text-sm text-slate-500">
          Per-venue beta toggles. Changes apply immediately and are recorded in the audit log.
          Environment-level overrides (env vars) still take precedence where configured.
        </p>
      </div>

      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>
      ) : null}

      {/* Adoption summary */}
      {data ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          {data.adoption.map((a) => {
            const meta = flagMeta(a.key);
            return (
              <div key={a.key} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold text-slate-700">{meta.label}</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">
                  {a.enabled_count}
                  <span className="text-sm font-medium text-slate-400">/{data.venues.length}</span>
                </p>
                <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-400">{meta.description}</p>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
          <input
            type="search"
            placeholder="Search venues…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full max-w-xs rounded-lg border border-slate-200 px-3 py-2 text-sm placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
          <span className="ml-auto text-xs text-slate-400">
            {venues.length} live venue{venues.length === 1 ? '' : 's'}
          </span>
        </div>

        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />
            ))}
          </div>
        ) : !data ? null : venues.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-slate-400">No venues match your search.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Venue</th>
                  {data.flag_keys.map((key) => (
                    <th key={key} className="px-3 py-3 text-center font-medium">
                      {flagMeta(key).label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {venues.map((v) => (
                  <tr key={v.id} className="hover:bg-slate-50/60">
                    <td className="px-5 py-3">
                      <p className="font-medium text-slate-900">{v.name}</p>
                      <p className="text-xs text-slate-400">{v.plan}</p>
                    </td>
                    {data.flag_keys.map((key) => {
                      const on = v.flags[key];
                      const isBusy = busy === `${v.id}:${key}`;
                      return (
                        <td key={key} className="px-3 py-3 text-center">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={on}
                            disabled={isBusy}
                            onClick={() => void toggle(v.id, key, !on)}
                            className={`relative inline-flex h-5.5 w-10 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                              on ? 'bg-emerald-500' : 'bg-slate-200'
                            }`}
                            style={{ height: 22 }}
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                                on ? 'translate-x-5' : 'translate-x-1'
                              }`}
                            />
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
