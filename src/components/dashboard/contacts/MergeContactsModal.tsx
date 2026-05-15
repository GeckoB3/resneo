'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatGuestDisplayName } from '@/lib/guests/name';
import { readResponseJson } from '@/lib/http/read-response-json';
import type { GuestDetailGuest, GuestDetailResponse, GuestListRow } from '@/types/contacts';

type MergeStep = 1 | 2 | 3 | 4;

type FieldSource = 'target' | 'source';

interface MergeFieldChoices {
  first_name: FieldSource;
  last_name: FieldSource;
  email: FieldSource;
  phone: FieldSource;
  customer_profile_notes: FieldSource;
  tags: 'target' | 'source' | 'union';
  marketing: FieldSource;
  custom_fields: 'target' | 'source_overlay';
}

function defaultMergeChoices(): MergeFieldChoices {
  return {
    first_name: 'target',
    last_name: 'target',
    email: 'target',
    phone: 'target',
    customer_profile_notes: 'target',
    tags: 'union',
    marketing: 'target',
    custom_fields: 'target',
  };
}

function displayStr(value: string | null | undefined): string {
  const t = typeof value === 'string' ? value.trim() : '';
  return t.length > 0 ? t : '—';
}

function marketingLabel(optOut: boolean, consent: boolean): string {
  if (optOut) return 'Opted out of marketing';
  if (consent) return 'Marketing subscribed';
  return 'No marketing consent recorded';
}

function buildMergedProfilePayload(
  target: GuestDetailGuest,
  source: GuestDetailGuest,
  c: MergeFieldChoices,
): Record<string, unknown> {
  const pickStr = (which: FieldSource, t: string | null, s: string | null) =>
    (which === 'target' ? (t ?? '').trim() : (s ?? '').trim());

  const notesTarget = target.customer_profile_notes?.trim() ?? '';
  const notesSource = source.customer_profile_notes?.trim() ?? '';
  const customer_profile_notes =
    c.customer_profile_notes === 'target'
      ? notesTarget === ''
        ? null
        : notesTarget
      : notesSource === ''
        ? null
        : notesSource;

  let tags: string[];
  if (c.tags === 'union') {
    tags = [...new Set([...(target.tags ?? []), ...(source.tags ?? [])])].sort((a, b) => a.localeCompare(b));
  } else if (c.tags === 'target') {
    tags = [...(target.tags ?? [])];
  } else {
    tags = [...(source.tags ?? [])];
  }

  const marketing_opt_out = c.marketing === 'target' ? target.marketing_opt_out : source.marketing_opt_out;
  const marketing_consent = c.marketing === 'target' ? target.marketing_consent : source.marketing_consent;

  const targetCf =
    target.custom_fields && typeof target.custom_fields === 'object' && !Array.isArray(target.custom_fields)
      ? (target.custom_fields as Record<string, unknown>)
      : {};
  const sourceCf =
    source.custom_fields && typeof source.custom_fields === 'object' && !Array.isArray(source.custom_fields)
      ? (source.custom_fields as Record<string, unknown>)
      : {};

  const out: Record<string, unknown> = {
    first_name: pickStr(c.first_name, target.first_name, source.first_name),
    last_name: pickStr(c.last_name, target.last_name, source.last_name),
    email: pickStr(c.email, target.email, source.email),
    phone: pickStr(c.phone, target.phone, source.phone),
    tags,
    customer_profile_notes,
    marketing_opt_out,
    marketing_consent,
  };

  if (c.custom_fields === 'source_overlay') {
    out.custom_fields = { ...targetCf, ...sourceCf };
  }

  return out;
}

