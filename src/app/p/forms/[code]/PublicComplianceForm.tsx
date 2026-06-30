'use client';

import { useState } from 'react';
import { ComplianceFormRenderer } from '@/components/dashboard/compliance/ComplianceFormRenderer';
import type { ComplianceFormSchema } from '@/lib/compliance/form-schema';

export function PublicComplianceForm({
  code,
  schema,
  prefill,
  typeName,
  venueName,
}: {
  code: string;
  schema: ComplianceFormSchema;
  prefill: Record<string, unknown>;
  typeName: string;
  venueName: string;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [serverFieldErrors, setServerFieldErrors] = useState<Record<string, string> | undefined>(undefined);

  async function handleSubmit(responses: Record<string, unknown>) {
    setSubmitting(true);
    setFormError(null);
    setServerFieldErrors(undefined);
    try {
      const res = await fetch(`/api/public/compliance/forms/${encodeURIComponent(code)}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responses }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        // If the link was already completed (e.g. a double-submit race), show the same
        // reassuring "thank you" state rather than a scary error, and let the draft clear.
        if (json.reason === 'consumed' || json.reason === 'already_consumed') {
          setDone(true);
          return;
        }
        if (json.field_errors && typeof json.field_errors === 'object') {
          setServerFieldErrors(json.field_errors as Record<string, string>);
        }
        setFormError(json.error ?? 'We could not submit your form. Please try again.');
        // Throw so the renderer keeps the saved draft for a retry (it only clears on success).
        throw new Error('submit failed');
      }
      setDone(true);
    } catch (err) {
      if (err instanceof Error && err.message === 'submit failed') throw err;
      setFormError('Something went wrong. Please check your connection and try again.');
      throw err;
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
        <h2 className="text-lg font-semibold text-emerald-900">Thank you</h2>
        <p className="mt-2 text-sm text-emerald-800">
          Your {typeName} has been submitted to {venueName}. You can close this page.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {formError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{formError}</div>
      )}
      <ComplianceFormRenderer
        schema={schema}
        mode="public"
        prefill={prefill}
        submitting={submitting}
        submitLabel="Submit form"
        onSubmit={handleSubmit}
        fileUploadUrl={`/api/public/compliance/forms/${encodeURIComponent(code)}/file`}
        draftKey={`public:${code}`}
        serverErrors={serverFieldErrors}
      />
    </div>
  );
}
