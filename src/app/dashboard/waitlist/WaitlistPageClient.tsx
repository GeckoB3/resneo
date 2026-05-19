'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageFrame } from '@/components/ui/dashboard/PageFrame';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { TabBar } from '@/components/ui/dashboard/TabBar';
import { StackedList } from '@/components/ui/dashboard/StackedList';
import { ScheduleRow } from '@/components/ui/dashboard/ScheduleRow';
import { Pill, type PillVariant } from '@/components/ui/dashboard/Pill';
import { EmptyState } from '@/components/ui/dashboard/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { DashboardListSkeleton, DashboardTabRowSkeleton } from '@/components/ui/dashboard/DashboardSkeletons';
import type {
  WaitlistKindFilter,
  WaitlistVenueCapabilities,
} from '@/lib/booking/waitlist-venue-capabilities';

type WaitlistKind = 'table' | 'appointment';

interface WaitlistEntry {
  id: string;
  waitlist_kind?: WaitlistKind;
  desired_date: string;
  desired_time: string | null;
  party_size: number;
  guest_name: string;
  guest_first_name?: string | null;
  guest_last_name?: string | null;
  guest_email: string | null;
  guest_phone: string;
  status: 'waiting' | 'offered' | 'confirmed' | 'expired' | 'cancelled';
  offered_at: string | null;
  expires_at: string | null;
  notes: string | null;
  created_at: string;
  service_name?: string | null;
  practitioner_name?: string | null;
}

function statusPillVariant(status: WaitlistEntry['status']): PillVariant {
  switch (status) {
    case 'waiting':
      return 'warning';
    case 'offered':
      return 'brand';
    case 'confirmed':
      return 'success';
    case 'expired':
      return 'neutral';
    case 'cancelled':
      return 'danger';
    default:
      return 'neutral';
  }
}

function statusStripClass(status: WaitlistEntry['status']): string {
  switch (status) {
    case 'waiting':
      return 'bg-amber-500';
    case 'offered':
      return 'bg-brand-600';
    case 'confirmed':
      return 'bg-emerald-500';
    case 'expired':
      return 'bg-slate-400';
    case 'cancelled':
      return 'bg-rose-500';
    default:
      return 'bg-slate-400';
  }
}

function entryKind(entry: WaitlistEntry): WaitlistKind {
  return entry.waitlist_kind === 'appointment' ? 'appointment' : 'table';
}

function entryKindLabel(kind: WaitlistKind): string {
  return kind === 'appointment' ? 'Appointment' : 'Table booking';
}

