'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ComplianceFormRenderer } from '@/components/dashboard/compliance/ComplianceFormRenderer';
import type { ComplianceFormSchema } from '@/lib/compliance/form-schema';
import {
  clearFormDraft,
  clearFormDraftsByPrefix,
  loadFormDraft,
  saveFormDraft,
} from '@/lib/compliance/form-draft';

/**
 * Inline compliance forms for the public booking flow (spec §9.3, Phase 2c). Fetches the
 * service's client-completable, `inline` requirements and renders each form so the guest
 * completes it before booking. Each form validates + reports its responses on submit
 * (ComplianceFormRenderer owns its own submit + validation); we collect them by type and
 * report up whether every MANDATORY (block_*) form is done so the parent can gate Confirm.
 */

interface InlineForm {
  compliance_type_id: string;
  compliance_type_name: string;
  enforcement: string;
  lock_period_hours: number | null;
  version_id: string;
  form_schema: ComplianceFormSchema;
}

export interface BookingComplianceState {
  /** Completed submissions to send with the booking-create request. */
  submissions: Array<{ compliance_type_id: string; responses: Record<string, unknown> }>;
  /** Draft id used for any pre-booking file uploads (also sent with the booking). */
  draftId: string;
  /** True when every mandatory (block_*) inline form has been completed. */
  mandatoryComplete: boolean;
  /** All type ids handled inline — so the pre-check notice can suppress them. */
  inlineTypeIds: string[];
}

const isMandatory = (enforcement: string) => enforcement === 'block_online' || enforcement === 'block_all';

/**
 * A UUID. Falls back to an RFC4122-v4 string where `crypto.randomUUID` is unavailable
 * (insecure origins / older browsers): the pre-booking upload endpoint and booking-create
 * both require UUID-format ids, so a non-UUID draft id would 400 file uploads (review #2).
 */
function makeDraftUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

interface Props {
  venueId: string;
  /** Catalog service id(s) for the booking (one per chosen service / multi-service segment). */
  serviceIds: string[];
  /** Disable the forms while the parent is submitting the booking. */
  submittingBooking?: boolean;
  onChange: (state: BookingComplianceState) => void;
  className?: string;
}

