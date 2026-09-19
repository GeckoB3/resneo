'use client';

import { useEffect, useMemo, useState } from 'react';
import { normaliseBroadcastContent, renderBroadcastEmail } from '@/lib/platform/broadcast-email';
import { EmailPreview } from './EmailPreview';
import {
  STATUS_LABEL,
  STATUS_PILL,
  apiJson,
  formatDateTime,
  publicBaseUrl,
  type BroadcastRecipientRow,
  type BroadcastSummary,
} from './contact-users-shared';

interface Props {
  broadcasts: BroadcastSummary[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onEdit: (b: BroadcastSummary) => void;
  onDuplicate: (b: BroadcastSummary) => void;
  onDelete: (b: BroadcastSummary) => Promise<void>;
  onResume: (b: BroadcastSummary) => Promise<void>;
  resumingId: string | null;
  refreshKey: number;
}

type RecipientFilter = 'all' | BroadcastRecipientRow['status'];

const RECIPIENT_STATUS: Record<BroadcastRecipientRow['status'], { label: string; cls: string }> = {
  sent: { label: 'Sent', cls: 'bg-emerald-50 text-emerald-700' },
  failed: { label: 'Failed', cls: 'bg-rose-50 text-rose-700' },
  pending: { label: 'Not sent yet', cls: 'bg-sky-50 text-sky-700' },
  skipped_opted_out: { label: 'Unsubscribed', cls: 'bg-slate-100 text-slate-500' },
};

function audienceLabel(b: BroadcastSummary): string {
  const a = (b.audience ?? {}) as { mode?: string; venue_ids?: unknown[] };
  if (a.mode === 'selected') {
    const n = Array.isArray(a.venue_ids) ? a.venue_ids.length : 0;
    return `${n} chosen ${n === 1 ? 'venue' : 'venues'}`;
  }
  return 'All current subscribers';
}

export function HistoryView(props: Props) {
  const { broadcasts, selectedId } = props;
  const selected = broadcasts.find((b) => b.id === selectedId) ?? null;

  if (selected) {
    return (
      <BroadcastDetail
        key={`${selected.id}-${props.refreshKey}`}
        broadcast={selected}
        onBack={() => props.onSelect(null)}
        onEdit={props.onEdit}
        onDuplicate={props.onDuplicate}
        onDelete={props.onDelete}
        onResume={props.onResume}
        resuming={props.resumingId === selected.id}
      />
    );
  }

  const drafts = broadcasts.filter((b) => b.status === 'draft');
  const sent = broadcasts.filter((b) => b.status !== 'draft');

  return (
    <div className="space-y-8">
      {props.error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{props.error}</p>
      ) : null}

      <ListSection title="Drafts" empty="No drafts. Anything you start writing is saved here automatically.">
        {props.loading && broadcasts.length === 0
          ? <SkeletonRows />
          : drafts.map((b) => <BroadcastRow key={b.id} b={b} onOpen={() => props.onEdit(b)} actionLabel="Continue editing" />)}
      </ListSection>

      <ListSection title="Sent" empty="Nothing sent yet.">
        {props.loading && broadcasts.length === 0
          ? <SkeletonRows />
          : sent.map((b) => <BroadcastRow key={b.id} b={b} onOpen={() => props.onSelect(b.id)} actionLabel="Delivery report" />)}
      </ListSection>
    </div>
  );
}

function ListSection({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</h2>
      {hasChildren ? (
        <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {children}
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-8 text-center text-sm text-slate-400">
          {empty}
        </p>
      )}
    </section>
  );
}

function SkeletonRows() {
  return (
    <>
      {[0, 1].map((i) => (
        <div key={i} className="h-[68px] animate-pulse bg-slate-50" />
      ))}
    </>
  );
}