function formatWaitlistDate(dateIso: string): string {
  return new Date(`${dateIso}T12:00:00`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function appointmentStaffLabel(entry: WaitlistEntry): string | null {
  if (entry.practitioner_name) return entry.practitioner_name;
  return 'Any team member';
}

function entrySubtitle(entry: WaitlistEntry): string {
  const kind = entryKind(entry);
  const parts: Array<string | null | undefined> = [
    entryKindLabel(kind),
    kind === 'appointment' && entry.service_name ? entry.service_name : null,
    kind === 'appointment' ? appointmentStaffLabel(entry) : null,
    formatWaitlistDate(entry.desired_date),
    entry.desired_time ? entry.desired_time.slice(0, 5) : null,
    kind === 'table'
      ? `${entry.party_size} ${entry.party_size === 1 ? 'guest' : 'guests'}`
      : null,
    entry.guest_phone,
    entry.guest_email ?? undefined,
  ];
  return parts.filter(Boolean).join(' · ');
}

function confirmButtonLabel(entry: WaitlistEntry): string {
  return entryKind(entry) === 'appointment' ? 'Book appointment' : 'Confirm booking';
}

function pageSubtitle(capabilities: WaitlistVenueCapabilities): string {
  if (capabilities.showKindTabs) {
    return 'Manage standby requests for table bookings and appointment slots.';
  }
  if (capabilities.showAppointmentWaitlist) {
    return 'Manage guests waiting for available appointment slots.';
  }
  return 'Manage guests waiting for a table booking.';
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error ?? fallback;
}

function apiKindParam(kindFilter: WaitlistKindFilter, capabilities: WaitlistVenueCapabilities): string | null {
  if (kindFilter === 'all') {
    return capabilities.showKindTabs ? null : capabilities.defaultKindFilter === 'all' ? null : capabilities.defaultKindFilter;
  }
  return kindFilter;
}

export function WaitlistPageClient({ capabilities }: { capabilities: WaitlistVenueCapabilities }) {
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'active' | 'all'>('active');
  const [kindFilter, setKindFilter] = useState<WaitlistKindFilter>(capabilities.defaultKindFilter);
  const [error, setError] = useState<string | null>(null);

  const kindTabs = useMemo(() => {
    if (!capabilities.showKindTabs) return [];
    return [
      { id: 'all' as const, label: 'All' },
      { id: 'table' as const, label: 'Table bookings' },
      { id: 'appointment' as const, label: 'Appointments' },
    ];
  }, [capabilities.showKindTabs]);

  const loadEntries = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      const kind = apiKindParam(kindFilter, capabilities);
      if (kind) {
        params.set('kind', kind);
      }
      const qs = params.toString();
      const res = await fetch(`/api/venue/waitlist${qs ? `?${qs}` : ''}`);
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries ?? []);
        setError(null);
      } else {
        setError(await readApiError(res, 'Failed to load waitlist entries'));
      }
    } finally {
      setLoading(false);
    }
  }, [kindFilter, capabilities]);

  useEffect(() => {
    setLoading(true);
    void loadEntries();
  }, [loadEntries]);

  async function handleOffer(entry: WaitlistEntry) {
    try {
      const res = await fetch('/api/venue/waitlist', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: entry.id, status: 'offered' }),
      });
      if (res.ok) {
        const data = (await res.json()) as { entry: WaitlistEntry; notify_failed?: boolean };
        setEntries(entries.map((e) => (e.id === entry.id ? data.entry : e)));
        setError(
          data.notify_failed
            ? 'Spot offered, but we could not send email or SMS to the guest. Contact them directly.'
            : null,
        );
      } else {
        setError(await readApiError(res, 'Failed to update waitlist entry'));
      }
    } catch {
      setError('Failed to update waitlist entry');
    }
  }

  async function handleConfirm(entry: WaitlistEntry) {
    try {
      const res = await fetch('/api/venue/waitlist', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: entry.id, status: 'confirmed' }),
      });
      if (res.ok) {
        const data = await res.json();
        setEntries(entries.map((e) => (e.id === entry.id ? data.entry : e)));
        setError(null);
      } else {
        setError(await readApiError(res, 'Failed to confirm waitlist entry'));
      }
    } catch {
      setError('Failed to confirm waitlist entry');
    }
  }

  async function handleCancel(entry: WaitlistEntry) {
    try {
      const res = await fetch('/api/venue/waitlist', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: entry.id, status: 'cancelled' }),
      });
      if (res.ok) {
        const data = await res.json();
        setEntries(entries.map((e) => (e.id === entry.id ? data.entry : e)));
        setError(null);
      } else {
        setError(await readApiError(res, 'Failed to cancel waitlist entry'));
      }
    } catch {
      setError('Failed to cancel waitlist entry');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Remove this entry permanently?')) return;
    try {
      const res = await fetch('/api/venue/waitlist', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        setEntries(entries.filter((e) => e.id !== id));
        setError(null);
      } else {
        setError(await readApiError(res, 'Failed to delete waitlist entry'));
      }
    } catch {
      setError('Failed to delete waitlist entry');
    }
  }

  const filteredEntries = useMemo(
    () =>
      filter === 'active'
        ? entries.filter((e) => e.status === 'waiting' || e.status === 'offered')
        : entries,
    [entries, filter],
  );

  const filterTabs = useMemo(
    () =>
      [
        { id: 'active' as const, label: 'Active' },
        { id: 'all' as const, label: 'All' },
      ] as const,
    [],
  );

  if (loading) {
    return (
      <PageFrame>
        <div className="space-y-6" role="status" aria-label="Loading waitlist">
          <div className="space-y-2">
            <Skeleton.Line className="w-28" />
            <Skeleton.Line className="h-8 w-48 max-w-full" />
            <Skeleton.Line className="h-3 w-full max-w-lg" />
          </div>
          <DashboardTabRowSkeleton tabCount={capabilities.showKindTabs ? 2 : 1} />
          <DashboardListSkeleton rowCount={8} />
        </div>
      </PageFrame>
    );
  }

  return (
    <PageFrame>
      <div className="space-y-6">
        <PageHeader
          eyebrow="Operations"
          title="Waitlist"
          subtitle={pageSubtitle(capabilities)}
          actions={
            <div className="flex flex-col items-stretch gap-2 sm:items-end">
              {kindTabs.length > 0 ? (
                <TabBar tabs={kindTabs} value={kindFilter} onChange={setKindFilter} />
              ) : null}
              <TabBar tabs={filterTabs} value={filter} onChange={setFilter} />
            </div>
          }
        />

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>
        )}

        <SectionCard elevated>
          <SectionCard.Header
            eyebrow="Queue"
            title={filter === 'active' ? 'Active requests' : 'All entries'}
            description={
              filter === 'active'
                ? 'Waiting and offered spots only.'
                : 'Full history including confirmed, expired, and cancelled.'
            }
            right={
              <span className="text-xs font-medium tabular-nums text-slate-500">
                {filteredEntries.length} {filteredEntries.length === 1 ? 'entry' : 'entries'}
              </span>
            }
          />
          <SectionCard.Body className="p-0 sm:p-0">
            {filteredEntries.length === 0 ? (
              <div className="px-5 py-8 sm:px-6">
                <EmptyState
                  title={filter === 'active' ? 'No active waitlist entries' : 'No waitlist entries'}
                  description={
                    filter === 'active'
                      ? 'When guests join the waitlist, they will appear here.'
                      : 'There is nothing in the waitlist history yet.'
                  }
                />
              </div>
            ) : (
              <StackedList
                flush
                items={filteredEntries}
                keyExtractor={(e) => e.id}
                renderDesktopRow={(entry) => (
                  <ScheduleRow
                    timeLabel={entry.desired_time ? entry.desired_time.slice(0, 5) : '—'}
                    title={entry.guest_name}
                    subtitle={entrySubtitle(entry)}
                    stripClassName={statusStripClass(entry.status)}
                    trailing={
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        <Pill variant={statusPillVariant(entry.status)} size="sm">
                          {entry.status.charAt(0).toUpperCase() + entry.status.slice(1)}
                        </Pill>
                        {entry.expires_at && entry.status === 'offered' && (
                          <span className="text-[10px] font-medium text-amber-700">
                            Expires{' '}
                            {new Date(entry.expires_at).toLocaleTimeString('en-GB', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        )}
                        {entry.status === 'waiting' && (
                          <button
                            type="button"
                            onClick={() => handleOffer(entry)}
                            className="min-h-10 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700"
                          >
                            Offer spot
                          </button>
                        )}
                        {entry.status === 'offered' && (
                          <button
                            type="button"
                            onClick={() => handleConfirm(entry)}
                            className="min-h-10 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
                          >
                            {confirmButtonLabel(entry)}
                          </button>
                        )}
                        {(entry.status === 'waiting' || entry.status === 'offered') && (
                          <button
                            type="button"
                            onClick={() => handleCancel(entry)}
                            className="min-h-10 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                          >
                            Cancel
                          </button>
                        )}
                        {(entry.status === 'expired' || entry.status === 'cancelled') && (
                          <button
                            type="button"
                            onClick={() => handleDelete(entry.id)}
                            className="flex min-h-10 min-w-10 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                            aria-label="Remove entry"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                              />
                            </svg>
                          </button>
                        )}
                      </div>
                    }
                  />
                )}
                renderMobileCard={(entry) => (
                  <ScheduleRow
                    timeLabel={entry.desired_time ? entry.desired_time.slice(0, 5) : '—'}
                    title={entry.guest_name}
                    subtitle={
                      entry.notes
                        ? `${entrySubtitle(entry)}\n${entry.notes}`
                        : entrySubtitle(entry)
                    }
                    stripClassName={statusStripClass(entry.status)}
                    trailing={
                      <div className="flex flex-col items-end gap-1.5">
                        <Pill variant={statusPillVariant(entry.status)} size="sm">
                          {entry.status.charAt(0).toUpperCase() + entry.status.slice(1)}
                        </Pill>
                        <div className="flex flex-wrap justify-end gap-1">
                          {entry.status === 'waiting' && (
                            <button
                              type="button"
                              onClick={() => handleOffer(entry)}
                              className="min-h-10 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700"
                            >
                              Offer
                            </button>
                          )}
                          {entry.status === 'offered' && (
                            <button
                              type="button"
                              onClick={() => handleConfirm(entry)}
                              className="min-h-10 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
                            >
                              {entryKind(entry) === 'appointment' ? 'Book' : 'Confirm'}
                            </button>
                          )}
                          {(entry.status === 'waiting' || entry.status === 'offered') && (
                            <button
                              type="button"
                              onClick={() => handleCancel(entry)}
                              className="min-h-10 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                            >
                              Cancel
                            </button>
                          )}
                          {(entry.status === 'expired' || entry.status === 'cancelled') && (
                            <button
                              type="button"
                              onClick={() => handleDelete(entry.id)}
                              className="flex min-h-10 min-w-10 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                              aria-label="Remove entry"
                            >
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                                />
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>
                    }
                  />
                )}
              />
            )}
          </SectionCard.Body>
        </SectionCard>
      </div>
    </PageFrame>
  );
}
