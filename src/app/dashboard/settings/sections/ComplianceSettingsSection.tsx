'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { TabBar } from '@/components/ui/dashboard/TabBar';
import { Dialog } from '@/components/ui/primitives/Dialog';
import { Pill } from '@/components/ui/dashboard/Pill';
import { ComplianceRequirementsEditor } from '@/components/dashboard/compliance/ComplianceRequirementsEditor';
import {
  CATEGORY_LABELS,
  RESULT_TYPE_LABELS,
  complianceJsonFetcher,
  validityLabel,
  type ComplianceTypeSummary,
} from '@/components/dashboard/compliance/shared';
import {
  COMPLIANCE_DEFAULT_CAPTURE_METHODS,
  COMPLIANCE_FORM_LINK_CHANNELS,
  DEFAULT_COMPLIANCE_CONFIG,
  type ComplianceConfig,
} from '@/lib/compliance/config';

type SubTab = 'types' | 'requirements' | 'general';
const SUB_TABS: ReadonlyArray<{ id: SubTab; label: string }> = [
  { id: 'types', label: 'Templates & types' },
  { id: 'requirements', label: 'Service requirements' },
  { id: 'general', label: 'General settings' },
];

export function ComplianceSettingsSection({ isAdmin }: { isAdmin: boolean }) {
  const [sub, setSub] = useState<SubTab>('types');

  return (
    <div className="space-y-4">
      <TabBar tabs={SUB_TABS} value={sub} onChange={setSub} />
      {sub === 'types' && <TypesPanel isAdmin={isAdmin} />}
      {sub === 'requirements' && <RequirementsPanel />}
      {sub === 'general' && <GeneralPanel isAdmin={isAdmin} />}
    </div>
  );
}

// ─── Templates & types ──────────────────────────────────────────────────────

