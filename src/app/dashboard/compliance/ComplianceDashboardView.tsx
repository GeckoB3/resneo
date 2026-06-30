'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { Pill } from '@/components/ui/dashboard/Pill';
import {
  complianceJsonFetcher,
  formatComplianceDate,
  requirementStatePill,
} from '@/components/dashboard/compliance/shared';
import { ComplianceCaptureDialog } from '@/components/dashboard/compliance/ComplianceCaptureDialog';
import { groupTodaysCheckIns } from '@/lib/compliance/check-in';
import type { ComplianceRequirementState } from '@/lib/compliance/constants';

interface DashboardData {
  expiring_soon: Array<{
    id: string;
    guest_id: string;
    guest_name: string;
    compliance_type_id: string;
    compliance_type_name: string;
    expires_at: string;
    result: string | null;
  }>;
  missing_for_bookings: Array<{
    booking_id: string;
    guest_id: string | null;
    guest_name: string;
    booking_date: string;
    booking_time: string | null;
    compliance_type_id: string;
    compliance_type_name: string;
    enforcement: string;
    state: string;
  }>;
  awaiting_submission: Array<{
    id: string;
    guest_id: string;
    guest_name: string;
    compliance_type_name: string;
    sent_via: string | null;
    sent_at: string | null;
    expires_at: string;
  }>;
}

interface CaptureTarget {
  guestId: string;
  typeId: string;
  typeName: string;
  bookingId: string;
}

