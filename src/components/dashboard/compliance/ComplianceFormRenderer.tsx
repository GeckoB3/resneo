'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import {
  buildResponseSchema,
  type ComplianceFormSchema,
  type FileResponse,
  type SignatureResponse,
} from '@/lib/compliance/form-schema';
import { clearFormDraft, loadFormDraft, saveFormDraft } from '@/lib/compliance/form-draft';
import { SignaturePad } from '@/components/dashboard/compliance/SignaturePad';

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-slate-50';

function renderIntroMarkdown(md: string): string {
  return sanitizeHtml(marked.parse(md) as string, {
    allowedTags: ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'a', 'h3', 'h4'],
    allowedAttributes: { a: ['href', 'target', 'rel'] },
  });
}

export interface ComplianceFormRendererProps {
  schema: ComplianceFormSchema;
  mode: 'staff' | 'public';
  onSubmit?: (responses: Record<string, unknown>) => Promise<void> | void;
  /** Field-id → prefilled value (e.g. guest details on the public form). */
  prefill?: Record<string, unknown>;
  submitting?: boolean;
  submitLabel?: string;
  /** Pure preview (form builder §7.6) — inputs disabled, no submit. */
  preview?: boolean;
  /** Endpoint for `file` field uploads (public submissions). */
  fileUploadUrl?: string;
  /**
   * When set, in-progress input is autosaved to localStorage under this key and
   * restored on mount, so a reload resumes (improvement plan §10, U10). The draft is
   * cleared on a successful submit. Omit for staff/preview contexts (shared devices).
   */
  draftKey?: string;
}

export function ComplianceFormRenderer({
  schema,
  mode,
  onSubmit,
  prefill,
  submitting,
  submitLabel = 'Submit',
  preview = false,
  fileUploadUrl,
  draftKey,
}: ComplianceFormRendererProps) {
  const fields = useMemo(
    () => schema.fields.filter((f) => mode === 'staff' || !f.staff_only),
    [schema.fields, mode],
  );

  const resolver = useMemo(
    // The response schema is built dynamically per form; its erased input type
    // doesn't statically satisfy RHF's FieldValues, but it validates at runtime.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => zodResolver(buildResponseSchema(schema, mode) as any),
    [schema, mode],
  );

  const defaultValues = useMemo(() => {
    const dv: Record<string, unknown> = {};
    for (const f of fields) {
      if (prefill && prefill[f.id] !== undefined) {
        dv[f.id] = prefill[f.id];
        continue;
      }
      if (f.type === 'date' && f.default_value) {
        dv[f.id] = f.default_value === 'today' ? new Date().toISOString().slice(0, 10) : f.default_value;
      } else if ((f.type === 'text' || f.type === 'textarea' || f.type === 'select') && f.default_value) {
        dv[f.id] = f.default_value;
      } else if (f.type === 'multiselect' && f.default_value) {
        dv[f.id] = f.default_value;
      }
    }
    return dv;
  }, [fields, prefill]);

  const {
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<Record<string, unknown>>({ resolver, defaultValues, mode: 'onSubmit' });

  // Restore a saved draft once per key (after mount, so server and client first render
  // match). Merges over the computed defaults so newly-added fields keep their defaults.
  const restoredKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (preview || !draftKey || restoredKeyRef.current === draftKey) return;
    restoredKeyRef.current = draftKey;
    const draft = loadFormDraft(draftKey);
    if (draft) reset({ ...defaultValues, ...draft });
  }, [draftKey, preview, defaultValues, reset]);

  // Autosave on change (debounced) so a reload mid-form resumes.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (preview || !draftKey) return;
    const sub = watch((values) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => saveFormDraft(draftKey, values as Record<string, unknown>), 300);
    });
    return () => {
      sub.unsubscribe();
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [draftKey, preview, watch]);

  const disabled = preview || submitting;
  const introHtml = schema.intro_markdown ? renderIntroMarkdown(schema.intro_markdown) : null;

  const submit = onSubmit
    ? handleSubmit(async (values) => {
        try {
          await onSubmit(values);
          // Only a clean submit clears the draft; a throw (e.g. a failed network call
          // the parent re-raised) keeps it so the guest can retry without re-entering.
          if (draftKey) clearFormDraft(draftKey);
        } catch {
          // Parent surfaced the error; leave the draft in place.
        }
      })
    : (e: React.FormEvent) => e.preventDefault();

  return (
    <form onSubmit={submit} className="space-y-5">
      {schema.description && <p className="text-sm text-slate-600">{schema.description}</p>}
      {introHtml && (
        <div
          className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600 [&_a]:text-brand-600 [&_a]:underline"
          dangerouslySetInnerHTML={{ __html: introHtml }}
        />
      )}

      {fields.map((field) => {
        const error = errors[field.id]?.message as string | undefined;
        const helpId = field.help_text ? `${field.id}-help` : null;
        const errorId = error ? `${field.id}-error` : null;
        const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined;
        const ariaProps = {
          'aria-required': field.required ? true : undefined,
          'aria-invalid': error ? true : undefined,
          'aria-describedby': describedBy,
        } as const;
        return (
          <div key={field.id}>
            <label
              id={`${field.id}-label`}
              htmlFor={field.id}
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              {field.label}
              {field.required && (
                <span className="ml-0.5 text-rose-500" aria-hidden>
                  *
                </span>
              )}
              {mode === 'staff' && field.staff_only && (
                <span className="ml-2 text-xs font-normal text-slate-400">(staff only)</span>
              )}
            </label>
            {field.help_text && (
              <p id={helpId ?? undefined} className="mb-1 text-xs text-slate-500">
                {field.help_text}
              </p>
            )}

            <Controller
              name={field.id}
              control={control}
              render={({ field: rhf }) => {
                switch (field.type) {
                  case 'text':
                    return (
                      <input
                        id={field.id}
                        type="text"
                        disabled={disabled}
                        className={inputClass}
                        value={(rhf.value as string) ?? ''}
                        onChange={rhf.onChange}
                        onBlur={rhf.onBlur}
                        {...ariaProps}
                      />
                    );
                  case 'textarea':
                    return (
                      <textarea
                        id={field.id}
                        rows={4}
                        disabled={disabled}
                        className={inputClass}
                        value={(rhf.value as string) ?? ''}
                        onChange={rhf.onChange}
                        onBlur={rhf.onBlur}
                        {...ariaProps}
                      />
                    );
                  case 'select':
                    return (
                      <select
                        id={field.id}
                        disabled={disabled}
                        className={inputClass}
                        value={(rhf.value as string) ?? ''}
                        onChange={rhf.onChange}
                        onBlur={rhf.onBlur}
                        {...ariaProps}
                      >
                        <option value="">Select…</option>
                        {field.options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    );
                  case 'multiselect': {
                    const selected = Array.isArray(rhf.value) ? (rhf.value as string[]) : [];
                    return (
                      <div
                        role="group"
                        aria-labelledby={`${field.id}-label`}
                        aria-describedby={describedBy}
                        className="space-y-1.5"
                      >
                        {field.options.map((o) => (
                          <label key={o.value} className="flex items-center gap-2 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              disabled={disabled}
                              checked={selected.includes(o.value)}
                              onChange={(e) => {
                                const next = e.target.checked
                                  ? [...selected, o.value]
                                  : selected.filter((v) => v !== o.value);
                                rhf.onChange(next);
                              }}
                            />
                            {o.label}
                          </label>
                        ))}
                      </div>
                    );
                  }
                  case 'date':
                    return (
                      <input
                        id={field.id}
                        type="date"
                        disabled={disabled}
                        className={inputClass}
                        value={(rhf.value as string) ?? ''}
                        onChange={rhf.onChange}
                        onBlur={rhf.onBlur}
                        {...ariaProps}
                      />
                    );
                  case 'signature':
                    return (
                      <SignatureField
                        value={rhf.value as SignatureResponse | undefined}
                        onChange={rhf.onChange}
                        disabled={disabled}
                      />
                    );
                  case 'file':
                    return (
                      <FileField
                        value={rhf.value as FileResponse | undefined}
                        onChange={rhf.onChange}
                        disabled={disabled || !fileUploadUrl}
                        uploadUrl={fileUploadUrl}
                      />
                    );
                  default:
                    return <></>;
                }
              }}
            />
            {error && (
              <p id={errorId ?? undefined} role="alert" className="mt-1 text-sm text-rose-600">
                {error}
              </p>
            )}
          </div>
        );
      })}

      {!preview && onSubmit && (
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-60"
        >
          {submitting ? 'Submitting…' : submitLabel}
        </button>
      )}
    </form>
  );
}