function BroadcastRow({ b, onOpen, actionLabel }: { b: BroadcastSummary; onOpen: () => void; actionLabel: string }) {
  const content = normaliseBroadcastContent(b.content);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5 text-left hover:bg-slate-50"
    >
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_PILL[b.status]}`}>
            {STATUS_LABEL[b.status]}
          </span>
          {b.important ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
              Important notice
            </span>
          ) : null}
          <span className="truncate text-sm font-semibold text-slate-900">{b.subject || content.headline || 'Untitled email'}</span>
        </span>
        <span className="mt-0.5 block text-xs text-slate-500">
          {b.status === 'draft'
            ? `Edited ${formatDateTime(b.updated_at)} · ${audienceLabel(b)}`
            : `${formatDateTime(b.sent_at ?? b.send_started_at)}${b.sent_by_email ? ` by ${b.sent_by_email}` : ''} · ${b.sent_count} sent${b.failed_count ? `, ${b.failed_count} failed` : ''}${b.skipped_count ? `, ${b.skipped_count} unsubscribed` : ''}`}
        </span>
      </span>
      <span className="text-xs font-semibold text-blue-600">{actionLabel} &rarr;</span>
    </button>
  );
}

function BroadcastDetail({
  broadcast,
  onBack,
  onEdit,
  onDuplicate,
  onDelete,
  onResume,
  resuming,
}: {
  broadcast: BroadcastSummary;
  onBack: () => void;
  onEdit: (b: BroadcastSummary) => void;
  onDuplicate: (b: BroadcastSummary) => void;
  onDelete: (b: BroadcastSummary) => Promise<void>;
  onResume: (b: BroadcastSummary) => Promise<void>;
  resuming: boolean;
}) {
  const [recipients, setRecipients] = useState<BroadcastRecipientRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<RecipientFilter>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    apiJson<{ recipients: BroadcastRecipientRow[] }>(`/api/platform/contact-users/broadcasts/${broadcast.id}`)
      .then((data) => {
        if (cancelled) return;
        setRecipients(data.recipients);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load recipients.');
      });
    return () => {
      cancelled = true;
    };
  }, [broadcast.id]);

  const counts = useMemo(() => {
    const c = { sent: 0, failed: 0, pending: 0, skipped_opted_out: 0 };
    for (const r of recipients ?? []) c[r.status] += 1;
    return c;
  }, [recipients]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (recipients ?? []).filter(
      (r) =>
        (filter === 'all' || r.status === filter) &&
        (!q || r.email.includes(q) || (r.venue_names ?? []).some((n) => n.toLowerCase().includes(q))),
    );
  }, [recipients, filter, search]);

  const content = useMemo(() => normaliseBroadcastContent(broadcast.content), [broadcast.content]);
  const sample = recipients?.find((r) => r.status === 'sent') ?? recipients?.[0];
  const sampleFirstName = sample?.first_name ?? null;
  const sampleVenues = sample?.venue_names;
  const rendered = useMemo(
    () =>
      renderBroadcastEmail({
        baseUrl: publicBaseUrl(),
        subject: broadcast.subject,
        content,
        recipient: { firstName: sampleFirstName, venueNames: sampleVenues ?? [] },
        important: broadcast.important,
        unsubscribeUrl: broadcast.important ? null : `${publicBaseUrl()}/updates/unsubscribe?test=1`,
      }),
    [broadcast.subject, broadcast.important, content, sampleFirstName, sampleVenues],
  );

  // When this report was opened; it remounts (key) after every resume or reload.
  const [openedAt] = useState(() => Date.now());
  const staleSending =
    broadcast.status === 'sending' &&
    openedAt - Date.parse(broadcast.send_started_at ?? broadcast.updated_at) > 5 * 60 * 1000;
  const canResume =
    broadcast.status === 'partially_sent' || broadcast.status === 'failed' || staleSending;

  return (
    <div className="space-y-6">
      <button type="button" onClick={onBack} className="text-sm font-semibold text-slate-500 hover:text-slate-800">
        &larr; All emails
      </button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_PILL[broadcast.status]}`}>
              {STATUS_LABEL[broadcast.status]}
            </span>
            {broadcast.important ? (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                Important notice
              </span>
            ) : null}
          </div>
          <h2 className="mt-2 text-xl font-bold text-slate-900">{broadcast.subject}</h2>
          <p className="mt-1 text-sm text-slate-500">
            {broadcast.sent_at || broadcast.send_started_at
              ? `Sent ${formatDateTime(broadcast.sent_at ?? broadcast.send_started_at)}`
              : ''}
            {broadcast.sent_by_email ? ` by ${broadcast.sent_by_email}` : ''} · {audienceLabel(broadcast)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {broadcast.status === 'draft' ? (
            <>
              <button
                type="button"
                onClick={() => onEdit(broadcast)}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Continue editing
              </button>
              <button
                type="button"
                onClick={() => void onDelete(broadcast)}
                className="rounded-xl border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50"
              >
                Delete draft
              </button>
            </>
          ) : null}
          {canResume ? (
            <button
              type="button"
              onClick={() => void onResume(broadcast)}
              disabled={resuming}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {resuming
                ? 'Sending...'
                : counts.pending > 0
                  ? `Finish sending (${counts.pending + counts.failed})`
                  : `Retry ${counts.failed} failed`}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onDuplicate(broadcast)}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Use as a new draft
          </button>
        </div>
      </div>

      {broadcast.status === 'sending' && !staleSending ? (
        <p className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
          This email is sending now. The numbers below update when you reopen it.
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Sent" value={counts.sent} tone="text-emerald-700" />
        <Stat label="Failed" value={counts.failed} tone={counts.failed ? 'text-rose-700' : 'text-slate-900'} />
        <Stat label="Unsubscribed" value={counts.skipped_opted_out} tone="text-slate-900" />
        <Stat label="Not sent yet" value={counts.pending} tone={counts.pending ? 'text-sky-700' : 'text-slate-900'} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search email or venue"
              className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:border-blue-400 focus:outline-none"
            />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as RecipientFilter)}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700"
            >
              <option value="all">Everyone</option>
              <option value="sent">Sent</option>
              <option value="failed">Failed</option>
              <option value="skipped_opted_out">Unsubscribed</option>
              <option value="pending">Not sent yet</option>
            </select>
          </div>
          {error ? <p className="px-4 py-3 text-sm text-rose-700">{error}</p> : null}
          <ul className="max-h-[560px] divide-y divide-slate-100 overflow-y-auto">
            {recipients === null ? (
              <li className="px-4 py-6 text-center text-sm text-slate-400">Loading...</li>
            ) : shown.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-slate-400">
                {recipients.length === 0 ? 'No recipients recorded.' : 'Nobody matches.'}
              </li>
            ) : (
              shown.map((r) => (
                <li key={r.id} className="px-4 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-slate-900">{r.email}</span>
                      <span className="block truncate text-xs text-slate-500">
                        {[r.first_name, (r.venue_names ?? []).join(', ')].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${RECIPIENT_STATUS[r.status].cls}`}
                    >
                      {RECIPIENT_STATUS[r.status].label}
                    </span>
                  </div>
                  {r.error ? <p className="mt-1 text-xs text-rose-600">{r.error}</p> : null}
                </li>
              ))
            )}
          </ul>
        </section>

        <div className="min-w-0">
          <EmailPreview
            html={rendered.html}
            subject={rendered.subject}
            preheader={rendered.preheader}
            className="xl:max-h-[720px] xl:overflow-y-auto"
          />
          <p className="mt-2 text-xs text-slate-400">
            {content.headline ? 'Shown as the first recipient saw it.' : ''}
          </p>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}
