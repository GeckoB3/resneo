'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ServiceBasicsForm, formatServiceDays } from '@/app/dashboard/availability/components/ServiceBasicsForm';
import { ServiceCapacitySection } from '@/app/dashboard/availability/components/ServiceCapacitySection';
import { ServiceDurationSection } from '@/app/dashboard/availability/components/ServiceDurationSection';
import { ServiceBookingRulesSection } from '@/app/dashboard/availability/components/ServiceBookingRulesSection';
import {
  DAY_LABELS,
  DURATION_SMART_DEFAULTS,
  defaultBookingRestriction,
  defaultCapacityRule,
  emptyService,
  type PartySizeDuration,
  type ServiceBookingRestriction,
  type ServiceCapacityRule,
  type VenueServiceRow,
} from '@/app/dashboard/availability/service-settings-types';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { AvailabilityFormTabSkeleton } from '@/components/ui/dashboard/DashboardSkeletons';
import { detectOverlaps, formatOverlapWarning } from '@/lib/service-overlap';
import { useDebouncedCallback } from '@/lib/use-debounced-callback';

const AUTOSAVE_MS = 650;

function serializeBasicsFields(row: Pick<VenueServiceRow, 'name' | 'days_of_week' | 'start_time' | 'end_time' | 'last_booking_time' | 'is_active' | 'sort_order'>): string {
  return JSON.stringify({
    name: row.name,
    days_of_week: [...row.days_of_week].sort((a, b) => a - b),
    start_time: row.start_time,
    end_time: row.end_time,
    last_booking_time: row.last_booking_time,
    is_active: row.is_active,
    sort_order: row.sort_order,
  });
}

interface Props {
  services: VenueServiceRow[];
  setServices: (s: VenueServiceRow[]) => void;
  selectedAreaId: string | null | undefined;
  showToast: (msg: string) => void;
}

async function createDurationApi(
  serviceId: string,
  minPs: number,
  maxPs: number,
  dur: number,
  dayOfWeek: number | null = null,
): Promise<PartySizeDuration> {
  const res = await fetch('/api/venue/party-size-durations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: serviceId,
      min_party_size: minPs,
      max_party_size: maxPs,
      duration_minutes: dur,
      day_of_week: dayOfWeek,
    }),
  });
  if (!res.ok) throw new Error('Failed to create duration');
  const data = (await res.json()) as { duration: PartySizeDuration };
  return data.duration;
}