function SignatureField({
  value,
  onChange,
  disabled,
}: {
  value: SignatureResponse | undefined;
  onChange: (v: SignatureResponse | undefined) => void;
  disabled?: boolean;
}) {
  const [method, setMethod] = useState<'drawn' | 'typed'>(value?.method ?? 'drawn');

  return (
    <div className="space-y-2">
      <div className="flex gap-2 text-xs">
        {(['drawn', 'typed'] as const).map((m) => (
          <button
            key={m}
            type="button"
            disabled={disabled}
            onClick={() => {
              setMethod(m);
              onChange(undefined);
            }}
            className={`rounded-full border px-3 py-1 font-medium ${
              method === m ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-500'
            }`}
          >
            {m === 'drawn' ? 'Draw' : 'Type name'}
          </button>
        ))}
      </div>
      {method === 'drawn' ? (
        <SignaturePad
          value={value?.method === 'drawn' ? value.data ?? null : null}
          disabled={disabled}
          onChange={(dataUrl) =>
            onChange(
              dataUrl ? { method: 'drawn', data: dataUrl, signed_at: new Date().toISOString() } : undefined,
            )
          }
        />
      ) : (
        <input
          type="text"
          placeholder="Type your full name"
          disabled={disabled}
          className={inputClass}
          value={value?.method === 'typed' ? value.data ?? '' : ''}
          onChange={(e) =>
            onChange(
              e.target.value.trim()
                ? { method: 'typed', data: e.target.value, signed_at: new Date().toISOString() }
                : undefined,
            )
          }
        />
      )}
    </div>
  );
}

function FileField({
  value,
  onChange,
  disabled,
  uploadUrl,
}: {
  value: FileResponse | undefined;
  onChange: (v: FileResponse | undefined) => void;
  disabled?: boolean;
  uploadUrl?: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    if (!uploadUrl) return;
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch(uploadUrl, { method: 'POST', body });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Upload failed');
        return;
      }
      onChange(json as FileResponse);
    } catch {
      setError('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-1">
      {value ? (
        <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
          <span className="truncate text-slate-700">{value.file_name}</span>
          {!disabled && (
            <button type="button" onClick={() => onChange(undefined)} className="text-xs text-slate-500 underline">
              Remove
            </button>
          )}
        </div>
      ) : (
        <input
          type="file"
          disabled={disabled || uploading}
          accept="application/pdf,image/jpeg,image/png,image/heic,image/webp"
          className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
        />
      )}
      {uploading && <p className="text-xs text-slate-500">Uploading…</p>}
      {!uploadUrl && !disabled && (
        <p className="text-xs text-slate-400">File upload is available on the public form.</p>
      )}
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}
