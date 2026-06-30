'use client';

import useSWR from 'swr';
import { Dialog } from '@/components/ui/primitives/Dialog';
import { ComplianceFormRenderer } from '@/components/dashboard/compliance/ComplianceFormRenderer';
import { complianceJsonFetcher } from '@/components/dashboard/compliance/shared';
import type { ComplianceFormSchema } from '@/lib/compliance/form-schema';
import { useEffect, useState } from 'react';

type CaptureChannel = 'staff_web' | 'client_walkin';

/**
 * Staff "Capture now" / in-venue self-service modal (spec §3.1, improvement plan
 * Phase 3). Loads the type's current version schema and renders the shared
 * ComplianceFormRenderer. The "Captured by" choice drives both how the form is
 * rendered and how the record is attributed:
 *   - staff_web     → staff transcribe (full schema incl. staff-only fields)
 *   - client_walkin → client self-completes on a venue device (public schema,
 *                     staff-only fields hidden, attributed to the client)
 */
export function ComplianceCaptureDialog({
  open,
  onOpenChange,
  guestId,
  complianceTypeId,
  complianceTypeName,
  bookingId,
  onCaptured,
  initialChannel = 'staff_web',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  guestId: string;
  complianceTypeId: string;
  complianceTypeName: string;
  bookingId?: string | null;
  onCaptured: () => void;
  /** Default capture channel — pass 'client_walkin' to open straight into tablet self-service. */
  initialChannel?: CaptureChannel;
}) {
  const { data, isLoading } = useSWR<{ version: { form_schema: ComplianceFormSchema } | null }>(
    open ? `/api/venue/compliance/types/${complianceTypeId}` : null,
    complianceJsonFetcher,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string> | undefined>(undefined);
  const [channel, setChannel] = useState<CaptureChannel>(initialChannel);

  // Re-sync the channel whenever the dialog is (re)opened for a new target.
  useEffect(() => {
    if (open) setChannel(initialChannel);
  }, [open, initialChannel, complianceTypeId]);

  const schema = data?.version?.form_schema ?? null;
  const selfComplete = channel === 'client_walkin';

  async function handleSubmit(responses: Record<string, unknown>) {
    setSubmitting(true);
    setError(null);
    setFieldErrors(undefined);
    try {
      const res = await fetch('/api/venue/compliance/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guest_id: guestId,
          compliance_type_id: complianceTypeId,
          booking_id: bookingId ?? null,
          capture_channel: channel,
          responses,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body.field_errors && typeof body.field_errors === 'object') {
          setFieldErrors(body.field_errors as Record<string, string>);
        }
        setError(body.error ?? 'Could not save the record.');
        return;
      }
      onCaptured();
      onOpenChange(false);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`${complianceTypeName}`}
      description={
        selfComplete
          ? 'Hand the device to the client to complete and sign.'
          : 'Complete this record on behalf of, or with, the client.'
      }
      size="lg"
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-sm text-rose-700">{error}</div>
        )}
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Captured by</label>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value as CaptureChannel)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          >
            <option value="staff_web">Staff entering these details</option>
            <option value="client_walkin">Client completing on this device</option>
          </select>
        </div>

        {selfComplete && schema && (
          <div className="flex items-start gap-2 rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm text-brand-900">
            <span aria-hidden className="mt-0.5">📱</span>
            <p>
              <span className="font-semibold">Hand this device to the client.</span> They’ll read and complete{' '}
              {complianceTypeName} themselves; staff-only sections are hidden and their answers save straight to their
              record.
            </p>
          </div>
        )}

        {isLoading && <p className="text-sm text-slate-500">Loading form…</p>}
        {!isLoading && !schema && (
          <p className="text-sm text-rose-600">This type has no form to capture.</p>
        )}
        {schema && (
          <ComplianceFormRenderer
            // Re-mount when the mode flips so default values / staff-only fields reset cleanly.
            key={selfComplete ? 'public' : 'staff'}
            schema={schema}
            mode={selfComplete ? 'public' : 'staff'}
            submitting={submitting}
            submitLabel={selfComplete ? 'Submit & save' : 'Save record'}
            onSubmit={handleSubmit}
            serverErrors={fieldErrors}
            // audit H3: enable in-venue file capture. The staff session is authenticated, so the
            // venue upload route works in both staff and hand-to-client (tablet) modes.
            fileUploadUrl="/api/venue/compliance/records/upload"
          />
        )}
      </div>
    </Dialog>
  );
}