function FieldPickRow({
  label,
  keptLabel,
  mergeLabel,
  valueKept,
  valueMerge,
  valueName,
  picked,
  onChange,
}: {
  label: string;
  keptLabel: string;
  mergeLabel: string;
  valueKept: string;
  valueMerge: string;
  valueName: keyof Pick<
    MergeFieldChoices,
    'first_name' | 'last_name' | 'email' | 'phone' | 'customer_profile_notes'
  >;
  picked: FieldSource;
  onChange: (name: typeof valueName, next: FieldSource) => void;
}) {
  return (
    <fieldset className="rounded-xl border border-slate-200 bg-slate-50/40 p-3">
      <legend className="px-0.5 text-xs font-semibold text-slate-800">{label}</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="flex cursor-pointer gap-2 rounded-lg border border-transparent bg-white p-2 ring-slate-900/[0.04] has-[:checked]:border-brand-300 has-[:checked]:ring-2 has-[:checked]:ring-brand-100">
          <input
            type="radio"
            name={valueName}
            checked={picked === 'target'}
            onChange={() => onChange(valueName, 'target')}
            className="mt-0.5"
          />
          <span className="min-w-0 text-xs">
            <span className="font-semibold text-slate-900">{keptLabel}</span>
            <span className="mt-0.5 block break-words text-slate-600">{valueKept}</span>
          </span>
        </label>
        <label className="flex cursor-pointer gap-2 rounded-lg border border-transparent bg-white p-2 ring-slate-900/[0.04] has-[:checked]:border-brand-300 has-[:checked]:ring-2 has-[:checked]:ring-brand-100">
          <input
            type="radio"
            name={valueName}
            checked={picked === 'source'}
            onChange={() => onChange(valueName, 'source')}
            className="mt-0.5"
          />
          <span className="min-w-0 text-xs">
            <span className="font-semibold text-slate-900">{mergeLabel}</span>
            <span className="mt-0.5 block break-words text-slate-600">{valueMerge}</span>
          </span>
        </label>
      </div>
    </fieldset>
  );
}

