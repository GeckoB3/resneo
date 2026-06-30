'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { ComplianceFormRenderer } from '@/components/dashboard/compliance/ComplianceFormRenderer';
import { complianceJsonFetcher, formatComplianceDate } from '@/components/dashboard/compliance/shared';
import {
  COMPLIANCE_FIELD_TYPES,
  COMPLIANCE_RESULT_TYPES,
  validateFormSchemaForType,
  type ComplianceField,
  type ComplianceFieldType,
  type ComplianceFormSchema,
  type ComplianceResultType,
} from '@/lib/compliance/form-schema';
import {
  COMPLIANCE_CATEGORIES,
  COMPLIANCE_CAPTURE_METHODS,
  type ComplianceCaptureMethod,
  type ComplianceCategory,
} from '@/lib/compliance/constants';

const FIELD_TYPE_LABELS: Record<ComplianceFieldType, string> = {
  text: 'Short text',
  textarea: 'Long text',
  select: 'Dropdown',
  multiselect: 'Checkboxes',
  date: 'Date',
  signature: 'Signature',
  file: 'File upload',
};

const CATEGORY_LABELS: Record<ComplianceCategory, string> = {
  test: 'Test',
  consent: 'Consent',
  intake: 'Intake',
  declaration: 'Declaration',
  certificate: 'Certificate',
};

const RESULT_TYPE_LABELS: Record<ComplianceResultType, string> = {
  pass_fail: 'Pass / fail (staff decide a result)',
  signed: 'Signed (requires a signature)',
  completed: 'Completed (no result)',
  file_uploaded: 'File upload (requires a file)',
};

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20';

let idCounter = 0;
function newFieldId(): string {
  idCounter += 1;
  return `f_${Date.now().toString(36)}_${idCounter}`;
}

function blankField(type: ComplianceFieldType): ComplianceField {
  const base = { id: newFieldId(), label: 'New field', required: false, staff_only: false } as const;
  switch (type) {
    case 'select':
    case 'multiselect':
      return { ...base, type, options: [{ value: 'option_1', label: 'Option 1' }] };
    default:
      return { ...base, type } as ComplianceField;
  }
}

export interface BuilderMeta {
  name: string;
  category: ComplianceCategory;
  result_type: ComplianceResultType;
  validity_period_days: number | null;
  capture_methods: ComplianceCaptureMethod[];
  form_link_expiry_days: number | null;
  online_unmet_message: string | null;
}

const DEFAULT_META: BuilderMeta = {
  name: '',
  category: 'test',
  result_type: 'completed',
  validity_period_days: null,
  capture_methods: ['staff_in_venue', 'client_online'],
  form_link_expiry_days: null,
  online_unmet_message: null,
};