export function ComplianceDashboardView() {
  const { data, error, isLoading, mutate } = useSWR<DashboardData>(
    '/api/venue/compliance/dashboard',
    complianceJsonFetcher,
  );
  const [sendingKey, setSendingKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [capture, setCapture] = useState<CaptureTarget | null>(null);

  async function sendLink(guestId: string | null, typeId: string, bookingId?: string) {
    if (!guestId) return;
    const key = `${guestId}:${typeId}`;
    setSendingKey(key);
    setMessage(null);
    try {
      const res = await fetch('/api/venue/compliance/form-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guest_id: guestId, compliance_type_id: typeId, booking_id: bookingId ?? null, send_via: 'email' }),
      });
      const body = await res.json().catch(() => ({}));
      setMessage(res.ok ? (body.dispatched ? 'Form link sent.' : 'Form link created.') : body.error ?? 'Could not send link.');
      if (res.ok) void mutate();
    } finally {
      setSendingKey(null);
    }
  }

  if (isLoading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (error) {
    return (
      <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
        Couldn’t load the compliance dashboard. Please refresh to try again.
      </div>
    );
  }

  const expiring = data?.expiring_soon ?? [];
  const missing = data?.missing_for_bookings ?? [];
  const awaiting = data?.awaiting_submission ?? [];

  const todayStr = new Date().toISOString().slice(0, 10);
  const checkIns = groupTodaysCheckIns(missing, todayStr);
  // Today's bookings live in the dedicated check-in panel; keep the forward list to >today.
  const upcomingMissing = missing.filter((m) => m.booking_date !== todayStr);

  const allClear =
    checkIns.length === 0 && upcomingMissing.length === 0 && expiring.length === 0 && awaiting.length === 0;

  return (
    <div className="space-y-5">
      {message && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-sm text-slate-600">{message}</div>
      )}

      <SectionCard elevated>
        <SectionCard.Body>
          {allClear ? (
            <p className="text-sm text-slate-600">
              <span className="font-medium text-slate-800">You’re all caught up.</span> No outstanding forms,
              nothing expiring, and no client submissions to wait on right now.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-slate-600">
              <span>
                <span className="font-semibold text-slate-900">{checkIns.length}</span> for today
              </span>
              <span>
                <span className="font-semibold text-slate-900">{upcomingMissing.length}</span> upcoming
              </span>
              <span>
                <span className="font-semibold text-slate-900">{expiring.length}</span> expiring soon
              </span>
              <span>
                <span className="font-semibold text-slate-900">{awaiting.length}</span> awaiting clients
              </span>
            </div>
          )}
        </SectionCard.Body>
      </SectionCard>

      <SectionCard elevated>
        <SectionCard.Header
          eyebrow="Compliance"
          title="Today’s check-ins"
          description="Today’s bookings with a required form still outstanding. Complete it on a venue device or send a link."
        />
        <SectionCard.Body>
          {checkIns.length === 0 ? (
            <p className="text-sm text-slate-500">No outstanding forms for today’s bookings.</p>
          ) : (
            <ul className="space-y-3">
              {checkIns.map((g) => (
                <li key={g.booking_id} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="mb-2 flex items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-800">{g.guest_name}</p>
                    <p className="text-xs font-medium text-slate-500">
                      {g.booking_time ? g.booking_time.slice(0, 5) : 'No time set'}
                    </p>
                  </div>
                  <ul className="space-y-1.5">
                    {g.items.map((item) => {
                      const pill = requirementStatePill(item.state as ComplianceRequirementState);
                      const sending = sendingKey === `${g.guest_id}:${item.compliance_type_id}`;
                      return (
                        <li
                          key={item.compliance_type_id}
                          className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-1.5 first:border-0 first:pt-0"
                        >
                          <div className="flex items-center gap-2">
                            <Pill variant={pill.variant} size="sm" dot>{pill.label}</Pill>
                            <span className="text-sm text-slate-700">{item.compliance_type_name}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              disabled={!g.guest_id}
                              onClick={() =>
                                g.guest_id &&
                                setCapture({
                                  guestId: g.guest_id,
                                  typeId: item.compliance_type_id,
                                  typeName: item.compliance_type_name,
                                  bookingId: g.booking_id,
                                })
                              }
                              className="inline-flex min-h-9 items-center rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:opacity-50"
                            >
                              Complete now
                            </button>
                            <button
                              type="button"
                              disabled={!g.guest_id || sending}
                              onClick={() => sendLink(g.guest_id, item.compliance_type_id, g.booking_id)}
                              className="inline-flex min-h-9 items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:opacity-50"
                            >
                              Send link
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </SectionCard.Body>
      </SectionCard>

      <SectionCard elevated>
        <SectionCard.Header
          eyebrow="Compliance"
          title="Missing for upcoming bookings"
          description="Bookings in the next 14 days whose service needs a record that isn’t on file."
        />
        <SectionCard.Body>
          {upcomingMissing.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing missing for upcoming bookings.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {upcomingMissing.map((m) => {
                const pill = requirementStatePill(m.state as ComplianceRequirementState);
                const key = `${m.guest_id}:${m.compliance_type_id}:${m.booking_id}`;
                return (
                  <li key={key} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800">
                        {m.guest_name} · {m.compliance_type_name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {formatComplianceDate(m.booking_date)}
                        {m.booking_time ? ` at ${m.booking_time.slice(0, 5)}` : ''} ·{' '}
                        <span className="capitalize">{m.enforcement.replace(/_/g, ' ')}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Pill variant={pill.variant} size="sm" dot>{pill.label}</Pill>
                      <button
                        type="button"
                        disabled={!m.guest_id || sendingKey === `${m.guest_id}:${m.compliance_type_id}`}
                        onClick={() => sendLink(m.guest_id, m.compliance_type_id, m.booking_id)}
                        className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        Send link
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard.Body>
      </SectionCard>

      <SectionCard elevated>
        <SectionCard.Header
          eyebrow="Compliance"
          title="Expiring soon"
          description="Records on file that expire within 30 days."
        />
        <SectionCard.Body>
          {expiring.length === 0 ? (
            <p className="text-sm text-slate-500">No records expiring soon.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {expiring.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800">
                      {r.guest_name} · {r.compliance_type_name}
                    </p>
                    <p className="text-xs text-slate-500">Expires {formatComplianceDate(r.expires_at)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Pill variant="compliance-expiring" size="sm" dot>Expiring</Pill>
                    <button
                      type="button"
                      disabled={sendingKey === `${r.guest_id}:${r.compliance_type_id}`}
                      onClick={() => sendLink(r.guest_id, r.compliance_type_id)}
                      className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Send renewal
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard.Body>
      </SectionCard>

      <SectionCard elevated>
        <SectionCard.Header
          eyebrow="Compliance"
          title="Awaiting client submission"
          description="Form links sent that haven’t been completed yet."
        />
        <SectionCard.Body>
          {awaiting.length === 0 ? (
            <p className="text-sm text-slate-500">No outstanding form links.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {awaiting.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800">
                      {a.guest_name} · {a.compliance_type_name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {a.sent_at ? `Sent ${formatComplianceDate(a.sent_at)}` : 'Not yet sent'} · expires{' '}
                      {formatComplianceDate(a.expires_at)}
                    </p>
                  </div>
                  <Pill variant="compliance-pending" size="sm" dot>Pending</Pill>
                </li>
              ))}
            </ul>
          )}
        </SectionCard.Body>
      </SectionCard>

      <p className="text-center text-xs text-slate-400">
        Set up types and requirements in{' '}
        <Link href="/dashboard/settings?tab=compliance" className="text-brand-600 underline">
          Settings → Compliance
        </Link>
        .
      </p>

      {capture && (
        <ComplianceCaptureDialog
          open
          onOpenChange={(open) => {
            if (!open) setCapture(null);
          }}
          guestId={capture.guestId}
          complianceTypeId={capture.typeId}
          complianceTypeName={capture.typeName}
          bookingId={capture.bookingId}
          initialChannel="client_walkin"
          onCaptured={() => {
            setMessage('Record captured.');
            void mutate();
          }}
        />
      )}
    </div>
  );
}