export default function BookingComplianceForms({ venueId, serviceIds, submittingBooking, onChange, className }: Props) {
  const [forms, setForms] = useState<InlineForm[] | null>(null);
  const [responsesByType, setResponsesByType] = useState<Record<string, Record<string, unknown>>>({});
  const [editingType, setEditingType] = useState<string | null>(null);
  // One stable draft id per booking session, used as the file-upload prefix. Persisted
  // (with the saved responses) so a reload mid-booking resumes instead of restarting.
  const [draftId, setDraftId] = useState('');
  const [restored, setRestored] = useState(false);

  const draftIdKey = `booking-draftid:${venueId}`;
  const responsesKey = `booking-responses:${venueId}`;

  // Restore any saved draft once on mount (effect, not a render-time initializer, so the
  // server and client first render agree). Creates + persists a stable id if none exists.
  useEffect(() => {
    const savedId = loadFormDraft(draftIdKey) as { id?: string } | null;
    const id = savedId?.id ?? makeDraftUuid();
    setDraftId(id);
    if (!savedId?.id) saveFormDraft(draftIdKey, { id });
    const savedResponses = loadFormDraft(responsesKey) as Record<string, Record<string, unknown>> | null;
    if (savedResponses && typeof savedResponses === 'object') setResponsesByType(savedResponses);
    setRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId]);

  // Persist completed inline responses so they survive a reload (after the restore above).
  useEffect(() => {
    if (!restored) return;
    saveFormDraft(responsesKey, responsesByType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [responsesByType, restored]);

  // Clear persisted responses once the booking is being submitted (a success navigates away;
  // a failed submit keeps the in-memory state so the guest can retry). The draft id is kept
  // stable on purpose (review #3): if a failed submit is followed by a reload, reusing the
  // same upload prefix keeps any already-uploaded files valid instead of orphaning them.
  const clearedRef = useRef(false);
  useEffect(() => {
    if (submittingBooking && !clearedRef.current) {
      clearedRef.current = true;
      clearFormDraftsByPrefix(`booking-inline:${venueId}:`);
      clearFormDraft(responsesKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submittingBooking, venueId]);

  const serviceKey = useMemo(() => [...new Set(serviceIds.filter(Boolean))].sort().join(','), [serviceIds]);
  const uniqueServiceIds = useMemo(() => serviceKey.split(',').filter(Boolean), [serviceKey]);

  // Fetch the inline forms for the chosen service(s); dedup by type (worst case a type
  // is required by two segments — one form satisfies both). Fail-quiet.
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    (async () => {
      if (!venueId || uniqueServiceIds.length === 0) {
        if (!cancelled) setForms(null);
        return;
      }
      try {
        const lists = await Promise.all(
          uniqueServiceIds.map(async (serviceId) => {
            const res = await fetch(
              `/api/public/compliance/inline-forms?venue_id=${encodeURIComponent(venueId)}&service_id=${encodeURIComponent(serviceId)}`,
              { signal: controller.signal },
            );
            if (!res.ok) return [] as InlineForm[];
            const data = (await res.json()) as { forms?: InlineForm[] };
            return data.forms ?? [];
          }),
        );
        if (cancelled) return;
        const byType = new Map<string, InlineForm>();
        for (const f of lists.flat()) if (!byType.has(f.compliance_type_id)) byType.set(f.compliance_type_id, f);
        setForms([...byType.values()]);
      } catch {
        if (!cancelled) setForms(null);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [venueId, serviceKey, uniqueServiceIds]);

  // Report collected state up whenever the forms or captured responses change.
  useEffect(() => {
    const formList = forms ?? [];
    // Only submit responses for forms required by the CURRENT service set. A persisted draft
    // from a previously-abandoned booking (different services, same venue/device) is kept for
    // resume but must not be captured against this booking (review #3).
    const currentTypeIds = new Set(formList.map((f) => f.compliance_type_id));
    const submissions = Object.entries(responsesByType)
      .filter(([compliance_type_id]) => currentTypeIds.has(compliance_type_id))
      .map(([compliance_type_id, responses]) => ({
        compliance_type_id,
        responses,
      }));
    const mandatoryComplete = formList
      .filter((f) => isMandatory(f.enforcement))
      .every((f) => responsesByType[f.compliance_type_id] !== undefined);
    onChange({ submissions, draftId, mandatoryComplete, inlineTypeIds: formList.map((f) => f.compliance_type_id) });
    // onChange is provided fresh each render by the parent; depending on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [responsesByType, forms, draftId]);

  if (!forms || forms.length === 0 || !draftId) return null;

  const fileUploadUrl = `/api/public/compliance/booking-upload?venue_id=${encodeURIComponent(venueId)}&draft_id=${encodeURIComponent(draftId)}`;

  return (
    <div className={`mb-4 space-y-4 rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 ${className ?? ''}`}>
      <div>
        <h4 className="text-sm font-semibold text-slate-900">Forms for this booking</h4>
        <p className="mt-0.5 text-xs text-slate-500">
          Please complete the form{forms.length > 1 ? 's' : ''} below. Anything marked required must be done before
          you can book.
        </p>
      </div>
      {forms.map((f) => {
        const done = responsesByType[f.compliance_type_id] !== undefined;
        const editing = editingType === f.compliance_type_id;
        const mandatory = isMandatory(f.enforcement);
        if (done && !editing) {
          return (
            <div
              key={f.compliance_type_id}
              className="flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3"
            >
              <span className="text-sm text-emerald-800">
                <span aria-hidden>✓ </span>
                <span className="font-medium">{f.compliance_type_name}</span> completed
              </span>
              <button
                type="button"
                disabled={Boolean(submittingBooking)}
                className="shrink-0 text-xs font-medium text-emerald-700 underline disabled:opacity-50"
                onClick={() => setEditingType(f.compliance_type_id)}
              >
                Edit
              </button>
            </div>
          );
        }
        return (
          <div key={f.compliance_type_id} className="rounded-lg border border-slate-200 bg-white p-3.5">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-900">{f.compliance_type_name}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  mandatory ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {mandatory ? 'Required' : 'Optional'}
              </span>
            </div>
            <ComplianceFormRenderer
              schema={f.form_schema}
              mode="public"
              fileUploadUrl={fileUploadUrl}
              submitLabel={done ? 'Save changes' : 'Save form'}
              submitting={Boolean(submittingBooking)}
              prefill={responsesByType[f.compliance_type_id]}
              draftKey={`booking-inline:${venueId}:${draftId}:${f.compliance_type_id}`}
              onSubmit={(responses) => {
                setResponsesByType((prev) => ({ ...prev, [f.compliance_type_id]: responses }));
                setEditingType(null);
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