export function MergeContactsModal({
  targetGuestId,
  clientLower,
  onClose,
  onMerged,
}: {
  targetGuestId: string;
  /** Lowercase terminology for labels (e.g. “client”, “customer”). */
  clientLower: string;
  onClose: () => void;
  onMerged: () => void;
}) {
  const keptLabel = `Kept ${clientLower}`;
  const mergeLabel = `Merge-from ${clientLower}`;

  const [step, setStep] = useState<MergeStep>(1);
  const [targetGuest, setTargetGuest] = useState<GuestDetailGuest | null>(null);
  const [targetLoadErr, setTargetLoadErr] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<GuestListRow[]>([]);

  const [sourceGuest, setSourceGuest] = useState<GuestDetailGuest | null>(null);
  const [sourceSummary, setSourceSummary] = useState<GuestListRow | null>(null);
  const [sourceLoadErr, setSourceLoadErr] = useState<string | null>(null);

  const [choices, setChoices] = useState<MergeFieldChoices | null>(null);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 320);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setTargetLoadErr(null);
      try {
        const res = await fetch(`/api/venue/guests/${targetGuestId}`);
        const payload = await readResponseJson<GuestDetailResponse & { error?: string }>(res);
        if (!res.ok) {
          if (!cancelled) setTargetLoadErr(typeof payload.error === 'string' ? payload.error : 'Could not load kept contact');
          return;
        }
        if (!cancelled) setTargetGuest(payload.guest);
      } catch {
        if (!cancelled) setTargetLoadErr('Could not load kept contact');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [targetGuestId]);

  useEffect(() => {
    if (step !== 1) return;
    if (debouncedSearch.length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    let cancelled = false;
    setSearchLoading(true);
    void (async () => {
      try {
        const qs = new URLSearchParams({
          search: debouncedSearch,
          filter: 'all',
          page: '0',
          limit: '25',
        });
        const res = await fetch(`/api/venue/guests?${qs.toString()}`);
        const payload = await readResponseJson<{ guests?: GuestListRow[]; error?: string }>(res);
        if (!res.ok) {
          if (!cancelled) setSearchResults([]);
          return;
        }
        const list = (payload.guests ?? []).filter((g) => g.id !== targetGuestId);
        if (!cancelled) setSearchResults(list);
      } catch {
        if (!cancelled) setSearchResults([]);
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, step, targetGuestId]);

  const loadSourceGuest = useCallback(async (row: GuestListRow) => {
    setSourceLoadErr(null);
    setSourceGuest(null);
    setSourceSummary(row);
    try {
      const res = await fetch(`/api/venue/guests/${row.id}`);
      const payload = await readResponseJson<GuestDetailResponse & { error?: string }>(res);
      if (!res.ok) {
        setSourceLoadErr(typeof payload.error === 'string' ? payload.error : 'Could not load contact');
        return;
      }
      setSourceGuest(payload.guest);
    } catch {
      setSourceLoadErr('Could not load contact');
    }
  }, []);

  const mergedPreview = useMemo(() => {
    if (!targetGuest || !sourceGuest || !choices) return null;
    return buildMergedProfilePayload(targetGuest, sourceGuest, choices);
  }, [targetGuest, sourceGuest, choices]);

  const submit = async () => {
    if (!targetGuest || !sourceGuest || !choices || !mergedPreview) return;
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch('/api/venue/guests/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_guest_id: targetGuestId,
          source_guest_ids: [sourceGuest.id],
          merged_profile: mergedPreview,
          field_map: {
            step_ui_version: 2,
            choices,
            kept_guest_id: targetGuestId,
            merge_from_guest_id: sourceGuest.id,
          },
        }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(typeof j.error === 'string' ? j.error : 'Merge failed');
      onMerged();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Merge failed');
    } finally {
      setBusy(false);
    }
  };

  const targetTitle = targetGuest
    ? formatGuestDisplayName(targetGuest.first_name, targetGuest.last_name)
    : '…';

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="merge-contacts-title"
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-5 shadow-xl sm:max-w-2xl sm:rounded-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 id="merge-contacts-title" className="text-lg font-semibold text-slate-900">
              Merge duplicate {clientLower}s
            </h3>
            <p className="mt-1 text-xs font-medium text-slate-500">
              Step {step} of 4 · Admin only · Cannot be undone
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {targetLoadErr ? (
          <p className="mt-3 text-sm text-red-600">{targetLoadErr}</p>
        ) : (
          <p className="mt-2 text-sm text-slate-600">
            Kept record: <span className="font-semibold text-slate-900">{targetTitle}</span>
            <span className="ml-1 font-mono text-xs text-slate-400">({targetGuestId.slice(0, 8)}…)</span>
          </p>
        )}

        {err ? <p className="mt-2 text-sm text-red-600">{err}</p> : null}

        {step === 1 && (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-slate-600">
              Search for the other profile to merge into this one. That profile will be removed after merge; its history
              moves to the kept {clientLower}.
            </p>
            <label className="block text-xs font-medium text-slate-600">Search by name, email, or phone</label>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="At least 2 characters…"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              autoComplete="off"
            />
            {debouncedSearch.length > 0 && debouncedSearch.length < 2 ? (
              <p className="text-xs text-slate-500">Type at least two characters to search.</p>
            ) : null}
            <div className="max-h-52 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50/50">
              {searchLoading ? (
                <p className="p-3 text-xs text-slate-500">Searching…</p>
              ) : debouncedSearch.length >= 2 && searchResults.length === 0 ? (
                <p className="p-3 text-xs text-slate-500">No matches.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {searchResults.map((g) => (
                    <li key={g.id}>
                      <button
                        type="button"
                        onClick={() => void loadSourceGuest(g)}
                        className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-white ${
                          sourceSummary?.id === g.id ? 'bg-brand-50 ring-1 ring-inset ring-brand-100' : ''
                        }`}
                      >
                        <span className="font-semibold text-slate-900">{formatGuestDisplayName(g.first_name, g.last_name)}</span>
                        <span className="text-xs text-slate-500">
                          {[displayStr(g.email), displayStr(g.phone)].filter((x) => x !== '—').join(' · ') || 'No email or phone'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {sourceLoadErr ? <p className="text-xs text-red-600">{sourceLoadErr}</p> : null}
            {sourceGuest ? (
              <p className="text-xs font-medium text-emerald-800">
                Selected merge-from {clientLower}: {formatGuestDisplayName(sourceGuest.first_name, sourceGuest.last_name)}
              </p>
            ) : null}
          </div>
        )}

        {step === 2 && (
          <div className="mt-4 space-y-3 text-sm text-slate-700">
            <p className="font-semibold text-slate-900">What this merge does</p>
            <ul className="list-inside list-disc space-y-1.5 text-sm">
              <li>All bookings for the merge-from {clientLower} point at the kept record.</li>
              <li>Communications, uploaded documents, loyalty entries, and class enrolments move to the kept record.</li>
              <li>Household memberships are merged (duplicate links removed).</li>
              <li>The merge-from guest row is permanently deleted.</li>
            </ul>
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-950">
              Booking guest snapshots (names on past confirmations) are not rewritten — only the linked guest record changes.
            </p>
          </div>
        )}

        {step === 3 && targetGuest && sourceGuest && choices ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-slate-600">
              Choose which values to keep on the surviving profile. Tags can be combined automatically.
            </p>

            <FieldPickRow
              label="First name"
              keptLabel={keptLabel}
              mergeLabel={mergeLabel}
              valueKept={displayStr(targetGuest.first_name)}
              valueMerge={displayStr(sourceGuest.first_name)}
              valueName="first_name"
              picked={choices.first_name}
              onChange={(name, next) => setChoices((c) => (c ? { ...c, [name]: next } : c))}
            />
            <FieldPickRow
              label="Surname"
              keptLabel={keptLabel}
              mergeLabel={mergeLabel}
              valueKept={displayStr(targetGuest.last_name)}
              valueMerge={displayStr(sourceGuest.last_name)}
              valueName="last_name"
              picked={choices.last_name}
              onChange={(name, next) => setChoices((c) => (c ? { ...c, [name]: next } : c))}
            />
            <FieldPickRow
              label="Email"
              keptLabel={keptLabel}
              mergeLabel={mergeLabel}
              valueKept={displayStr(targetGuest.email)}
              valueMerge={displayStr(sourceGuest.email)}
              valueName="email"
              picked={choices.email}
              onChange={(name, next) => setChoices((c) => (c ? { ...c, [name]: next } : c))}
            />
            <FieldPickRow
              label="Mobile / phone"
              keptLabel={keptLabel}
              mergeLabel={mergeLabel}
              valueKept={displayStr(targetGuest.phone)}
              valueMerge={displayStr(sourceGuest.phone)}
              valueName="phone"
              picked={choices.phone}
              onChange={(name, next) => setChoices((c) => (c ? { ...c, [name]: next } : c))}
            />
            <FieldPickRow
              label="Guest profile note (staff-visible)"
              keptLabel={keptLabel}
              mergeLabel={mergeLabel}
              valueKept={displayStr(targetGuest.customer_profile_notes)}
              valueMerge={displayStr(sourceGuest.customer_profile_notes)}
              valueName="customer_profile_notes"
              picked={choices.customer_profile_notes}
              onChange={(name, next) => setChoices((c) => (c ? { ...c, [name]: next } : c))}
            />

            <fieldset className="rounded-xl border border-slate-200 bg-slate-50/40 p-3">
              <legend className="px-0.5 text-xs font-semibold text-slate-800">Tags</legend>
              <div className="mt-2 space-y-2">
                {(
                  [
                    { id: 'union' as const, title: 'Combine both', sub: 'Union of tags from both profiles (sorted)' },
                    { id: 'target' as const, title: `Only ${keptLabel}`, sub: displayStr(targetGuest.tags.join(', ') || 'None') },
                    { id: 'source' as const, title: `Only ${mergeLabel}`, sub: displayStr(sourceGuest.tags.join(', ') || 'None') },
                  ]
                ).map((opt) => (
                  <label
                    key={opt.id}
                    className="flex cursor-pointer gap-2 rounded-lg border border-transparent bg-white p-2 has-[:checked]:border-brand-300 has-[:checked]:ring-2 has-[:checked]:ring-brand-100"
                  >
                    <input
                      type="radio"
                      name="merge-tags"
                      checked={choices.tags === opt.id}
                      onChange={() => setChoices((c) => (c ? { ...c, tags: opt.id } : c))}
                      className="mt-0.5"
                    />
                    <span className="text-xs">
                      <span className="font-semibold text-slate-900">{opt.title}</span>
                      <span className="mt-0.5 block text-slate-600">{opt.sub}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="rounded-xl border border-slate-200 bg-slate-50/40 p-3">
              <legend className="px-0.5 text-xs font-semibold text-slate-800">Marketing preferences</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <label className="flex cursor-pointer gap-2 rounded-lg border border-transparent bg-white p-2 has-[:checked]:border-brand-300 has-[:checked]:ring-2 has-[:checked]:ring-brand-100">
                  <input
                    type="radio"
                    name="merge-mkt"
                    checked={choices.marketing === 'target'}
                    onChange={() => setChoices((c) => (c ? { ...c, marketing: 'target' } : c))}
                  />
                  <span className="text-xs">
                    <span className="font-semibold text-slate-900">{keptLabel}</span>
                    <span className="mt-0.5 block text-slate-600">{marketingLabel(targetGuest.marketing_opt_out, targetGuest.marketing_consent)}</span>
                  </span>
                </label>
                <label className="flex cursor-pointer gap-2 rounded-lg border border-transparent bg-white p-2 has-[:checked]:border-brand-300 has-[:checked]:ring-2 has-[:checked]:ring-brand-100">
                  <input
                    type="radio"
                    name="merge-mkt"
                    checked={choices.marketing === 'source'}
                    onChange={() => setChoices((c) => (c ? { ...c, marketing: 'source' } : c))}
                  />
                  <span className="text-xs">
                    <span className="font-semibold text-slate-900">{mergeLabel}</span>
                    <span className="mt-0.5 block text-slate-600">{marketingLabel(sourceGuest.marketing_opt_out, sourceGuest.marketing_consent)}</span>
                  </span>
                </label>
              </div>
            </fieldset>

            <fieldset className="rounded-xl border border-slate-200 bg-slate-50/40 p-3">
              <legend className="px-0.5 text-xs font-semibold text-slate-800">Custom fields</legend>
              <div className="mt-2 space-y-2">
                <label className="flex cursor-pointer gap-2 rounded-lg border border-transparent bg-white p-2 has-[:checked]:border-brand-300 has-[:checked]:ring-2 has-[:checked]:ring-brand-100">
                  <input
                    type="radio"
                    name="merge-cf"
                    checked={choices.custom_fields === 'target'}
                    onChange={() => setChoices((c) => (c ? { ...c, custom_fields: 'target' } : c))}
                  />
                  <span className="text-xs font-semibold text-slate-900">Keep kept {clientLower}&apos;s values only</span>
                </label>
                <label className="flex cursor-pointer gap-2 rounded-lg border border-transparent bg-white p-2 has-[:checked]:border-brand-300 has-[:checked]:ring-2 has-[:checked]:ring-brand-100">
                  <input
                    type="radio"
                    name="merge-cf"
                    checked={choices.custom_fields === 'source_overlay'}
                    onChange={() => setChoices((c) => (c ? { ...c, custom_fields: 'source_overlay' } : c))}
                  />
                  <span className="text-xs">
                    <span className="font-semibold text-slate-900">Merge-from overrides on conflicts</span>
                    <span className="mt-0.5 block font-normal text-slate-600">
                      Keeps all keys from the kept record, then overlays values from the merge-from profile for any matching keys.
                    </span>
                  </span>
                </label>
              </div>
            </fieldset>
          </div>
        ) : null}

        {step === 4 && mergedPreview ? (
          <div className="mt-4 space-y-3 text-sm">
            <p className="font-semibold text-slate-900">Confirm merged profile</p>
            <dl className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-xs sm:grid-cols-2">
              <div>
                <dt className="font-semibold text-slate-500">First name</dt>
                <dd className="mt-0.5 text-slate-900">{displayStr(String(mergedPreview.first_name ?? ''))}</dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-500">Surname</dt>
                <dd className="mt-0.5 text-slate-900">{displayStr(String(mergedPreview.last_name ?? ''))}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="font-semibold text-slate-500">Email</dt>
                <dd className="mt-0.5 text-slate-900">{displayStr(String(mergedPreview.email ?? ''))}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="font-semibold text-slate-500">Phone</dt>
                <dd className="mt-0.5 text-slate-900">{displayStr(String(mergedPreview.phone ?? ''))}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="font-semibold text-slate-500">Guest profile note</dt>
                <dd className="mt-0.5 whitespace-pre-wrap text-slate-900">{displayStr(String(mergedPreview.customer_profile_notes ?? ''))}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="font-semibold text-slate-500">Tags</dt>
                <dd className="mt-0.5 text-slate-900">
                  {Array.isArray(mergedPreview.tags) && mergedPreview.tags.length > 0
                    ? (mergedPreview.tags as string[]).join(', ')
                    : '—'}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="font-semibold text-slate-500">Marketing</dt>
                <dd className="mt-0.5 text-slate-900">
                  {marketingLabel(Boolean(mergedPreview.marketing_opt_out), Boolean(mergedPreview.marketing_consent))}
                </dd>
              </div>
            </dl>
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-4">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setErr(null);
              if (step === 1) {
                onClose();
                return;
              }
              if (step === 2) {
                setStep(1);
                return;
              }
              if (step === 3) {
                setStep(2);
                return;
              }
              setStep(3);
            }}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {step === 1 ? 'Cancel' : 'Back'}
          </button>
          <div className="flex gap-2">
            {step === 1 ? (
              <button
                type="button"
                disabled={!sourceGuest || Boolean(targetLoadErr) || busy}
                onClick={() => {
                  setChoices(defaultMergeChoices());
                  setStep(2);
                }}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                Continue
              </button>
            ) : null}
            {step === 2 ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => setStep(3)}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
              >
                Continue
              </button>
            ) : null}
            {step === 3 ? (
              <button
                type="button"
                disabled={!choices || busy}
                onClick={() => setStep(4)}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                Review
              </button>
            ) : null}
            {step === 4 ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void submit()}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {busy ? 'Merging…' : 'Merge now'}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
