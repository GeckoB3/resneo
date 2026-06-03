'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { Pill } from '@/components/ui/dashboard/Pill';
import { ComplianceCaptureDialog } from '@/components/dashboard/compliance/ComplianceCaptureDialog';
import { ComplianceRecordViewDialog } from '@/components/dashboard/compliance/ComplianceRecordViewDialog';
import { notifyComplianceChanged } from '@/components/dashboard/compliance/ComplianceBookingIndicator';
import {
  auditEventLabel,
  complianceJsonFetcher,
  formatComplianceDate,
  joinedTypeName,
  recordStatusPill,
  requirementStatePill,
  type AuditEventRow,
  type ComplianceRecordRow,
  type FormLinkRow,
  type ResolvedRequirementData,
} from '@/components/dashboard/compliance/shared';

interface GuestComplianceData {
  records: ComplianceRecordRow[];
  form_links: FormLinkRow[];
  audit_events: AuditEventRow[];
}
interface BookingComplianceData {
  applicable: boolean;
  requirements: ResolvedRequirementData[];
  records: ComplianceRecordRow[];
}

/**
 * Shared compliance surface (spec §11.2) used in the booking detail accordion and
 * the contact panel. Requirements panel only renders with a booking + Model B
 * service; the records list + audit trail always render for the guest.
 */
