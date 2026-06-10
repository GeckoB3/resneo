'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, btnSecondary } from './linked-accounts-ui';

interface AuditEntry {
  id: string;
  createdAt: string;
  actionType: string;
  actionLabel: string;
  actingVenue: string;
  owningVenue: string;
  actingUser: string | null;
  resourceType: string | null;
  resourceId: string | null;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
}

const PAGE_SIZE = 50;

const ACTION_OPTIONS = [
  { value: '', label: 'All actions' },
  { value: 'viewed_calendar', label: 'Viewed calendar' },
  { value: 'viewed_booking', label: 'Viewed booking' },
  { value: 'created_booking', label: 'Created booking' },
  { value: 'edited_booking', label: 'Edited booking' },
  { value: 'cancelled_booking', label: 'Cancelled booking' },
  { value: 'deleted_booking', label: 'Deleted booking' },
];

const inputCls =
  'rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500';

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function diffSummary(entry: AuditEntry): string | null {
  if (!entry.beforeState || !entry.afterState) return null;
  const keys = ['booking_date', 'booking_time', 'status', 'practitioner_id', 'appointment_service_id'];
  const changes: string[] = [];
  for (const k of keys) {
    const before = entry.beforeState[k];
    const after = entry.afterState[k];
    if (before !== after) {
      changes.push(`${k.replace(/_/g, ' ')}: ${String(before ?? '—')} → ${String(after ?? '—')}`);
    }
  }
  return changes.length > 0 ? changes.join('; ') : null;
}

export function LinkedAccountAuditModal({
  linkId,
  otherVenueName,
  open,
  onClose,
}: {
  linkId: string;
  otherVenueName: string;
  open: boolean;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [actingUserId, setActingUserId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Monotonic request id: a slow response from OLD filters must not overwrite the
  // results (or surface an error) of a newer request the user has since made.
  const requestSeqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (action) qs.set('action', action);
      if (actingUserId) qs.set('actingUserId', actingUserId);
      if (fromDate) qs.set('from', fromDate);
      if (toDate) qs.set('to', toDate);
      const res = await fetch(`/api/venue/account-links/${linkId}/audit?${qs}`);
      const data = await res.json();
      if (seq !== requestSeqRef.current) return; // superseded by newer filters
      if (!res.ok) throw new Error(data.error ?? 'Failed to load audit log.');
      setEntries(data.entries ?? []);
      setUsers(data.users ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load audit log.');
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  }, [linkId, page, action, actingUserId, fromDate, toDate]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    if (open) setPage(1);
  }, [open, action, actingUserId, fromDate, toDate]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const exportCsv = () => {
    const qs = new URLSearchParams({ format: 'csv' });
    if (action) qs.set('action', action);
    if (actingUserId) qs.set('actingUserId', actingUserId);
    if (fromDate) qs.set('from', fromDate);
    if (toDate) qs.set('to', toDate);
    window.open(`/api/venue/account-links/${linkId}/audit?${qs}`, '_blank');
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Cross-venue audit log"
      description={`Every cross-venue action on the link with ${otherVenueName}. Visible to both venues and retained after the link ends.`}
      maxWidth="max-w-3xl"
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-slate-600">Action</span>
          <select className={inputCls} value={action} onChange={(e) => setAction(e.target.value)}>
            {ACTION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-slate-600">From</span>
          <input
            type="date"
            className={inputCls}
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-slate-600">To</span>
          <input
            type="date"
            className={inputCls}
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-slate-600">User</span>
          <select
            className={inputCls}
            value={actingUserId}
            onChange={(e) => setActingUserId(e.target.value)}
            disabled={users.length === 0}
          >
            <option value="">All users</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className={btnSecondary} onClick={exportCsv}>
          Export CSV
        </button>
      </div>

      {error ? (
        <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      ) : null}

      {/* Desktop: a table. Mobile: a stacked card list, so a data-dense log is
          never a horizontal-scroll trap inside the modal (§19.5). */}
      <div className="mt-3 hidden overflow-x-auto rounded-xl border border-slate-200 sm:block">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 font-semibold">When</th>
              <th className="px-3 py-2 font-semibold">Action</th>
              <th className="px-3 py-2 font-semibold">Acting venue</th>
              <th className="px-3 py-2 font-semibold">User</th>
              <th className="px-3 py-2 font-semibold">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <>
                {[0, 1, 2, 3].map((i) => (
                  <tr key={i}>
                    {[0, 1, 2, 3, 4].map((c) => (
                      <td key={c} className="px-3 py-2.5">
                        <div className="skeleton h-3 w-full rounded" />
                      </td>
                    ))}
                  </tr>
                ))}
              </>
            ) : entries.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                  No activity recorded for this link yet.
                </td>
              </tr>
            ) : (
              entries.map((e) => {
                const diff = diffSummary(e);
                return (
                  <tr key={e.id} className="align-top">
                    <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                      {formatTimestamp(e.createdAt)}
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-900">{e.actionLabel}</td>
                    <td className="px-3 py-2 text-slate-700">{e.actingVenue}</td>
                    <td className="px-3 py-2 text-slate-600">{e.actingUser ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {diff ?? (e.resourceType ? e.resourceType : '—')}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 space-y-2 sm:hidden">
        {loading ? (
          <>
            <div className="skeleton h-20 rounded-xl" />
            <div className="skeleton h-20 rounded-xl" />
          </>
        ) : entries.length === 0 ? (
          <p className="rounded-xl border border-slate-200 px-3 py-6 text-center text-xs text-slate-500">
            No activity recorded for this link yet.
          </p>
        ) : (
          entries.map((e) => {
            const diff = diffSummary(e);
            return (
              <div key={e.id} className="rounded-xl border border-slate-200 p-3 text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-slate-900">{e.actionLabel}</span>
                  <span className="shrink-0 text-[11px] text-slate-500">
                    {formatTimestamp(e.createdAt)}
                  </span>
                </div>
                <dl className="mt-1.5 space-y-0.5 text-slate-600">
                  <div className="flex gap-1.5">
                    <dt className="font-medium text-slate-500">By</dt>
                    <dd className="min-w-0">
                      {e.actingVenue}
                      {e.actingUser ? ` · ${e.actingUser}` : ''}
                    </dd>
                  </div>
                  {diff ?? e.resourceType ? (
                    <div className="flex gap-1.5">
                      <dt className="font-medium text-slate-500">Details</dt>
                      <dd className="min-w-0 break-words">{diff ?? e.resourceType}</dd>
                    </div>
                  ) : null}
                </dl>
              </div>
            );
          })
        )}
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-slate-600">
        <span>
          {total} {total === 1 ? 'entry' : 'entries'}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={btnSecondary}
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <span>
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            className={btnSecondary}
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </Modal>
  );
}