export function ServiceSettingsWorkspace({ services, setServices, selectedAreaId, showToast }: Props) {
  const [rules, setRules] = useState<ServiceCapacityRule[]>([]);
  const [durations, setDurations] = useState<PartySizeDuration[]>([]);
  const [restrictions, setRestrictions] = useState<ServiceBookingRestriction[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);

  const [creatingNew, setCreatingNew] = useState(false);
  const [createDraft, setCreateDraft] = useState<Omit<VenueServiceRow, 'id'>>(emptyService());
  const [savingNew, setSavingNew] = useState(false);

  const reloadRelated = useCallback(async () => {
    setLoading(true);
    try {
      const capUrl = selectedAreaId
        ? `/api/venue/capacity-rules?area_id=${encodeURIComponent(selectedAreaId)}`
        : '/api/venue/capacity-rules';
      const durUrl = selectedAreaId
        ? `/api/venue/party-size-durations?area_id=${encodeURIComponent(selectedAreaId)}`
        : '/api/venue/party-size-durations';
      const brUrl = selectedAreaId
        ? `/api/venue/booking-restrictions?area_id=${encodeURIComponent(selectedAreaId)}`
        : '/api/venue/booking-restrictions';

      const [capRes, durRes, brRes] = await Promise.all([fetch(capUrl), fetch(durUrl), fetch(brUrl)]);

      if (capRes.ok) {
        const data = await capRes.json();
        setRules(data.rules ?? []);
      } else {
        setRules([]);
      }
      if (durRes.ok) {
        const data = await durRes.json();
        setDurations(data.durations ?? []);
      } else {
        setDurations([]);
      }
      if (brRes.ok) {
        const data = await brRes.json();
        setRestrictions(data.restrictions ?? []);
      } else {
        setRestrictions([]);
      }
    } finally {
      setLoading(false);
    }
  }, [selectedAreaId]);

  useEffect(() => {
    void reloadRelated();
  }, [reloadRelated]);

  useEffect(() => {
    if (services.length === 0) {
      setSelectedServiceId(null);
      return;
    }
    setSelectedServiceId((id) => {
      if (id && services.some((s) => s.id === id)) return id;
      return services[0]!.id;
    });
  }, [services]);

  const selected = useMemo(() => services.find((s) => s.id === selectedServiceId) ?? null, [services, selectedServiceId]);

  const [basicsDraft, setBasicsDraft] = useState<Omit<VenueServiceRow, 'id'> | null>(null);

  useEffect(() => {
    if (!selected) {
      setBasicsDraft(null);
      return;
    }
    setBasicsDraft({
      name: selected.name,
      days_of_week: [...selected.days_of_week],
      start_time: selected.start_time,
      end_time: selected.end_time,
      last_booking_time: selected.last_booking_time,
      is_active: selected.is_active,
      sort_order: selected.sort_order,
    });
  }, [selected]);

  const rulesForSelected = useMemo(
    () => rules.filter((r) => r.service_id === selectedServiceId),
    [rules, selectedServiceId],
  );
  const durationsForSelected = useMemo(
    () => durations.filter((d) => d.service_id === selectedServiceId),
    [durations, selectedServiceId],
  );
  const restrictionForSelected = useMemo(
    () => restrictions.find((r) => r.service_id === selectedServiceId),
    [restrictions, selectedServiceId],
  );

  const overlapWarnings = useMemo(() => {
    let effective = [...services];
    if (creatingNew && createDraft.name.trim()) {
      effective = [...effective, { ...createDraft, id: '__draft__' } as VenueServiceRow];
    }
    return detectOverlaps(effective);
  }, [services, creatingNew, createDraft]);

  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const basicsDraftRef = useRef(basicsDraft);
  basicsDraftRef.current = basicsDraft;
  const servicesRef = useRef(services);
  servicesRef.current = services;

  const persistBasics = useDebouncedCallback(async () => {
    const sel = selectedRef.current;
    const draft = basicsDraftRef.current;
    if (!sel || !draft) return;
    if (serializeBasicsFields({ ...draft }) === serializeBasicsFields(sel)) return;
    try {
      const res = await fetch('/api/venue/services', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...sel, ...draft }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setServices(servicesRef.current.map((s) => (s.id === sel.id ? data.service : s)));
      if (data.overlapWarnings?.length > 0) {
        showToast(`Service updated — warning: ${data.overlapWarnings[0]}`);
      }
    } catch {
      showToast('Failed to save service');
    }
  }, AUTOSAVE_MS);

  useEffect(() => {
    if (!selected || !basicsDraft) return;
    if (serializeBasicsFields({ ...basicsDraft }) === serializeBasicsFields(selected)) return;
    persistBasics();
  }, [basicsDraft, selected, persistBasics]);

  async function handleToggleActive(service: VenueServiceRow) {
    const updated = { ...service, is_active: !service.is_active };
    try {
      const res = await fetch('/api/venue/services', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setServices(services.map((s) => (s.id === service.id ? data.service : s)));
      if (data.overlapWarnings?.length > 0) {
        showToast(`Service updated - Warning: ${data.overlapWarnings[0]}`);
      }
    } catch {
      showToast('Failed to update service');
    }
  }

  async function handleDeleteService(id: string) {
    if (!confirm('Delete this service? Capacity, duration, and booking settings for it will be removed. This cannot be undone.')) return;
    try {
      const res = await fetch('/api/venue/services', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error();
      setServices(services.filter((s) => s.id !== id));
      setRules((r) => r.filter((x) => x.service_id !== id));
      setDurations((d) => d.filter((x) => x.service_id !== id));
      setRestrictions((br) => br.filter((x) => x.service_id !== id));
      showToast('Service deleted');
    } catch {
      showToast('Failed to delete service');
    }
  }

  function startDuplicate(service: VenueServiceRow) {
    setCreateDraft({
      name: `${service.name} (copy)`,
      days_of_week: [...service.days_of_week],
      start_time: service.start_time,
      end_time: service.end_time,
      last_booking_time: service.last_booking_time,
      is_active: service.is_active,
      sort_order: services.length,
    });
    setCreatingNew(true);
  }

  async function provisionDefaultsForNewService(serviceId: string): Promise<void> {
    const capRes = await fetch('/api/venue/capacity-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(defaultCapacityRule(serviceId)),
    });
    if (!capRes.ok) throw new Error('capacity');
    const capJson = await capRes.json();
    const capRule = capJson.rule as ServiceCapacityRule;

    const createdDurations: PartySizeDuration[] = [];
    for (const { min, max, dur } of DURATION_SMART_DEFAULTS) {
      createdDurations.push(await createDurationApi(serviceId, min, max, dur));
    }

    const brRes = await fetch('/api/venue/booking-restrictions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(defaultBookingRestriction(serviceId)),
    });
    if (!brRes.ok) throw new Error('booking rules');
    const brJson = await brRes.json();
    const restriction = brJson.restriction as ServiceBookingRestriction;

    setRules((prev) => [...prev, capRule]);
    setDurations((prev) => [...prev, ...createdDurations]);
    setRestrictions((prev) => [...prev, restriction]);
  }

  async function handleCreateService() {
    setSavingNew(true);
    try {
      const res = await fetch('/api/venue/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...createDraft,
          sort_order: services.length,
          ...(selectedAreaId ? { area_id: selectedAreaId } : {}),
        }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const newSvc = data.service as VenueServiceRow;
      setServices([...services, newSvc]);
      await provisionDefaultsForNewService(newSvc.id);
      setCreatingNew(false);
      setCreateDraft(emptyService());
      setSelectedServiceId(newSvc.id);
      if (data.overlapWarnings?.length > 0) {
        showToast(`Service created - Warning: ${data.overlapWarnings[0]}`);
      } else {
        showToast('Service created with default capacity, durations, and booking rules');
      }
    } catch {
      showToast('Failed to create service');
    } finally {
      setSavingNew(false);
    }
  }

  function serviceSummary(s: VenueServiceRow) {
    const rc = rules.filter((r) => r.service_id === s.id).length;
    const dc = durations.filter((d) => d.service_id === s.id).length;
    const hasBr = restrictions.some((r) => r.service_id === s.id);
    return { rc, dc, hasBr };
  }

  const updateRulesForService = useCallback(
    (nextForService: ServiceCapacityRule[]) => {
      if (!selectedServiceId) return;
      setRules((prev) => [...prev.filter((r) => r.service_id !== selectedServiceId), ...nextForService]);
    },
    [selectedServiceId],
  );

  const updateDurationsForService = useCallback(
    (nextForService: PartySizeDuration[]) => {
      if (!selectedServiceId) return;
      setDurations((prev) => [...prev.filter((d) => d.service_id !== selectedServiceId), ...nextForService]);
    },
    [selectedServiceId],
  );

  const onRestrictionSaved = useCallback((r: ServiceBookingRestriction) => {
    setRestrictions((prev) => {
      const idx = prev.findIndex((x) => x.service_id === r.service_id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = r;
        return next;
      }
      return [...prev, r];
    });
  }, []);

  if (loading && services.length === 0) {
    return (
      <div className="space-y-4 p-2">
        <AvailabilityFormTabSkeleton />
        <AvailabilityFormTabSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionCard>
        <SectionCard.Header
          eyebrow="Dining services"
          title="Configure each bookable period end-to-end"
          description="Pick a service and work through schedule, capacity, durations, and booking rules — changes save automatically as you edit. Switch dining area above when your venue has multiple spaces."
          right={
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
              {services.filter((s) => s.is_active).length} active
            </span>
          }
        />
      </SectionCard>

      <div className="xl:grid xl:grid-cols-[minmax(280px,340px)_minmax(0,1fr)] xl:items-start xl:gap-8">
        <aside className="space-y-3 xl:sticky xl:top-6">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Services</p>
            <p className="text-[11px] text-slate-400 xl:hidden">Swipe to switch</p>
          </div>
          <div className="flex gap-2 overflow-x-auto rounded-2xl border border-slate-200 bg-slate-50/80 p-2 xl:max-h-[min(70vh,560px)] xl:flex-col xl:overflow-y-auto xl:overflow-x-visible">
            {services.map((s) => {
              const { rc, dc, hasBr } = serviceSummary(s);
              const active = selectedServiceId === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedServiceId(s.id)}
                  className={`min-w-[240px] rounded-xl border px-3 py-3 text-left transition sm:min-w-[280px] xl:w-full xl:min-w-0 ${
                    active ? 'border-brand-400 bg-white shadow-sm ring-2 ring-brand-100' : 'border-transparent bg-white hover:border-slate-200'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-slate-900">{s.name}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${s.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                      {s.is_active ? 'On' : 'Off'}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-slate-500">
                    {formatServiceDays(s.days_of_week)} · {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
                  </p>
                  <p className="mt-2 text-[11px] text-slate-500">
                    {rc} capacity · {dc} durations · booking {hasBr ? 'set' : '—'}
                  </p>
                </button>
              );
            })}
          </div>

          {!creatingNew ? (
            <button
              type="button"
              onClick={() => {
                setCreatingNew(true);
                setCreateDraft(emptyService());
              }}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 bg-white py-4 text-sm font-semibold text-slate-500 transition-colors hover:border-brand-300 hover:bg-brand-50/30 hover:text-brand-700"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Add service
            </button>
          ) : null}
        </aside>

        <div className="mt-8 min-w-0 space-y-6 xl:mt-0">
          {creatingNew && (
            <div className="space-y-5 rounded-2xl border border-brand-200 bg-white p-5 shadow-sm ring-4 ring-brand-50">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">New service</p>
                <h3 className="mt-1 text-lg font-bold text-slate-900">Add a bookable dining period</h3>
                <p className="mt-1 text-sm text-slate-500">
                  We will add default capacity, smart duration bands, and booking rules so you can tweak everything below.
                </p>
              </div>
              <ServiceBasicsForm data={createDraft} onChange={setCreateDraft} />
              <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                <button type="button" onClick={() => void handleCreateService()} disabled={savingNew || !createDraft.name.trim()} className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50">
                  {savingNew ? 'Creating...' : 'Create service'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreatingNew(false);
                    setCreateDraft(emptyService());
                  }}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {selected && basicsDraft && (
            <>
              <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">{selected.name}</h2>
                  <p className="text-sm text-slate-500">
                    {formatServiceDays(selected.days_of_week)} · Last booking {selected.last_booking_time.slice(0, 5)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => void handleToggleActive(selected)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                    {selected.is_active ? 'Pause' : 'Activate'}
                  </button>
                  <button type="button" onClick={() => startDuplicate(selected)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                    Duplicate
                  </button>
                  <button type="button" onClick={() => void handleDeleteService(selected.id)} className="rounded-xl border border-red-100 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50">
                    Delete
                  </button>
                </div>
              </div>

              <div className="space-y-10 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                <p className="text-xs text-slate-500">Changes save automatically as you edit (about {AUTOSAVE_MS / 1000}s after you stop typing).</p>

                <section className="space-y-4">
                  <h3 className="text-base font-bold text-slate-900">Schedule &amp; name</h3>
                  <ServiceBasicsForm data={basicsDraft} onChange={setBasicsDraft} />
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {DAY_LABELS.map((label, i) => (
                      <span
                        key={i}
                        className={`rounded-lg px-2 py-1 text-[11px] font-semibold ${selected.days_of_week.includes(i) ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-100' : 'bg-slate-50 text-slate-300'}`}
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                </section>

                {loading ? (
                  <div className="space-y-4 py-4">
                    <AvailabilityFormTabSkeleton />
                  </div>
                ) : (
                  <>
                    <ServiceCapacitySection
                      serviceId={selected.id}
                      serviceName={selected.name}
                      rules={rulesForSelected}
                      showToast={showToast}
                      onRulesChange={updateRulesForService}
                    />
                    <ServiceDurationSection
                      serviceId={selected.id}
                      serviceName={selected.name}
                      durations={durationsForSelected}
                      showToast={showToast}
                      onDurationsChange={updateDurationsForService}
                    />
                    <ServiceBookingRulesSection
                      key={selected.id}
                      serviceId={selected.id}
                      restriction={restrictionForSelected}
                      showToast={showToast}
                      onRestrictionSaved={onRestrictionSaved}
                    />
                  </>
                )}
              </div>
            </>
          )}

          {!selected && !creatingNew && services.length === 0 && (
            <div className="rounded-2xl border border-dashed border-brand-200 bg-brand-50/40 p-8 text-center">
              <p className="text-sm font-semibold text-slate-900">Create your first service</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
                Most restaurants start with Lunch and Dinner. Use Add service to define bookable periods for this dining area.
              </p>
            </div>
          )}
        </div>
      </div>

      {overlapWarnings.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="mb-2 text-sm font-semibold text-amber-800">Overlapping services detected</p>
          <ul className="space-y-1 text-xs text-amber-700">
            {overlapWarnings.map((w, i) => (
              <li key={i}>{formatOverlapWarning(w)}</li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-amber-600">
            Overlapping services can cause duplicate time slots and capacity issues. Adjust times or active days unless this is intentional.
          </p>
        </div>
      )}
    </div>
  );
}