export function ComplianceFormBuilder({ mode, typeId }: { mode: 'new' | 'edit'; typeId?: string }) {
  const router = useRouter();
  const { data: loaded, isLoading, mutate: mutateType } = useSWR<{
    type: BuilderMeta & { id: string };
    version: { version_number: number; form_schema: ComplianceFormSchema } | null;
  }>(mode === 'edit' && typeId ? `/api/venue/compliance/types/${typeId}` : null, complianceJsonFetcher);

  const [meta, setMeta] = useState<BuilderMeta | null>(mode === 'new' ? DEFAULT_META : null);
  const [fields, setFields] = useState<ComplianceField[] | null>(mode === 'new' ? [] : null);
  const [description, setDescription] = useState('');
  const [introMarkdown, setIntroMarkdown] = useState('');
  const [resultMapping, setResultMapping] = useState<ComplianceFormSchema['result_mapping']>(undefined);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [changelog, setChangelog] = useState('');
  const [hydrated, setHydrated] = useState(mode === 'new');

  // Hydrate edit state once the type loads.
  if (mode === 'edit' && loaded && !hydrated) {
    const t = loaded.type;
    setMeta({
      name: t.name,
      category: t.category,
      result_type: t.result_type,
      validity_period_days: t.validity_period_days,
      capture_methods: t.capture_methods,
      form_link_expiry_days: t.form_link_expiry_days,
      online_unmet_message: t.online_unmet_message ?? null,
    });
    const schema = loaded.version?.form_schema;
    setFields(schema?.fields ?? []);
    setDescription(schema?.description ?? '');
    setIntroMarkdown(schema?.intro_markdown ?? '');
    setResultMapping(schema?.result_mapping);
    setHydrated(true);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    // Keyboard reordering (Tab to a handle, Space to lift, arrows to move) for a11y.
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const schema: ComplianceFormSchema | null = useMemo(() => {
    if (!meta || !fields) return null;
    return {
      schema_version: '1.0',
      title: meta.name || 'Untitled form',
      description: description || undefined,
      intro_markdown: introMarkdown || undefined,
      fields,
      result_mapping: meta.result_type === 'pass_fail' ? resultMapping : undefined,
    };
  }, [meta, fields, description, introMarkdown, resultMapping]);

  if (mode === 'edit' && (isLoading || !hydrated || !meta || !fields)) {
    return <p className="text-sm text-slate-500">Loading type…</p>;
  }
  if (!meta || !fields || !schema) return null;

  function setField(id: string, patch: Partial<ComplianceField>) {
    setFields((prev) => (prev ?? []).map((f) => (f.id === id ? ({ ...f, ...patch } as ComplianceField) : f)));
  }
  function removeField(id: string) {
    setFields((prev) => (prev ?? []).filter((f) => f.id !== id));
  }
  function addField(type: ComplianceFieldType) {
    setFields((prev) => [...(prev ?? []), blankField(type)]);
  }
  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setFields((prev) => {
      const list = prev ?? [];
      const oldIndex = list.findIndex((f) => f.id === active.id);
      const newIndex = list.findIndex((f) => f.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return list;
      return arrayMove(list, oldIndex, newIndex);
    });
  }

  // Switching to pass/fail auto-creates a ready-to-use staff-only Pass/Fail field and
  // wires the result mapping, so a valid pass/fail form exists without the staff member
  // hunting for the mapping box first (the field and its options stay fully editable).
  function handleResultTypeChange(next: ComplianceResultType) {
    setMeta((m) => (m ? { ...m, result_type: next } : m));
    if (next !== 'pass_fail') return;
    const list = fields ?? [];
    const existing = list.find((f) => f.type === 'select' && f.staff_only);
    if (existing) {
      if (!resultMapping) setResultMapping({ field: existing.id, pass_values: [], fail_values: [] });
      return;
    }
    const id = newFieldId();
    const resultField = {
      id,
      type: 'select',
      label: 'Result (staff decision)',
      required: true,
      staff_only: true,
      options: [
        { value: 'pass', label: 'Pass' },
        { value: 'fail', label: 'Fail' },
      ],
    } as ComplianceField;
    setFields([...list, resultField]);
    setResultMapping({ field: id, pass_values: ['pass'], fail_values: ['fail'] });
  }

  async function save() {
    if (!meta || !fields || !schema) return;
    setErrors([]);
    if (!meta.name.trim()) {
      setErrors(['Give the form a name.']);
      return;
    }
    if (meta.capture_methods.length === 0) {
      setErrors(['Choose at least one capture method.']);
      return;
    }
    const validation = validateFormSchemaForType(schema!, meta.result_type);
    if (!validation.ok) {
      setErrors(validation.errors);
      return;
    }

    setSaving(true);
    try {
      if (mode === 'new') {
        const res = await fetch('/api/venue/compliance/types', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: meta.name,
            category: meta.category,
            result_type: meta.result_type,
            validity_period_days: meta.validity_period_days,
            capture_methods: meta.capture_methods,
            form_link_expiry_days: meta.form_link_expiry_days,
            online_unmet_message: meta.online_unmet_message,
            form_schema: schema,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setErrors([body.error ?? 'Could not create the type.']);
          return;
        }
      } else if (typeId) {
        // Single request (audit U7): update settings and publish the new version together,
        // so a failure can no longer leave settings saved but the form unsaved.
        const patchRes = await fetch(`/api/venue/compliance/types/${typeId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: meta.name,
            category: meta.category,
            validity_period_days: meta.validity_period_days,
            capture_methods: meta.capture_methods,
            form_link_expiry_days: meta.form_link_expiry_days,
            online_unmet_message: meta.online_unmet_message,
            form_schema: schema,
            changelog: changelog.trim() || undefined,
          }),
        });
        if (!patchRes.ok) {
          const b = await patchRes.json().catch(() => ({}));
          setErrors([b.error ?? 'Could not save the form.']);
          return;
        }
      }
      router.push('/dashboard/settings?tab=compliance');
    } finally {
      setSaving(false);
    }
  }

  const selectFields = fields.filter((f) => f.type === 'select');

  return (
    <div className="space-y-4">
      {/* Header / metadata */}
      <SectionCard elevated>
        <SectionCard.Body>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-700">Form name</label>
              <input
                className={inputClass}
                value={meta.name}
                onChange={(e) => setMeta({ ...meta, name: e.target.value })}
                placeholder="e.g. PPD Patch Test"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Category</label>
              <select
                className={inputClass}
                value={meta.category}
                onChange={(e) => setMeta({ ...meta, category: e.target.value as ComplianceCategory })}
              >
                {COMPLIANCE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Result type</label>
              <select
                className={inputClass}
                value={meta.result_type}
                disabled={mode === 'edit'}
                onChange={(e) => handleResultTypeChange(e.target.value as ComplianceResultType)}
              >
                {COMPLIANCE_RESULT_TYPES.map((r) => (
                  <option key={r} value={r}>
                    {RESULT_TYPE_LABELS[r]}
                  </option>
                ))}
              </select>
              {mode === 'edit' ? (
                <p className="mt-1 text-xs text-slate-400">Result type can’t change after creation.</p>
              ) : (
                <p className="mt-1 text-xs text-slate-500">
                  Choose carefully: this can’t be changed once the form is created.
                </p>
              )}
            </div>
            <ValidityEditor meta={meta} setMeta={setMeta} />
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Captured by</label>
              <div className="flex flex-col gap-1 pt-1">
                {COMPLIANCE_CAPTURE_METHODS.map((m) => (
                  <label key={m} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={meta.capture_methods.includes(m)}
                      onChange={(e) =>
                        setMeta({
                          ...meta,
                          capture_methods: e.target.checked
                            ? [...meta.capture_methods, m]
                            : meta.capture_methods.filter((x) => x !== m),
                        })
                      }
                    />
                    {m === 'staff_in_venue' ? 'Staff in venue' : 'Client online'}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-4">
            <label className="mb-1 block text-sm font-medium text-slate-700">Description (optional)</label>
            <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="mt-4">
            <label className="mb-1 block text-sm font-medium text-slate-700">Intro text (optional, markdown)</label>
            <textarea
              className={inputClass}
              rows={2}
              value={introMarkdown}
              onChange={(e) => setIntroMarkdown(e.target.value)}
            />
          </div>
          <div className="mt-4">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Message when a booking is blocked (optional)
            </label>
            <textarea
              className={inputClass}
              rows={2}
              maxLength={500}
              placeholder="For example: Please book a patch test at least 48 hours before this appointment."
              value={meta.online_unmet_message ?? ''}
              onChange={(e) => setMeta({ ...meta, online_unmet_message: e.target.value || null })}
            />
            <p className="mt-1 text-xs text-slate-500">
              Shown to clients who try to book online without a valid record, when this form is one they cannot
              complete themselves (for example a patch test your team carries out). Tell them what to do next.
            </p>
          </div>
        </SectionCard.Body>
      </SectionCard>

      {errors.length > 0 && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          <ul className="list-inside list-disc space-y-0.5">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {preview ? (
        <SectionCard elevated>
          <SectionCard.Header eyebrow="Preview" title="Preview as client" />
          <SectionCard.Body>
            <ComplianceFormRenderer schema={schema} mode="public" preview />
          </SectionCard.Body>
        </SectionCard>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[200px_1fr]">
          {/* Palette */}
          <SectionCard>
            <SectionCard.Header title="Add field" />
            <SectionCard.Body>
              <div className="flex flex-col gap-1.5">
                {COMPLIANCE_FIELD_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => addField(t)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    + {FIELD_TYPE_LABELS[t]}
                  </button>
                ))}
              </div>
            </SectionCard.Body>
          </SectionCard>

          {/* Field list */}
          <SectionCard>
            <SectionCard.Header title="Form fields" description="Drag to reorder. Click a field to edit its settings." />
            <SectionCard.Body>
              {fields.length === 0 ? (
                <p className="text-sm text-slate-500">No fields yet. Add one from the left.</p>
              ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                  <SortableContext items={fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-3">
                      {fields.map((field) => (
                        <FieldCard
                          key={field.id}
                          field={field}
                          onChange={(patch) => setField(field.id, patch)}
                          onRemove={() => removeField(field.id)}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              )}

              {meta.result_type === 'pass_fail' && (
                <ResultMappingEditor
                  selectFields={selectFields}
                  mapping={resultMapping}
                  onChange={setResultMapping}
                />
              )}
            </SectionCard.Body>
          </SectionCard>
        </div>
      )}

      {mode === 'edit' && (
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">What changed (optional)</label>
          <input
            className={inputClass}
            value={changelog}
            onChange={(e) => setChangelog(e.target.value)}
            placeholder="e.g. Added a question about medication"
          />
          <p className="mt-1 text-xs text-slate-500">Saved with this version so you can see what changed later.</p>
        </div>
      )}

      {mode === 'edit' && typeId && (
        <VersionHistory
          typeId={typeId}
          currentVersionNumber={loaded?.version?.version_number ?? null}
          onRestored={async () => {
            // Pull the restored (now current) version, then re-hydrate the editor from it.
            await mutateType();
            setChangelog('');
            setHydrated(false);
          }}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setPreview((p) => !p)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {preview ? 'Back to editor' : 'Preview as client'}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {saving ? 'Saving…' : mode === 'new' ? 'Create type' : 'Save new version'}
        </button>
      </div>
    </div>
  );
}

interface VersionRow {
  id: string;
  version_number: number;
  changelog: string | null;
  created_at: string;
}

/**
 * Read-only version history with one-click restore (audit U4). "Restore" publishes a
 * new version copying the chosen one, so version numbers stay monotonic and existing
 * records keep the version they were captured against.
 */
function VersionHistory({
  typeId,
  currentVersionNumber,
  onRestored,
}: {
  typeId: string;
  currentVersionNumber: number | null;
  onRestored: () => void | Promise<void>;
}) {
  const { data, mutate, isLoading } = useSWR<{ versions: VersionRow[] }>(
    `/api/venue/compliance/types/${typeId}/versions`,
    complianceJsonFetcher,
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const versions = data?.versions ?? [];

  async function restore(versionId: string) {
    if (
      typeof window !== 'undefined' &&
      !window.confirm('Restore this version? It becomes a new current version and replaces any unsaved edits here.')
    ) {
      return;
    }
    setBusyId(versionId);
    setError(null);
    try {
      const res = await fetch(`/api/venue/compliance/types/${typeId}/versions/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version_id: versionId }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b.error ?? 'Could not restore this version.');
        return;
      }
      await mutate();
      await onRestored();
    } finally {
      setBusyId(null);
    }
  }

  // Nothing worth showing until there's more than the first version.
  if (!isLoading && versions.length <= 1) return null;

  return (
    <SectionCard>
      <SectionCard.Header
        title="Version history"
        description="Each save publishes a new version. Existing records keep the version they were captured against."
      />
      <SectionCard.Body>
        {error && (
          <div className="mb-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-sm text-rose-700">{error}</div>
        )}
        {isLoading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {versions.map((v) => {
              const isCurrent = v.version_number === currentVersionNumber;
              return (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800">
                      v{v.version_number}
                      {isCurrent && <span className="ml-2 text-xs font-normal text-emerald-600">(current)</span>}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatComplianceDate(v.created_at)}
                      {v.changelog ? ` · ${v.changelog}` : ''}
                    </p>
                  </div>
                  {!isCurrent && (
                    <button
                      type="button"
                      disabled={busyId === v.id}
                      onClick={() => restore(v.id)}
                      className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {busyId === v.id ? 'Restoring…' : 'Restore'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard.Body>
    </SectionCard>
  );
}

function ValidityEditor({ meta, setMeta }: { meta: BuilderMeta; setMeta: (m: BuilderMeta) => void }) {
  const mode: 'lifetime' | 'per_visit' | 'days' =
    meta.validity_period_days == null ? 'lifetime' : meta.validity_period_days === 0 ? 'per_visit' : 'days';
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700">Validity</label>
      <select
        className={inputClass}
        value={mode}
        onChange={(e) => {
          const v = e.target.value;
          setMeta({ ...meta, validity_period_days: v === 'lifetime' ? null : v === 'per_visit' ? 0 : 180 });
        }}
      >
        <option value="lifetime">No expiry (lifetime)</option>
        <option value="per_visit">Per visit (single-use)</option>
        <option value="days">Expires after N days</option>
      </select>
      {mode === 'days' && (
        <input
          type="number"
          min={1}
          max={3650}
          className={`${inputClass} mt-2`}
          value={meta.validity_period_days ?? 180}
          onChange={(e) => setMeta({ ...meta, validity_period_days: Math.max(1, Number(e.target.value)) })}
        />
      )}
    </div>
  );
}

function FieldCard({
  field,
  onChange,
  onRemove,
}: {
  field: ComplianceField;
  onChange: (patch: Partial<ComplianceField>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.9 : undefined,
  };
  const hasOptions = field.type === 'select' || field.type === 'multiselect';

  return (
    <div ref={setNodeRef} style={style} className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="mt-1 cursor-grab touch-none select-none text-slate-400 active:cursor-grabbing"
          aria-label="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          ⠿
        </button>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
              {FIELD_TYPE_LABELS[field.type]}
            </span>
            <button type="button" onClick={onRemove} className="ml-auto text-xs font-medium text-rose-600">
              Remove
            </button>
          </div>
          <input
            className={inputClass}
            value={field.label}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder="Question label"
          />
          <input
            className={inputClass}
            value={field.help_text ?? ''}
            onChange={(e) => onChange({ help_text: e.target.value || undefined })}
            placeholder="Help text shown under the question (optional)"
          />
          <div className="flex flex-wrap gap-4 text-xs text-slate-600">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={field.required} onChange={(e) => onChange({ required: e.target.checked })} />
              Required
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={field.staff_only} onChange={(e) => onChange({ staff_only: e.target.checked })} />
              Staff only
            </label>
          </div>
          {hasOptions && (
            <OptionsEditor
              options={(field as Extract<ComplianceField, { type: 'select' | 'multiselect' }>).options}
              onChange={(options) => onChange({ options } as Partial<ComplianceField>)}
            />
          )}
          <FieldExtras field={field} onChange={onChange} />
        </div>
      </div>
    </div>
  );
}

/**
 * Type-specific field settings the builder previously couldn't reach: character
 * limits and default values (text/textarea/select/multiselect/date). The schema
 * and renderer already support these; this surfaces them in the editor.
 */
function FieldExtras({
  field,
  onChange,
}: {
  field: ComplianceField;
  onChange: (patch: Partial<ComplianceField>) => void;
}) {
  const labelClass = 'mb-1 block text-xs font-medium text-slate-500';

  if (field.type === 'text' || field.type === 'textarea') {
    return (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <label className={labelClass}>Character limit (optional)</label>
          <input
            type="number"
            min={1}
            max={10000}
            className={inputClass}
            value={field.max_length ?? ''}
            onChange={(e) =>
              onChange({
                max_length: e.target.value ? Math.max(1, Number(e.target.value)) : undefined,
              } as Partial<ComplianceField>)
            }
          />
        </div>
        <div>
          <label className={labelClass}>Default value (optional)</label>
          <input
            className={inputClass}
            value={field.default_value ?? ''}
            onChange={(e) => onChange({ default_value: e.target.value || undefined } as Partial<ComplianceField>)}
          />
        </div>
      </div>
    );
  }

  if (field.type === 'select') {
    return (
      <div>
        <label className={labelClass}>Default selection (optional)</label>
        <select
          className={inputClass}
          value={field.default_value ?? ''}
          onChange={(e) => onChange({ default_value: e.target.value || undefined } as Partial<ComplianceField>)}
        >
          <option value="">No default</option>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (field.type === 'multiselect') {
    const selected = Array.isArray(field.default_value) ? field.default_value : [];
    return (
      <div>
        <label className={labelClass}>Default selections (optional)</label>
        <div className="flex flex-wrap gap-3">
          {field.options.map((o) => (
            <label key={o.value} className="flex items-center gap-1.5 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={selected.includes(o.value)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...selected, o.value]
                    : selected.filter((v) => v !== o.value);
                  onChange({ default_value: next.length ? next : undefined } as Partial<ComplianceField>);
                }}
              />
              {o.label}
            </label>
          ))}
        </div>
      </div>
    );
  }

  if (field.type === 'date') {
    const mode = field.default_value === 'today' ? 'today' : field.default_value ? 'date' : 'none';
    return (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <label className={labelClass}>Default date (optional)</label>
          <select
            className={inputClass}
            value={mode}
            onChange={(e) => {
              const v = e.target.value;
              onChange({
                default_value:
                  v === 'today' ? 'today' : v === 'date' ? new Date().toISOString().slice(0, 10) : undefined,
              } as Partial<ComplianceField>);
            }}
          >
            <option value="none">No default</option>
            <option value="today">Today (the date completed)</option>
            <option value="date">A specific date</option>
          </select>
        </div>
        {mode === 'date' && (
          <div>
            <label className={labelClass}>Pick the date</label>
            <input
              type="date"
              className={inputClass}
              value={field.default_value && field.default_value !== 'today' ? field.default_value : ''}
              onChange={(e) => onChange({ default_value: e.target.value || undefined } as Partial<ComplianceField>)}
            />
          </div>
        )}
      </div>
    );
  }

  // signature, file: no extra settings.
  return null;
}

function OptionsEditor({
  options,
  onChange,
}: {
  options: { value: string; label: string }[];
  onChange: (options: { value: string; label: string }[]) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-slate-500">Options</p>
      {options.map((o, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            className={`${inputClass} flex-1`}
            value={o.label}
            onChange={(e) => {
              const label = e.target.value;
              const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `option_${i + 1}`;
              // Guard against two labels slugifying to the same value (audit U8): a silent
              // value clash would corrupt select validation and pass/fail result mapping.
              const taken = new Set(options.filter((_, j) => j !== i).map((x) => x.value));
              let value = base;
              let n = 2;
              while (taken.has(value)) value = `${base}_${n++}`;
              onChange(options.map((x, j) => (j === i ? { value, label } : x)));
            }}
          />
          {options.length > 1 && (
            <button
              type="button"
              onClick={() => onChange(options.filter((_, j) => j !== i))}
              className="text-xs text-slate-400 hover:text-rose-600"
            >
              ✕
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => {
          // Pick the next free option_N so a freshly-added option can't collide with an
          // existing value (review #5) before its label is edited.
          const taken = new Set(options.map((x) => x.value));
          let n = options.length + 1;
          while (taken.has(`option_${n}`)) n += 1;
          onChange([...options, { value: `option_${n}`, label: `Option ${n}` }]);
        }}
        className="text-xs font-medium text-brand-600"
      >
        + Add option
      </button>
    </div>
  );
}

function ResultMappingEditor({
  selectFields,
  mapping,
  onChange,
}: {
  selectFields: ComplianceField[];
  mapping: ComplianceFormSchema['result_mapping'];
  onChange: (m: ComplianceFormSchema['result_mapping']) => void;
}) {
  const staffSelects = selectFields.filter((f) => f.staff_only);
  const resultField = staffSelects.find((f) => f.id === mapping?.field) ?? null;
  const options =
    resultField && resultField.type === 'select' ? resultField.options : [];

  return (
    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
      <p className="text-sm font-medium text-amber-900">Pass / fail result</p>
      <p className="mt-0.5 text-xs text-amber-700">
        We added a staff-only Pass / Fail field below. Rename it or its options if you like, or pick a different
        staff-only dropdown here, then mark which answers count as a pass or a fail.
      </p>
      <select
        className={`${inputClass} mt-2`}
        value={mapping?.field ?? ''}
        onChange={(e) =>
          onChange(e.target.value ? { field: e.target.value, pass_values: [], fail_values: [] } : undefined)
        }
      >
        <option value="">Select the result field…</option>
        {staffSelects.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </select>
      {resultField && (
        <div className="mt-2 space-y-1">
          {options.map((o) => {
            const isPass = mapping?.pass_values.includes(o.value);
            const isFail = mapping?.fail_values.includes(o.value);
            return (
              <div key={o.value} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-slate-700">{o.label}</span>
                <div className="flex gap-1">
                  {(['pass', 'fail'] as const).map((bucket) => {
                    const active = bucket === 'pass' ? isPass : isFail;
                    return (
                      <button
                        key={bucket}
                        type="button"
                        onClick={() => {
                          if (!mapping) return;
                          const pass = new Set(mapping.pass_values);
                          const fail = new Set(mapping.fail_values);
                          pass.delete(o.value);
                          fail.delete(o.value);
                          if (bucket === 'pass') pass.add(o.value);
                          else fail.add(o.value);
                          onChange({ field: mapping.field, pass_values: [...pass], fail_values: [...fail] });
                        }}
                        className={`rounded-md border px-2 py-0.5 text-xs font-medium ${
                          active
                            ? bucket === 'pass'
                              ? 'border-emerald-300 bg-emerald-100 text-emerald-800'
                              : 'border-rose-300 bg-rose-100 text-rose-800'
                            : 'border-slate-200 bg-white text-slate-500'
                        }`}
                      >
                        {bucket === 'pass' ? 'Pass' : 'Fail'}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