export function ComplianceSection({
  guestId,
  bookingId,
  complianceEnabled,
  onRecordCount,
}: {
  guestId: string;
  bookingId?: string | null;
  appointmentServiceId?: string | null;
  serviceItemId?: string | null;
  complianceEnabled: boolean;
  /** Reports the guest's record count once loaded (e.g. for a parent accordion summary). */
  onRecordCount?: (count: number | null) => void;
}) {
  const {
    data: guestData,
    error: guestError,
    mutate: mutateGuest,
  } = useSWR<GuestComplianceData>(
    complianceEnabled && guestId ? `/api/venue/guests/${guestId}/compliance` : null,
    complianceJsonFetcher,
  );
  const { data: bookingData, error: bookingError, mutate: mutateBooking } = useSWR<BookingComplianceData>(
    complianceEnabled && bookingId ? `/api/venue/bookings/${bookingId}/compliance` : null,
    complianceJsonFetcher,
  );
  const loadError = Boolean(guestError || bookingError);

  const recordCount = guestData ? guestData.records.length : null;
  useEffect(() => {
    onRecordCount?.(recordCount);
  }, [recordCount, onRecordCount]);

  const [capture, setCapture] = useState<{
    typeId: string;
    typeName: string;
    channel: 'staff_web' | 'client_walkin';
  } | null>(null);
  const [viewRecordId, setViewRecordId] = useState<string | null>(null);
  const [sendingTypeId, setSendingTypeId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  if (!complianceEnabled) return null;

  const records = guestData?.records ?? [];
  const requirements = bookingData?.applicable ? bookingData.requirements : [];

  function refresh() {
    void mutateGuest();
    void mutateBooking();
    // Let live booking-bar / list indicators re-resolve immediately after a capture/void.
    notifyComplianceChanged();
  }

  async function sendLink(typeId: string) {
    setSendingTypeId(typeId);
    setActionMessage(null);
    try {
      const res = await fetch('/api/venue/compliance/form-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guest_id: guestId,
          compliance_type_id: typeId,
          booking_id: bookingId ?? null,
          send_via: 'email',
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionMessage(body.error ?? 'Could not send the form link.');
        return;
      }
      setActionMessage(
        body.dispatched ? 'Form link sent.' : 'Form link created. Copy it to share manually.',
      );
      refresh();
    } finally {
      setSendingTypeId(null);
    }
  }

  return (
    <div className="space-y-5">
      {loadError && (
        <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-sm text-rose-700">
          Couldn’t load compliance details. Please refresh to try again.
        </div>
      )}
      {actionMessage && (
        <div role="status" className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-sm text-slate-600">
          {actionMessage}
        </div>
      )}

      {requirements.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Requirements for this booking
          </h4>
          <ul className="space-y-2">
            {requirements.map((r) => {
              const pill = requirementStatePill(r.state);
              const needsAction = r.state === 'missing' || r.state === 'expired';
              return (
                <li
                  key={r.requirement.id}
                  className="rounded-lg border border-slate-200 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-800">
                        {r.requirement.compliance_type_name}
                      </span>
                      <Pill variant={pill.variant} size="sm" dot>
                        {pill.label}
                      </Pill>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setCapture({
                            typeId: r.requirement.compliance_type_id,
                            typeName: r.requirement.compliance_type_name,
                            channel: 'client_walkin',
                          })
                        }
                        className="rounded-md bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-700"
                      >
                        Hand to client
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setCapture({
                            typeId: r.requirement.compliance_type_id,
                            typeName: r.requirement.compliance_type_name,
                            channel: 'staff_web',
                          })
                        }
                        className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Capture now
                      </button>
                      <button
                        type="button"
                        disabled={sendingTypeId === r.requirement.compliance_type_id}
                        onClick={() => sendLink(r.requirement.compliance_type_id)}
                        className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        Send link
                      </button>
                      {r.matching_record && (
                        <button
                          type="button"
                          onClick={() => setViewRecordId(r.matching_record!.id)}
                          className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          View record
                        </button>
                      )}
                    </div>
                  </div>
                  {r.lock_blocked && needsAction && (
                    <p className="mt-1.5 text-xs text-amber-600">
                      A record exists but was captured too close to the booking to count.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          All compliance records
        </h4>
        {records.length === 0 ? (
          <p className="text-sm text-slate-500">No compliance records on file for this guest yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {records.map((rec) => {
              const pill = recordStatusPill(rec);
              return (
                <li key={rec.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {joinedTypeName(rec.compliance_types)}
                    </p>
                    <p className="text-xs text-slate-500">
                      Captured {formatComplianceDate(rec.captured_at)}
                      {rec.expires_at
                        ? ` · ${new Date(rec.expires_at).getTime() <= Date.now() ? 'Expired' : 'Expires'} ${formatComplianceDate(rec.expires_at)}`
                        : ''}
                      {rec.result ? ` · ${rec.result}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Pill variant={pill.variant} size="sm" dot>
                      {pill.label}
                    </Pill>
                    <button
                      type="button"
                      onClick={() => setViewRecordId(rec.id)}
                      className="text-xs font-medium text-brand-600 hover:text-brand-700"
                    >
                      View
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <ComplianceAuditTrail events={guestData?.audit_events ?? []} />

      {capture && (
        <ComplianceCaptureDialog
          open={Boolean(capture)}
          onOpenChange={(o) => !o && setCapture(null)}
          guestId={guestId}
          complianceTypeId={capture.typeId}
          complianceTypeName={capture.typeName}
          bookingId={bookingId}
          initialChannel={capture.channel}
          onCaptured={refresh}
        />
      )}
      <ComplianceRecordViewDialog
        open={Boolean(viewRecordId)}
        onOpenChange={(o) => !o && setViewRecordId(null)}
        recordId={viewRecordId}
        onChanged={refresh}
      />
    </div>
  );
}

function ComplianceAuditTrail({ events }: { events: AuditEventRow[] }) {
  if (events.length === 0) return null;
  return (
    <details className="rounded-lg border border-slate-200">
      <summary className="cursor-pointer px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Audit trail ({events.length})
      </summary>
      <ul className="divide-y divide-slate-100 border-t border-slate-100">
        {events.map((e) => (
          <li key={e.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
            <span className="text-slate-700">{auditEventLabel(e.event_type)}</span>
            <span className="text-slate-400">
              {e.actor_type} · {formatComplianceDate(e.created_at)}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