function TypesPanel({ isAdmin }: { isAdmin: boolean }) {
  const { data, mutate, isLoading, error: loadError } = useSWR<{ types: ComplianceTypeSummary[] }>(
    '/api/venue/compliance/types?include_archived=true',
    complianceJsonFetcher,
  );
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const types = data?.types ?? [];
  const featureDisabled = Boolean(loadError);

  async function archiveToggle(t: ComplianceTypeSummary) {
    setBusyId(t.id);
    setError(null);
    try {
      const action = t.is_active ? 'archive' : 'restore';
      const res = await fetch(`/api/venue/compliance/types/${t.id}/${action}`, { method: 'POST' });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b.error ?? 'Could not update type.');
        return;
      }
      await mutate();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SectionCard elevated>
      <SectionCard.Header
        eyebrow="Compliance"
        title="Templates and types"
        description="The kinds of records this venue collects: patch tests, consent forms, intake questionnaires."
        right={
          isAdmin ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setLibraryOpen(true)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Add from library
              </button>
              <Link
                href="/dashboard/compliance-types/new"
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700"
              >
                Create custom type
              </Link>
            </div>
          ) : undefined
        }
      />
      <SectionCard.Body>
        {error && (
          <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 p-2 text-sm text-rose-700">{error}</div>
        )}
        {featureDisabled ? (
          <p className="text-sm text-slate-500">
            Turn on <span className="font-medium">Enable compliance records</span> in the General settings tab to
            create and manage compliance types.
          </p>
        ) : isLoading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : types.length === 0 ? (
          <p className="text-sm text-slate-500">
            No compliance types yet. Add one from the library or create a custom type.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {types.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-slate-800">{t.name}</span>
                    {!t.is_active && <Pill variant="compliance-voided" size="sm">Archived</Pill>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                    <Pill variant="neutral" size="sm">{CATEGORY_LABELS[t.category] ?? t.category}</Pill>
                    <span>· {RESULT_TYPE_LABELS[t.result_type] ?? t.result_type}</span>
                    <span>· {validityLabel(t.validity_period_days)}</span>
                    {t.current_version_number != null && <span>· v{t.current_version_number}</span>}
                    <span>· {t.service_requirement_count ?? 0} service(s)</span>
                    <span>· {t.record_count ?? 0} record(s)</span>
                  </div>
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/dashboard/compliance-types/${t.id}/edit`}
                      className="text-sm font-medium text-brand-600 hover:text-brand-700"
                    >
                      Edit
                    </Link>
                    <button
                      type="button"
                      onClick={() => archiveToggle(t)}
                      disabled={busyId === t.id}
                      className="text-sm font-medium text-slate-500 hover:text-slate-700 disabled:opacity-50"
                    >
                      {t.is_active ? 'Archive' : 'Restore'}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionCard.Body>
      <LibraryDialog open={libraryOpen} onOpenChange={setLibraryOpen} onCloned={() => mutate()} />
    </SectionCard>
  );
}

interface LibraryTemplateSummary {
  slug: string;
  name: string;
  category: string;
  result_type: string;
  validity_period_days: number | null;
  description?: string;
  field_count: number;
}

function LibraryDialog({
  open,
  onOpenChange,
  onCloned,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloned: () => void;
}) {
  const { data } = useSWR<{ templates: LibraryTemplateSummary[] }>(
    open ? '/api/venue/compliance/library' : null,
    complianceJsonFetcher,
  );
  const [cloningSlug, setCloningSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const templates = data?.templates ?? [];

  async function clone(slug: string) {
    setCloningSlug(slug);
    setError(null);
    try {
      const res = await fetch(`/api/venue/compliance/library/${slug}/clone`, { method: 'POST' });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b.error ?? 'Could not add this template.');
        return;
      }
      onCloned();
    } finally {
      setCloningSlug(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Add from library" size="lg">
      <div className="space-y-3">
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-sm text-rose-700">{error}</div>
        )}
        <ul className="divide-y divide-slate-100">
          {templates.map((t) => (
            <li key={t.slug} className="flex items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800">{t.name}</p>
                {t.description && <p className="mt-0.5 text-xs text-slate-500">{t.description}</p>}
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
                  <Pill variant="neutral" size="sm">{CATEGORY_LABELS[t.category] ?? t.category}</Pill>
                  <span>· {validityLabel(t.validity_period_days)}</span>
                  <span>· {t.field_count} field(s)</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => clone(t.slug)}
                disabled={cloningSlug === t.slug}
                className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {cloningSlug === t.slug ? 'Adding…' : 'Add'}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}

// ─── Service requirements ───────────────────────────────────────────────────

interface ServiceRow {
  id: string;
  name: string;
  is_active?: boolean;
}

function RequirementsPanel() {
  const { data, isLoading } = useSWR<{ services: ServiceRow[] }>(
    '/api/venue/appointment-services',
    complianceJsonFetcher,
  );
  const services = (data?.services ?? []).filter((s) => s.is_active !== false);

  return (
    <SectionCard elevated>
      <SectionCard.Header
        eyebrow="Compliance"
        title="Service requirements"
        description="Connect compliance types to the services that need them. You can also do this from the service editor."
      />
      <SectionCard.Body>
        {isLoading ? (
          <p className="text-sm text-slate-500">Loading services…</p>
        ) : services.length === 0 ? (
          <p className="text-sm text-slate-500">No services to configure yet.</p>
        ) : (
          <div className="space-y-3">
            {services.map((s) => (
              <details key={s.id} className="rounded-lg border border-slate-200">
                <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-800">{s.name}</summary>
                <div className="border-t border-slate-100 p-3">
                  <ComplianceRequirementsEditor appointmentServiceId={s.id} complianceEnabled />
                </div>
              </details>
            ))}
          </div>
        )}
      </SectionCard.Body>
    </SectionCard>
  );
}

// ─── General settings ───────────────────────────────────────────────────────

function GeneralPanel({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const { data, mutate } = useSWR<{ raw: { compliance_records_enabled?: boolean; compliance?: Partial<ComplianceConfig> } }>(
    '/api/venue/feature-flags',
    complianceJsonFetcher,
  );

  const [draft, setDraft] = useState<ComplianceConfig | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const config: ComplianceConfig =
    draft ?? { ...DEFAULT_COMPLIANCE_CONFIG, ...(data?.raw?.compliance ?? {}) };
  const isEnabled = enabled ?? data?.raw?.compliance_records_enabled ?? false;

  function set<K extends keyof ComplianceConfig>(key: K, value: ComplianceConfig[K]) {
    setDraft({ ...config, [key]: value });
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSavedMessage(null);
    try {
      const res = await fetch('/api/venue/feature-flags', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ compliance_records_enabled: isEnabled, compliance: config }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b.error ?? 'Could not save settings.');
        return;
      }
      await mutate();
      // The feature flag is resolved server-side in the dashboard layout and handed to
      // VenueFeatureFlagsProvider, so toggling it on/off only takes effect across the
      // dashboard (contact panel Compliance block, sidebar nav, booking accordion) once
      // the server components re-render. Refresh so it applies immediately, no reload.
      router.refresh();
      setSavedMessage('Settings saved.');
    } finally {
      setSaving(false);
    }
  }

  const fieldClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-50';

  return (
    <SectionCard elevated>
      <SectionCard.Header
        eyebrow="Compliance"
        title="General settings"
        description="Enable the feature and set defaults for capture, reminders, and form links."
      />
      <SectionCard.Body>
        <div className="space-y-4">
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-sm text-rose-700">{error}</div>
          )}
          {savedMessage && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-700">
              {savedMessage}
            </div>
          )}

          <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
            <input
              type="checkbox"
              disabled={!isAdmin}
              checked={isEnabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Enable compliance records for this venue
          </label>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Default capture method</label>
              <select
                disabled={!isAdmin}
                className={fieldClass}
                value={config.default_capture_method}
                onChange={(e) => set('default_capture_method', e.target.value as ComplianceConfig['default_capture_method'])}
              >
                {COMPLIANCE_DEFAULT_CAPTURE_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m === 'staff_in_venue' ? 'Staff in venue' : m === 'client_online' ? 'Client online' : 'Both'}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Default form-link channel</label>
              <select
                disabled={!isAdmin}
                className={fieldClass}
                value={config.default_form_link_channel}
                onChange={(e) => set('default_form_link_channel', e.target.value as ComplianceConfig['default_form_link_channel'])}
              >
                {COMPLIANCE_FORM_LINK_CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {c === 'email' ? 'Email' : 'SMS'}
                  </option>
                ))}
              </select>
              {config.default_form_link_channel !== 'email' && (
                <p className="mt-1 text-xs text-slate-500">
                  SMS uses your plan’s messaging allowance; if SMS can’t be sent we email the link instead so it always reaches the client.
                </p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Reminder cadence (days before expiry)</label>
              <input
                type="number"
                min={0}
                max={90}
                disabled={!isAdmin}
                className={fieldClass}
                value={config.reminder_cadence_days}
                onChange={(e) => set('reminder_cadence_days', Number(e.target.value))}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Form-link expiry (days)</label>
              <input
                type="number"
                min={1}
                max={90}
                disabled={!isAdmin}
                className={fieldClass}
                value={config.form_link_expiry_days}
                onChange={(e) => set('form_link_expiry_days', Number(e.target.value))}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Default lock period (hours)</label>
              <input
                type="number"
                min={0}
                max={720}
                disabled={!isAdmin}
                className={fieldClass}
                value={config.lock_period_hours}
                onChange={(e) => set('lock_period_hours', Number(e.target.value))}
              />
            </div>
          </div>

          <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            Whether a form shows during online booking, is emailed with the booking confirmation, or is left for
            your team to collect is now set for each service in the{' '}
            <span className="font-medium">Service requirements</span> tab.
          </p>

          {isAdmin && (
            <div>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Save settings'}
              </button>
            </div>
          )}
        </div>
      </SectionCard.Body>
    </SectionCard>
  );
}
