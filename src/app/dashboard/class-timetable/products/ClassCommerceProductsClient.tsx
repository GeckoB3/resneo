'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ConfirmDialog } from '@/components/ui/primitives/ConfirmDialog';

type Tab = 'credits' | 'courses' | 'memberships';

interface ClassTypeOption {
  id: string;
  name: string;
  is_active?: boolean;
}

interface ClassInstanceOption {
  id: string;
  class_type_id: string;
  instance_date: string;
  start_time: string;
  booked_spots?: number | null;
  is_cancelled?: boolean;
}

interface CreditProduct {
  id: string;
  name: string;
  description: string | null;
  credits_count: number;
  price_pence: number;
  currency: string;
  validity_days: number | null;
  eligible_class_type_ids: string[] | null;
  active: boolean;
}

interface CourseProduct {
  id: string;
  name: string;
  description: string | null;
  price_pence: number;
  currency: string;
  max_enrollments: number | null;
  opens_at: string | null;
  closes_at: string | null;
  session_instance_ids: string[];
  cancellation_window_days: number | null;
  active: boolean;
}

interface MembershipRules {
  allowance_per_period?: number | null;
  unlimited?: boolean;
  rollover?: boolean;
  rollover_limit?: number | null;
  discount_percent?: number | null;
  eligible_class_type_ids?: string[] | null;
  allow_recurring?: boolean;
  members_only_priority_hours?: number | null;
  booking_window_days?: number | null;
  recurring_interval?: 'week' | 'month' | 'year';
  recurring_interval_count?: number;
}

interface MembershipProduct {
  id: string;
  name: string;
  description: string | null;
  stripe_price_id: string | null;
  stripe_product_id?: string | null;
  currency: string;
  rules: MembershipRules;
  active: boolean;
}

const FIELD =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100';
const LABEL = 'space-y-1 text-xs font-medium text-slate-600';

function money(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

function pricePence(value: FormDataEntryValue | null): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function optionalText(value: FormDataEntryValue | null): string | null {
  const s = String(value ?? '').trim();
  return s.length > 0 ? s : null;
}

function optionalInt(value: FormDataEntryValue | null): number | null {
  const s = String(value ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function isoFromDatetimeLocal(value: FormDataEntryValue | null): string | null {
  const s = String(value ?? '').trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function datetimeLocalValue(value: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function selectedValues(fd: FormData, name: string): string[] | null {
  const values = fd.getAll(name).map((v) => String(v)).filter(Boolean);
  return values.length > 0 ? values : null;
}

function classLabel(classTypes: ClassTypeOption[], id: string): string {
  return classTypes.find((ct) => ct.id === id)?.name ?? 'Class';
}

function instanceLabel(instances: ClassInstanceOption[], classTypes: ClassTypeOption[], id: string): string {
  const inst = instances.find((i) => i.id === id);
  if (!inst) return id.slice(0, 8);
  return `${classLabel(classTypes, inst.class_type_id)} - ${inst.instance_date} ${String(inst.start_time).slice(0, 5)}`;
}

function activeBadge(active: boolean) {
  return active ? (
    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">Active</span>
  ) : (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">Archived</span>
  );
}

function SectionIntro({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-slate-600">{children}</p>
    </div>
  );
}

function ClassTypeMultiSelect({
  name,
  classTypes,
  defaultValue,
  help,
}: {
  name: string;
  classTypes: ClassTypeOption[];
  defaultValue?: string[] | null;
  help?: string;
}) {
  return (
    <label className={LABEL}>
      Eligible classes
      <select name={name} multiple defaultValue={defaultValue ?? []} className={`${FIELD} min-h-28`}>
        {classTypes.map((ct) => (
          <option key={ct.id} value={ct.id}>
            {ct.name}
          </option>
        ))}
      </select>
      <span className="block text-[11px] font-normal text-slate-500">
        {help ?? 'Leave empty for all classes. Hold Ctrl/Cmd to choose more than one.'}
      </span>
    </label>
  );
}

function ClassTypeMultiSelectControlled({
  classTypes,
  value,
  onChange,
  help,
}: {
  classTypes: ClassTypeOption[];
  value: string[];
  onChange: (next: string[]) => void;
  help?: string;
}) {
  return (
    <label className={LABEL}>
      Eligible classes
      <select
        multiple
        value={value}
        onChange={(e) => {
          const selected: string[] = [];
          for (const opt of Array.from(e.target.selectedOptions)) selected.push(opt.value);
          onChange(selected);
        }}
        className={`${FIELD} min-h-28`}
      >
        {classTypes.map((ct) => (
          <option key={ct.id} value={ct.id}>
            {ct.name}
          </option>
        ))}
      </select>
      <span className="block text-[11px] font-normal text-slate-500">
        {help ?? 'Leave empty for all classes. Hold Ctrl/Cmd to choose more than one.'}
      </span>
    </label>
  );
}

function defaultDateRangeYmd(): { from: string; to: string } {
  const today = new Date();
  const toDate = new Date(today);
  toDate.setUTCDate(toDate.getUTCDate() + 90);
  return {
    from: today.toISOString().slice(0, 10),
    to: toDate.toISOString().slice(0, 10),
  };
}

function SessionMultiSelect({
  instances,
  classTypes,
  defaultValue,
}: {
  instances: ClassInstanceOption[];
  classTypes: ClassTypeOption[];
  defaultValue?: string[];
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(defaultValue ?? []));
  const [filterClassTypeId, setFilterClassTypeId] = useState<string>('');
  const initialRange = useMemo(() => defaultDateRangeYmd(), []);
  const [fromDate, setFromDate] = useState<string>(initialRange.from);
  const [toDate, setToDate] = useState<string>(initialRange.to);

  // Visible = instances matching class-type filter (if set) AND within date range.
  const visible = useMemo(() => {
    return instances.filter((inst) => {
      if (filterClassTypeId && inst.class_type_id !== filterClassTypeId) return false;
      if (fromDate && inst.instance_date < fromDate) return false;
      if (toDate && inst.instance_date > toDate) return false;
      return true;
    });
  }, [instances, filterClassTypeId, fromDate, toDate]);

  // Group visible instances by class type (preserve class-type order from `classTypes`).
  const grouped = useMemo(() => {
    const buckets = new Map<string, ClassInstanceOption[]>();
    for (const inst of visible) {
      const arr = buckets.get(inst.class_type_id) ?? [];
      arr.push(inst);
      buckets.set(inst.class_type_id, arr);
    }
    // Sort each bucket by date+time ascending.
    for (const arr of buckets.values()) {
      arr.sort((a, b) => {
        if (a.instance_date !== b.instance_date) return a.instance_date < b.instance_date ? -1 : 1;
        return String(a.start_time).localeCompare(String(b.start_time));
      });
    }
    // Order groups by class-type name.
    const out: Array<{ classType: ClassTypeOption | null; rows: ClassInstanceOption[] }> = [];
    const seen = new Set<string>();
    for (const ct of classTypes) {
      const rows = buckets.get(ct.id);
      if (rows && rows.length > 0) {
        out.push({ classType: ct, rows });
        seen.add(ct.id);
      }
    }
    // Catch any orphan groups whose class type isn't in `classTypes`.
    for (const [id, rows] of buckets.entries()) {
      if (!seen.has(id)) out.push({ classType: null, rows });
    }
    return out;
  }, [visible, classTypes]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const visibleIds = useMemo(() => new Set(visible.map((i) => i.id)), [visible]);
  const allVisibleSelected = visible.length > 0 && visible.every((i) => selected.has(i.id));

  function selectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of visibleIds) next.add(id);
      return next;
    });
  }
  function clearVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of visibleIds) next.delete(id);
      return next;
    });
  }
  function clearAll() {
    setSelected(new Set());
  }

  const selectedCount = selected.size;

  return (
    <div className={LABEL}>
      <div className="flex items-baseline justify-between gap-2">
        <span>Included sessions</span>
        <span className="text-[11px] font-normal text-slate-500">
          {selectedCount} selected
        </span>
      </div>

      <div className="mt-1 grid gap-2 sm:grid-cols-3">
        <select
          value={filterClassTypeId}
          onChange={(e) => setFilterClassTypeId(e.target.value)}
          className={FIELD}
        >
          <option value="">All class types</option>
          {classTypes.map((ct) => (
            <option key={ct.id} value={ct.id}>
              {ct.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          className={FIELD}
        />
        <input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          className={FIELD}
        />
      </div>

      <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
        {visible.length > 0 ? (
          <button
            type="button"
            onClick={() => (allVisibleSelected ? clearVisible() : selectAllVisible())}
            className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-50"
          >
            {allVisibleSelected ? 'Deselect visible' : 'Select all visible'}
          </button>
        ) : null}
        {selectedCount > 0 ? (
          <button
            type="button"
            onClick={clearAll}
            className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-50"
          >
            Clear selection
          </button>
        ) : null}
      </div>

      <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2">
        {grouped.length === 0 ? (
          <p className="px-1 py-2 text-sm text-slate-500">
            No sessions in this range. Adjust the filters or add sessions to the timetable first.
          </p>
        ) : (
          grouped.map((g, idx) => (
            <div key={g.classType?.id ?? `orphan-${idx}`} className="mb-2 last:mb-0">
              <div className="px-1 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {g.classType?.name ?? 'Other'}
              </div>
              <ul className="space-y-0.5">
                {g.rows.map((inst) => {
                  const checked = selected.has(inst.id);
                  const time = String(inst.start_time).slice(0, 5);
                  const booked = inst.booked_spots ?? 0;
                  return (
                    <li key={inst.id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(inst.id)}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                        <span className="flex-1 text-slate-800">
                          {inst.instance_date} · {time}
                        </span>
                        <span className="text-[11px] text-slate-500">
                          {booked} booked
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>

      <span className="block text-[11px] font-normal text-slate-500">
        Pick the sessions that make up this course. Filters narrow the list; selections persist across filter changes.
      </span>

      {/* Hidden inputs so the existing FormData-driven submit still picks up the selection. */}
      {Array.from(selected).map((id) => (
        <input key={id} type="hidden" name="session_instance_ids" value={id} />
      ))}
    </div>
  );
}

function QuickTemplateButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
    >
      {children}
    </button>
  );
}

export function ClassCommerceProductsClient({ venueId }: { venueId: string }) {
  const [tab, setTab] = useState<Tab>('credits');
  const [creditProducts, setCreditProducts] = useState<CreditProduct[]>([]);
  const [courseProducts, setCourseProducts] = useState<CourseProduct[]>([]);
  const [membershipProducts, setMembershipProducts] = useState<MembershipProduct[]>([]);
  const [classTypes, setClassTypes] = useState<ClassTypeOption[]>([]);
  const [instances, setInstances] = useState<ClassInstanceOption[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<
    | {
        path: string;
        label: string;
      }
    | null
  >(null);
  const [productSearch, setProductSearch] = useState('');
  const [metrics, setMetrics] = useState<{
    outstanding_credit_units: number;
    checkout_amount_pence_30d: number;
  } | null>(null);

  const activeCreditCount = useMemo(() => creditProducts.filter((p) => p.active).length, [creditProducts]);
  const activeCourseCount = useMemo(() => courseProducts.filter((p) => p.active).length, [courseProducts]);
  const activeMembershipCount = useMemo(() => membershipProducts.filter((p) => p.active).length, [membershipProducts]);

  const searchQ = productSearch.trim().toLowerCase();
  const filteredCreditProducts = useMemo(
    () => creditProducts.filter((p) => !searchQ || p.name.toLowerCase().includes(searchQ)),
    [creditProducts, searchQ],
  );
  const filteredCourseProducts = useMemo(
    () => courseProducts.filter((p) => !searchQ || p.name.toLowerCase().includes(searchQ)),
    [courseProducts, searchQ],
  );
  const filteredMembershipProducts = useMemo(
    () => membershipProducts.filter((p) => !searchQ || p.name.toLowerCase().includes(searchQ)),
    [membershipProducts, searchQ],
  );

  const reload = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const [c, co, m, classes] = await Promise.all([
        fetch('/api/venue/class-credit-products'),
        fetch('/api/venue/class-course-products'),
        fetch('/api/venue/class-membership-products'),
        fetch('/api/venue/classes'),
      ]);
      const [cj, coj, mj, classJson] = await Promise.all([c.json(), co.json(), m.json(), classes.json()]);
      if (!c.ok) throw new Error(cj.error ?? 'Failed to load credit products');
      if (!co.ok) throw new Error(coj.error ?? 'Failed to load course products');
      if (!m.ok) throw new Error(mj.error ?? 'Failed to load membership products');
      if (!classes.ok) throw new Error(classJson.error ?? 'Failed to load class setup');
      setCreditProducts((cj.products ?? []) as CreditProduct[]);
      setCourseProducts((coj.products ?? []) as CourseProduct[]);
      setMembershipProducts((mj.products ?? []) as MembershipProduct[]);
      setClassTypes((classJson.class_types ?? []) as ClassTypeOption[]);
      setInstances(
        ((classJson.instances ?? []) as ClassInstanceOption[]).filter((i) => !i.is_cancelled),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setBusy(false);
      setInitialLoadDone(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/venue/class-commerce-reports');
        const data = await res.json();
        if (!res.ok) return;
        setMetrics({
          outstanding_credit_units: data.outstanding_credit_units ?? 0,
          checkout_amount_pence_30d: data.checkout_amount_pence_30d ?? 0,
        });
      } catch {
        setMetrics(null);
      }
    })();
  }, []);

  async function save(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: Record<string, unknown>) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const res = await fetch(path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Save failed');
      await reload();
      setNotice('Saved.');
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  function deleteProduct(path: string, label: string) {
    setConfirmDelete({ path, label });
  }

  function creditPayload(fd: FormData) {
    return {
      name: String(fd.get('name') ?? '').trim(),
      description: optionalText(fd.get('description')),
      credits_count: Number(fd.get('credits_count') ?? 0),
      price_pence: pricePence(fd.get('price')),
      validity_days: optionalInt(fd.get('validity_days')),
      eligible_class_type_ids: selectedValues(fd, 'eligible_class_type_ids'),
      currency: 'gbp',
      active: fd.get('active') === 'on',
    };
  }

  function coursePayload(fd: FormData) {
    const cancellationRaw = String(fd.get('cancellation_window_days') ?? '').trim();
    let cancellation_window_days: number | null = null;
    if (cancellationRaw !== '') {
      const n = Number(cancellationRaw);
      cancellation_window_days = Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
    }
    return {
      name: String(fd.get('name') ?? '').trim(),
      description: optionalText(fd.get('description')),
      price_pence: pricePence(fd.get('price')),
      max_enrollments: optionalInt(fd.get('max_enrollments')),
      opens_at: isoFromDatetimeLocal(fd.get('opens_at')),
      closes_at: isoFromDatetimeLocal(fd.get('closes_at')),
      session_instance_ids: selectedValues(fd, 'session_instance_ids') ?? [],
      cancellation_window_days,
      currency: 'gbp',
      active: fd.get('active') === 'on',
    };
  }

  function membershipPayload(fd: FormData) {
    const unlimited = fd.get('unlimited') === 'on';
    const rules: MembershipRules = {
      unlimited,
      allowance_per_period: unlimited ? null : optionalInt(fd.get('allowance_per_period')),
      rollover: fd.get('rollover') === 'on',
      rollover_limit: optionalInt(fd.get('rollover_limit')),
      discount_percent: optionalInt(fd.get('discount_percent')),
      eligible_class_type_ids: selectedValues(fd, 'eligible_class_type_ids'),
      allow_recurring: fd.get('allow_recurring') === 'on',
      members_only_priority_hours: optionalInt(fd.get('members_only_priority_hours')),
      booking_window_days: optionalInt(fd.get('booking_window_days')),
    };
    const stripeManual = optionalText(fd.get('stripe_price_id'));
    const recurringPricePence = pricePence(fd.get('recurring_price'));
    const recurringInterval = String(fd.get('recurring_interval') ?? '').trim() as 'week' | 'month' | 'year' | '';
    const recurringCount = Math.max(1, Number(fd.get('recurring_interval_count') ?? 1) || 1);

    const out: Record<string, unknown> = {
      name: String(fd.get('name') ?? '').trim(),
      description: optionalText(fd.get('description')),
      currency: 'gbp',
      rules,
      active: fd.get('active') === 'on',
    };

    if (stripeManual) {
      out.stripe_price_id = stripeManual;
    }

    if (recurringPricePence > 0 && (recurringInterval === 'week' || recurringInterval === 'month' || recurringInterval === 'year')) {
      out.recurring_price_pence = recurringPricePence;
      out.recurring_interval = recurringInterval;
      out.recurring_interval_count = recurringCount;
      rules.recurring_interval = recurringInterval;
      rules.recurring_interval_count = recurringCount;
    }

    out.rules = rules;
    return out;
  }

  async function createCreditPack(payload: Record<string, unknown>) {
    await save('/api/venue/class-credit-products', 'POST', payload);
  }

  async function createCourse(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await save('/api/venue/class-course-products', 'POST', coursePayload(new FormData(e.currentTarget)));
    e.currentTarget.reset();
  }

  async function createMembership(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await save('/api/venue/class-membership-products', 'POST', membershipPayload(new FormData(e.currentTarget)));
    e.currentTarget.reset();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/dashboard/class-timetable" className="text-sm font-medium text-brand-600 hover:underline">
            &larr; Back to timetable
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">Class products</h1>
          <p className="mt-1 text-sm text-slate-600">
            Build sellable packs, courses, and memberships for your class schedule. Venue {venueId.slice(0, 8)}.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void reload()}
          disabled={busy}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
        >
          {busy ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}
      {notice ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {notice}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="Active credit packs" value={activeCreditCount} detail={`${creditProducts.length} total`} />
        <MetricCard label="Active courses" value={activeCourseCount} detail={`${courseProducts.length} total`} />
        <MetricCard label="Active memberships" value={activeMembershipCount} detail={`${membershipProducts.length} total`} />
      </div>

      {metrics ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <MetricCard
            label="Outstanding class credits"
            value={metrics.outstanding_credit_units}
            detail="Remaining units across guest balances."
          />
          <MetricCard
            label="Class checkout (30 days)"
            value={money(metrics.checkout_amount_pence_30d)}
            detail="Class-commerce PaymentIntent total."
          />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        {(['credits', 'courses', 'memberships'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${
              tab === t ? 'bg-brand-600 text-white shadow-sm' : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            {t === 'credits' ? 'Credit packs' : t === 'courses' ? 'Courses' : 'Memberships'}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="min-w-[200px] flex-1 text-xs font-medium text-slate-600">
          Search products
          <input
            type="search"
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
            placeholder="Filter by name…"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
      </div>

      {tab === 'credits' && (
        <CreditPackPanel
          products={filteredCreditProducts}
          classTypes={classTypes}
          editing={editing}
          setEditing={setEditing}
          busy={busy}
          initialLoading={!initialLoadDone}
          onCreate={createCreditPack}
          onPatch={(id, patch) => save(`/api/venue/class-credit-products/${id}`, 'PATCH', patch)}
          onDelete={(id, label) => deleteProduct(`/api/venue/class-credit-products/${id}`, label)}
          creditPayload={creditPayload}
        />
      )}

      {tab === 'courses' && (
        <CoursePanel
          products={filteredCourseProducts}
          classTypes={classTypes}
          instances={instances}
          editing={editing}
          setEditing={setEditing}
          busy={busy}
          initialLoading={!initialLoadDone}
          onCreate={createCourse}
          onPatch={(id, patch) => save(`/api/venue/class-course-products/${id}`, 'PATCH', patch)}
          onDelete={(id, label) => deleteProduct(`/api/venue/class-course-products/${id}`, label)}
          coursePayload={coursePayload}
        />
      )}

      {tab === 'memberships' && (
        <MembershipPanel
          products={filteredMembershipProducts}
          classTypes={classTypes}
          editing={editing}
          setEditing={setEditing}
          busy={busy}
          initialLoading={!initialLoadDone}
          onCreate={createMembership}
          onPatch={(id, patch) => save(`/api/venue/class-membership-products/${id}`, 'PATCH', patch)}
          onDelete={(id, label) => deleteProduct(`/api/venue/class-membership-products/${id}`, label)}
          membershipPayload={membershipPayload}
        />
      )}

      <ConfirmDialog
        open={confirmDelete != null}
        onOpenChange={(next) => {
          if (!next) setConfirmDelete(null);
        }}
        title="Delete product"
        message={
          confirmDelete
            ? `Delete ${confirmDelete.label}? Archive it instead if guests have used it before.`
            : ''
        }
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (confirmDelete) {
            const target = confirmDelete;
            setConfirmDelete(null);
            void save(target.path, 'DELETE');
          }
        }}
      />
    </div>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: React.ReactNode; detail: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-600">{detail}</p>
    </div>
  );
}

function CreditPackPanel({
  products,
  classTypes,
  editing,
  setEditing,
  busy,
  initialLoading = false,
  onCreate,
  onPatch,
  onDelete,
  creditPayload,
}: {
  products: CreditProduct[];
  classTypes: ClassTypeOption[];
  editing: string | null;
  setEditing: (id: string | null) => void;
  busy: boolean;
  initialLoading?: boolean;
  onCreate: (payload: Record<string, unknown>) => void;
  onPatch: (id: string, patch: Record<string, unknown>) => void;
  onDelete: (id: string, label: string) => void;
  creditPayload: (fd: FormData) => Record<string, unknown>;
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.4fr)]">
      <div className="space-y-4">
        <SectionIntro title="Create a credit pack">
          Sell packs such as 5-class intro offers, 10-class passes, or class-type-specific credits with expiry rules.
        </SectionIntro>
        <CreditPackCreateForm classTypes={classTypes} busy={busy} onSubmit={onCreate} />
      </div>

      <div className="space-y-3">
        {initialLoading && products.length === 0 ? (
          <SkeletonProductList count={3} />
        ) : products.length === 0 ? (
          <EmptyProductState title="No credit packs yet" copy="Create an intro offer or class pass to start selling prepaid sessions." />
        ) : (
          products.map((p) => (
            <ProductCard key={p.id} active={p.active} title={p.name} subtitle={`${p.credits_count} credits - ${money(p.price_pence)}`}>
              <ProductMeta>
                {p.validity_days ? `${p.validity_days} day expiry` : 'No expiry'} ·{' '}
                {p.eligible_class_type_ids?.length
                  ? `${p.eligible_class_type_ids.length} eligible class type(s)`
                  : 'All classes'}
              </ProductMeta>
              {p.description ? <p className="mt-2 text-sm text-slate-600">{p.description}</p> : null}
              <ProductActions
                active={p.active}
                editing={editing === `credit:${p.id}`}
                onEdit={() => setEditing(editing === `credit:${p.id}` ? null : `credit:${p.id}`)}
                onArchive={() => onPatch(p.id, { active: !p.active })}
                onDelete={() => onDelete(p.id, p.name)}
              />
              {editing === `credit:${p.id}` ? (
                <form
                  onSubmit={(ev) => {
                    ev.preventDefault();
                    onPatch(p.id, creditPayload(new FormData(ev.currentTarget)));
                  }}
                  className="mt-4 space-y-4 rounded-xl bg-slate-50 p-4"
                >
                  <CreditPackFields product={p} classTypes={classTypes} />
                  <button disabled={busy} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                    Save changes
                  </button>
                </form>
              ) : null}
            </ProductCard>
          ))
        )}
      </div>
    </div>
  );
}

interface CreditFormState {
  name: string;
  description: string;
  credits_count: string;
  price: string;
  validity_days: string;
  eligible_class_type_ids: string[];
  active: boolean;
}

const EMPTY_CREDIT_STATE: CreditFormState = {
  name: '',
  description: '',
  credits_count: '10',
  price: '',
  validity_days: '',
  eligible_class_type_ids: [],
  active: true,
};

function creditStateToPayload(s: CreditFormState): Record<string, unknown> {
  const credits = Number(s.credits_count);
  const priceNum = Number(s.price);
  const validityNum = s.validity_days ? Number(s.validity_days) : null;
  return {
    name: s.name.trim(),
    description: s.description.trim() || null,
    credits_count: Number.isFinite(credits) ? credits : 0,
    price_pence:
      Number.isFinite(priceNum) && priceNum >= 0 ? Math.round(priceNum * 100) : 0,
    validity_days:
      validityNum != null && Number.isFinite(validityNum) && validityNum > 0
        ? Math.round(validityNum)
        : null,
    eligible_class_type_ids:
      s.eligible_class_type_ids.length > 0 ? s.eligible_class_type_ids : null,
    currency: 'gbp',
    active: s.active,
  };
}

function CreditPackCreateForm({
  classTypes,
  busy,
  onSubmit,
}: {
  classTypes: ClassTypeOption[];
  busy: boolean;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const [state, setState] = useState<CreditFormState>(EMPTY_CREDIT_STATE);

  return (
    <form
      onSubmit={(ev) => {
        ev.preventDefault();
        onSubmit(creditStateToPayload(state));
        setState(EMPTY_CREDIT_STATE);
      }}
      className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="flex flex-wrap gap-2">
        <QuickTemplateButton
          onClick={() =>
            setState((prev) => ({
              ...prev,
              name: 'Intro 5 Pack',
              credits_count: '5',
              price: '45',
              validity_days: '30',
            }))
          }
        >
          Intro 5 pack
        </QuickTemplateButton>
        <QuickTemplateButton
          onClick={() =>
            setState((prev) => ({
              ...prev,
              name: '10 Class Pass',
              credits_count: '10',
              price: '90',
              validity_days: '90',
            }))
          }
        >
          10 class pass
        </QuickTemplateButton>
      </div>

      <div className="space-y-4">
        <label className={LABEL}>
          Pack name
          <input
            required
            value={state.name}
            onChange={(e) => setState((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="10 Class Pass"
            className={FIELD}
          />
        </label>
        <label className={LABEL}>
          Description
          <textarea
            value={state.description}
            onChange={(e) => setState((prev) => ({ ...prev, description: e.target.value }))}
            placeholder="Great for regular weekly classes."
            className={`${FIELD} min-h-20`}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className={LABEL}>
            Credits
            <input
              type="number"
              min={1}
              required
              value={state.credits_count}
              onChange={(e) => setState((prev) => ({ ...prev, credits_count: e.target.value }))}
              className={FIELD}
            />
          </label>
          <label className={LABEL}>
            Price (GBP)
            <input
              type="number"
              min={0}
              step={0.01}
              required
              value={state.price}
              onChange={(e) => setState((prev) => ({ ...prev, price: e.target.value }))}
              className={FIELD}
            />
          </label>
          <label className={LABEL}>
            Valid for days
            <input
              type="number"
              min={1}
              value={state.validity_days}
              onChange={(e) => setState((prev) => ({ ...prev, validity_days: e.target.value }))}
              placeholder="90"
              className={FIELD}
            />
          </label>
        </div>
        <ClassTypeMultiSelectControlled
          classTypes={classTypes}
          value={state.eligible_class_type_ids}
          onChange={(next) => setState((prev) => ({ ...prev, eligible_class_type_ids: next }))}
        />
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={state.active}
            onChange={(e) => setState((prev) => ({ ...prev, active: e.target.checked }))}
            className="h-4 w-4 rounded border-slate-300"
          />
          Visible and available to buy
        </label>
      </div>
      <button
        disabled={busy}
        className="w-full rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
      >
        Create credit pack
      </button>
    </form>
  );
}

function CreditPackFields({
  product,
  classTypes,
}: {
  product?: CreditProduct;
  classTypes: ClassTypeOption[];
}) {
  return (
    <div className="space-y-4">
      <label className={LABEL}>
        Pack name
        <input name="name" required defaultValue={product?.name ?? ''} placeholder="10 Class Pass" className={FIELD} />
      </label>
      <label className={LABEL}>
        Description
        <textarea
          name="description"
          defaultValue={product?.description ?? ''}
          placeholder="Great for regular weekly classes."
          className={`${FIELD} min-h-20`}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={LABEL}>
          Credits
          <input name="credits_count" type="number" min={1} required defaultValue={product?.credits_count ?? 10} className={FIELD} />
        </label>
        <label className={LABEL}>
          Price (GBP)
          <input name="price" type="number" min={0} step={0.01} required defaultValue={product ? product.price_pence / 100 : ''} className={FIELD} />
        </label>
        <label className={LABEL}>
          Valid for days
          <input name="validity_days" type="number" min={1} defaultValue={product?.validity_days ?? ''} placeholder="90" className={FIELD} />
        </label>
      </div>
      <ClassTypeMultiSelect classTypes={classTypes} name="eligible_class_type_ids" defaultValue={product?.eligible_class_type_ids} />
      <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
        <input name="active" type="checkbox" defaultChecked={product?.active ?? true} className="h-4 w-4 rounded border-slate-300" />
        Visible and available to buy
      </label>
    </div>
  );
}

function CoursePanel({
  products,
  classTypes,
  instances,
  editing,
  setEditing,
  busy,
  initialLoading = false,
  onCreate,
  onPatch,
  onDelete,
  coursePayload,
}: {
  products: CourseProduct[];
  classTypes: ClassTypeOption[];
  instances: ClassInstanceOption[];
  editing: string | null;
  setEditing: (id: string | null) => void;
  busy: boolean;
  initialLoading?: boolean;
  onCreate: (e: React.FormEvent<HTMLFormElement>) => void;
  onPatch: (id: string, patch: Record<string, unknown>) => void;
  onDelete: (id: string, label: string) => void;
  coursePayload: (fd: FormData) => Record<string, unknown>;
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.4fr)]">
      <div className="space-y-4">
        <SectionIntro title="Create a course">
          Bundle fixed sessions with enrollment windows and capacity limits, like a workshop series or 6-week programme.
        </SectionIntro>
        <form onSubmit={(ev) => void onCreate(ev)} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <CourseFields classTypes={classTypes} instances={instances} />
          <button disabled={busy} className="w-full rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
            Create course
          </button>
        </form>
      </div>

      <div className="space-y-3">
        {initialLoading && products.length === 0 ? (
          <SkeletonProductList count={3} />
        ) : products.length === 0 ? (
          <EmptyProductState title="No courses yet" copy="Create a fixed-session course or paid workshop series." />
        ) : (
          products.map((p) => (
            <ProductCard key={p.id} active={p.active} title={p.name} subtitle={`${money(p.price_pence)} - ${p.session_instance_ids.length} sessions`}>
              <ProductMeta>
                {p.max_enrollments ? `${p.max_enrollments} enrollment cap` : 'No enrollment cap'} ·{' '}
                {p.opens_at ? `opens ${new Date(p.opens_at).toLocaleDateString()}` : 'open now'}
                {p.closes_at ? `, closes ${new Date(p.closes_at).toLocaleDateString()}` : ''}
              </ProductMeta>
              {p.session_instance_ids.length > 0 ? (
                <ul className="mt-2 space-y-1 text-xs text-slate-600">
                  {p.session_instance_ids.slice(0, 4).map((id) => (
                    <li key={id}>{instanceLabel(instances, classTypes, id)}</li>
                  ))}
                  {p.session_instance_ids.length > 4 ? <li>+ {p.session_instance_ids.length - 4} more</li> : null}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-amber-700">No sessions selected yet.</p>
              )}
              {p.description ? <p className="mt-2 text-sm text-slate-600">{p.description}</p> : null}
              <ProductActions
                active={p.active}
                editing={editing === `course:${p.id}`}
                onEdit={() => setEditing(editing === `course:${p.id}` ? null : `course:${p.id}`)}
                onArchive={() => onPatch(p.id, { active: !p.active })}
                onDelete={() => onDelete(p.id, p.name)}
                extraButton={
                  <button
                    type="button"
                    onClick={() =>
                      setEditing(editing === `course-enrol:${p.id}` ? null : `course-enrol:${p.id}`)
                    }
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-700 hover:bg-slate-50"
                  >
                    {editing === `course-enrol:${p.id}` ? 'Hide enrollments' : 'View enrollments'}
                  </button>
                }
              />
              {editing === `course:${p.id}` ? (
                <form
                  onSubmit={(ev) => {
                    ev.preventDefault();
                    onPatch(p.id, coursePayload(new FormData(ev.currentTarget)));
                  }}
                  className="mt-4 space-y-4 rounded-xl bg-slate-50 p-4"
                >
                  <CourseFields product={p} classTypes={classTypes} instances={instances} />
                  <button disabled={busy} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                    Save changes
                  </button>
                </form>
              ) : null}
              {editing === `course-enrol:${p.id}` ? (
                <CourseEnrollmentsPanel courseId={p.id} courseName={p.name} instances={instances} classTypes={classTypes} />
              ) : null}
            </ProductCard>
          ))
        )}
      </div>
    </div>
  );
}

function CourseFields({
  product,
  classTypes,
  instances,
}: {
  product?: CourseProduct;
  classTypes: ClassTypeOption[];
  instances: ClassInstanceOption[];
}) {
  return (
    <div className="space-y-4">
      <label className={LABEL}>
        Course name
        <input name="name" required defaultValue={product?.name ?? ''} placeholder="6 Week Beginners Pilates" className={FIELD} />
      </label>
      <label className={LABEL}>
        Description
        <textarea
          name="description"
          defaultValue={product?.description ?? ''}
          placeholder="A fixed programme for a cohort of attendees."
          className={`${FIELD} min-h-20`}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={LABEL}>
          Course price (GBP)
          <input name="price" type="number" min={0} step={0.01} defaultValue={product ? product.price_pence / 100 : ''} className={FIELD} />
        </label>
        <label className={LABEL}>
          Max enrollments
          <input name="max_enrollments" type="number" min={1} defaultValue={product?.max_enrollments ?? ''} placeholder="12" className={FIELD} />
        </label>
        <label className={LABEL}>
          Enrollment opens
          <input name="opens_at" type="datetime-local" defaultValue={datetimeLocalValue(product?.opens_at ?? null)} className={FIELD} />
        </label>
        <label className={LABEL}>
          Enrollment closes
          <input name="closes_at" type="datetime-local" defaultValue={datetimeLocalValue(product?.closes_at ?? null)} className={FIELD} />
        </label>
      </div>
      <SessionMultiSelect instances={instances} classTypes={classTypes} defaultValue={product?.session_instance_ids ?? []} />
      <label className={LABEL}>
        Cancellation window (days)
        <input
          name="cancellation_window_days"
          type="number"
          min={0}
          max={365}
          defaultValue={product?.cancellation_window_days ?? ''}
          placeholder="7"
          className={FIELD}
        />
        <span className="block text-[11px] font-normal text-slate-500">
          How many days before the first session a guest can self-cancel for a full refund. Leave blank for non-refundable.
        </span>
      </label>
      <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
        <input name="active" type="checkbox" defaultChecked={product?.active ?? true} className="h-4 w-4 rounded border-slate-300" />
        Open for enrollment
      </label>
    </div>
  );
}

interface CourseEnrollmentRow {
  id: string;
  user_id: string;
  status: string;
  stripe_payment_intent_id: string | null;
  created_at: string;
  updated_at: string;
  guest: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
  } | null;
}

interface CourseSessionEnrollmentRow {
  id: string;
  enrollment_id: string;
  class_instance_id: string;
  status: string;
}

interface CourseEnrollmentsResponse {
  product: {
    id: string;
    name: string;
    cancellation_window_days: number | null;
    session_instance_ids: string[] | null;
  };
  enrollments: CourseEnrollmentRow[];
  session_enrollments: CourseSessionEnrollmentRow[];
}

const ENROLLMENT_STATUS_BADGES: Record<string, string> = {
  pending_payment: 'bg-amber-100 text-amber-800',
  active: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-slate-200 text-slate-700',
  completed: 'bg-slate-100 text-slate-700',
};

const SESSION_STATUS_BADGES: Record<string, string> = {
  scheduled: 'bg-slate-100 text-slate-700',
  attended: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-slate-200 text-slate-700',
  no_show: 'bg-amber-100 text-amber-800',
};

function guestDisplayName(g: CourseEnrollmentRow['guest']): string {
  if (!g) return 'Guest';
  return [g.first_name, g.last_name].filter(Boolean).join(' ').trim() || g.email || 'Guest';
}

function CourseEnrollmentsPanel({
  courseId,
  courseName,
  instances,
  classTypes,
}: {
  courseId: string;
  courseName: string;
  instances: ClassInstanceOption[];
  classTypes: ClassTypeOption[];
}) {
  const [data, setData] = useState<CourseEnrollmentsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyEnrId, setBusyEnrId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/venue/class-course-products/${encodeURIComponent(courseId)}/enrollments`);
      const json = (await res.json()) as CourseEnrollmentsResponse & { error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Failed to load enrollments');
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function cancelEnrollment(enrId: string, opts: { bypassWindow: boolean; reason?: string }) {
    setBusyEnrId(enrId);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(
        `/api/venue/class-course-products/${encodeURIComponent(courseId)}/enrollments/${encodeURIComponent(enrId)}/cancel`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bypass_window: opts.bypassWindow, cancel_reason: opts.reason ?? null }),
        },
      );
      const json = (await res.json()) as { ok?: boolean; refund_amount_pence?: number; error?: string };
      if (!res.ok) {
        setError(json.error ?? 'Cancel failed');
        return;
      }
      const refunded = json.refund_amount_pence ?? 0;
      setNotice(
        refunded > 0
          ? `Cancelled. Refund of £${(refunded / 100).toFixed(2)} processed.`
          : 'Cancelled (no refund issued).',
      );
      await load();
    } finally {
      setBusyEnrId(null);
    }
  }

  const sessionsByEnrolment = useMemo(() => {
    const map = new Map<string, CourseSessionEnrollmentRow[]>();
    for (const s of data?.session_enrollments ?? []) {
      const arr = map.get(s.enrollment_id) ?? [];
      arr.push(s);
      map.set(s.enrollment_id, arr);
    }
    return map;
  }, [data?.session_enrollments]);

  function instanceLine(id: string): string {
    return instanceLabel(instances, classTypes, id);
  }

  const enrollments = data?.enrollments ?? [];
  const active = enrollments.filter((e) => e.status !== 'cancelled');
  const cancelled = enrollments.filter((e) => e.status === 'cancelled');

  return (
    <div className="mt-4 rounded-xl bg-slate-50 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold text-slate-900">Enrollments — {courseName}</h4>
        <button
          type="button"
          onClick={() => void load()}
          className="text-xs font-semibold text-brand-700 hover:underline"
        >
          Refresh
        </button>
      </div>
      {loading && !data ? <p className="mt-2 text-sm text-slate-500">Loading…</p> : null}
      {error ? (
        <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-800">{error}</p>
      ) : null}
      {notice ? (
        <p className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-900">{notice}</p>
      ) : null}
      {data ? (
        <>
          {enrollments.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No enrollments yet.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {active.map((e) => {
                const sessions = sessionsByEnrolment.get(e.id) ?? [];
                const attended = sessions.filter((s) => s.status === 'attended').length;
                const total = sessions.length;
                const isOpen = expanded === e.id;
                return (
                  <div key={e.id} className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">{guestDisplayName(e.guest)}</p>
                        <p className="text-xs text-slate-500">
                          {e.guest?.email ?? '—'} · enrolled {e.created_at.slice(0, 10)}
                        </p>
                        <p className="mt-1 text-xs text-slate-700">
                          <span
                            className={`mr-1 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                              ENROLLMENT_STATUS_BADGES[e.status] ?? 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {e.status}
                          </span>
                          {total > 0 ? `${attended} / ${total} sessions attended` : 'No sessions linked yet'}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {sessions.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => setExpanded(isOpen ? null : e.id)}
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            {isOpen ? 'Hide sessions' : 'Show sessions'}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={busyEnrId === e.id}
                          onClick={() => {
                            if (
                              !window.confirm(
                                `Cancel ${guestDisplayName(e.guest)}'s enrollment? If within the refund window, their payment will be refunded automatically.`,
                              )
                            ) {
                              return;
                            }
                            void cancelEnrollment(e.id, { bypassWindow: false });
                          }}
                          className="rounded-lg border border-amber-200 bg-white px-2.5 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-50"
                        >
                          {busyEnrId === e.id ? 'Working…' : 'Cancel enrollment'}
                        </button>
                        <button
                          type="button"
                          disabled={busyEnrId === e.id}
                          onClick={() => {
                            const reason = window.prompt('Force-cancel reason (skips refund — handle manually):');
                            if (reason === null) return;
                            void cancelEnrollment(e.id, { bypassWindow: true, reason });
                          }}
                          className="rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          Force-cancel
                        </button>
                      </div>
                    </div>
                    {isOpen && sessions.length > 0 ? (
                      <ul className="mt-2 space-y-1 text-xs text-slate-700">
                        {sessions.map((s) => (
                          <li key={s.id} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2 py-1">
                            <span>{instanceLine(s.class_instance_id)}</span>
                            <span
                              className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                                SESSION_STATUS_BADGES[s.status] ?? 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {s.status}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                );
              })}

              {cancelled.length > 0 ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-semibold text-slate-500">
                    {cancelled.length} cancelled enrollment{cancelled.length === 1 ? '' : 's'}
                  </summary>
                  <ul className="mt-2 space-y-1 text-xs text-slate-500">
                    {cancelled.map((e) => (
                      <li key={e.id}>
                        {guestDisplayName(e.guest)} — cancelled {e.updated_at.slice(0, 10)}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

function MembershipPanel({
  products,
  classTypes,
  editing,
  setEditing,
  busy,
  initialLoading = false,
  onCreate,
  onPatch,
  onDelete,
  membershipPayload,
}: {
  products: MembershipProduct[];
  classTypes: ClassTypeOption[];
  editing: string | null;
  setEditing: (id: string | null) => void;
  busy: boolean;
  initialLoading?: boolean;
  onCreate: (e: React.FormEvent<HTMLFormElement>) => void;
  onPatch: (id: string, patch: Record<string, unknown>) => void;
  onDelete: (id: string, label: string) => void;
  membershipPayload: (fd: FormData) => Record<string, unknown>;
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.4fr)]">
      <div className="space-y-4">
        <SectionIntro title="Create a membership">
          Set recurring billing (ResNeo creates Stripe prices on your connected account) or paste an existing Stripe
          Price ID. Configure access rules, eligible classes, rollover, and discounts.
        </SectionIntro>
        <form onSubmit={(ev) => void onCreate(ev)} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <MembershipFields classTypes={classTypes} />
          <button disabled={busy} className="w-full rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
            Create membership
          </button>
        </form>
      </div>

      <div className="space-y-3">
        {initialLoading && products.length === 0 ? (
          <SkeletonProductList count={3} />
        ) : products.length === 0 ? (
          <EmptyProductState title="No memberships yet" copy="Create a membership plan with session allowances, discounts, or unlimited access." />
        ) : (
          products.map((p) => {
            const rules = p.rules ?? {};
            return (
              <ProductCard key={p.id} active={p.active} title={p.name} subtitle={rules.unlimited ? 'Unlimited classes' : `${rules.allowance_per_period ?? 0} classes per period`}>
                <ProductMeta>
                  {rules.rollover ? `rollover${rules.rollover_limit ? ` up to ${rules.rollover_limit}` : ''}` : 'no rollover'} ·{' '}
                  {rules.discount_percent ? `${rules.discount_percent}% member discount` : 'no discount'} ·{' '}
                  {p.stripe_price_id
                    ? p.stripe_product_id
                      ? 'Stripe billing (auto)'
                      : 'Stripe price connected'
                    : 'needs billing setup'}
                </ProductMeta>
                {p.description ? <p className="mt-2 text-sm text-slate-600">{p.description}</p> : null}
                <ProductActions
                  active={p.active}
                  editing={editing === `membership:${p.id}`}
                  onEdit={() => setEditing(editing === `membership:${p.id}` ? null : `membership:${p.id}`)}
                  onArchive={() => onPatch(p.id, { active: !p.active })}
                  onDelete={() => onDelete(p.id, p.name)}
                />
                {editing === `membership:${p.id}` ? (
                  <form
                    onSubmit={(ev) => {
                      ev.preventDefault();
                      onPatch(p.id, membershipPayload(new FormData(ev.currentTarget)));
                    }}
                    className="mt-4 space-y-4 rounded-xl bg-slate-50 p-4"
                  >
                    <MembershipFields product={p} classTypes={classTypes} />
                    <button disabled={busy} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                      Save changes
                    </button>
                  </form>
                ) : null}
              </ProductCard>
            );
          })
        )}
      </div>
    </div>
  );
}

function MembershipFields({ product, classTypes }: { product?: MembershipProduct; classTypes: ClassTypeOption[] }) {
  const rules = product?.rules ?? {};
  return (
    <div className="space-y-4">
      <label className={LABEL}>
        Membership name
        <input name="name" required defaultValue={product?.name ?? ''} placeholder="Unlimited Monthly" className={FIELD} />
      </label>
      <label className={LABEL}>
        Description
        <textarea
          name="description"
          defaultValue={product?.description ?? ''}
          placeholder="Best for guests who attend multiple times per week."
          className={`${FIELD} min-h-20`}
        />
      </label>
      <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recurring billing</p>
        <p className="mt-1 text-xs text-slate-600">
          Enter a price and interval to auto-create Stripe Product + Price on your venue account, or leave blank and use a
          manual Price ID below.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className={LABEL}>
            Price (£ / period)
            <input name="recurring_price" type="number" min={0} step="0.01" placeholder="49.00" className={FIELD} />
          </label>
          <label className={LABEL}>
            Interval
            <select
              name="recurring_interval"
              defaultValue={product?.rules?.recurring_interval ?? 'month'}
              className={FIELD}
            >
              <option value="week">Weekly</option>
              <option value="month">Monthly</option>
              <option value="year">Yearly</option>
            </select>
          </label>
          <label className={LABEL}>
            Every
            <input
              name="recurring_interval_count"
              type="number"
              min={1}
              max={12}
              defaultValue={product?.rules?.recurring_interval_count ?? 1}
              className={FIELD}
            />
            <span className="block text-[11px] font-normal text-slate-500">e.g. 1 = each month</span>
          </label>
        </div>
      </div>
      <label className={LABEL}>
        Manual Stripe Price ID (optional)
        <input name="stripe_price_id" defaultValue={product?.stripe_price_id ?? ''} placeholder="price_..." className={FIELD} />
        <span className="block text-[11px] font-normal text-slate-500">
          Overrides auto-billing when set. Must exist on the venue connected Stripe account.
        </span>
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={LABEL}>
          Classes per period
          <input
            name="allowance_per_period"
            type="number"
            min={0}
            defaultValue={rules.allowance_per_period ?? ''}
            placeholder="8"
            className={FIELD}
          />
        </label>
        <label className={LABEL}>
          Rollover limit
          <input name="rollover_limit" type="number" min={0} defaultValue={rules.rollover_limit ?? ''} placeholder="4" className={FIELD} />
        </label>
        <label className={LABEL}>
          Member discount %
          <input name="discount_percent" type="number" min={0} max={100} defaultValue={rules.discount_percent ?? ''} placeholder="10" className={FIELD} />
        </label>
        <label className={LABEL}>
          Booking window days
          <input name="booking_window_days" type="number" min={1} defaultValue={rules.booking_window_days ?? ''} placeholder="30" className={FIELD} />
        </label>
        <label className={LABEL}>
          Priority hours
          <input
            name="members_only_priority_hours"
            type="number"
            min={0}
            defaultValue={rules.members_only_priority_hours ?? ''}
            placeholder="24"
            className={FIELD}
          />
        </label>
      </div>
      <ClassTypeMultiSelect
        classTypes={classTypes}
        name="eligible_class_type_ids"
        defaultValue={rules.eligible_class_type_ids ?? null}
        help="Leave empty for all classes, or limit this membership to selected class types."
      />
      <div className="grid gap-2 text-sm font-medium text-slate-700 sm:grid-cols-2">
        <label className="flex items-center gap-2">
          <input name="unlimited" type="checkbox" defaultChecked={Boolean(rules.unlimited)} className="h-4 w-4 rounded border-slate-300" />
          Unlimited class access
        </label>
        <label className="flex items-center gap-2">
          <input name="rollover" type="checkbox" defaultChecked={Boolean(rules.rollover)} className="h-4 w-4 rounded border-slate-300" />
          Unused allowance rolls over
        </label>
        <label className="flex items-center gap-2">
          <input name="allow_recurring" type="checkbox" defaultChecked={Boolean(rules.allow_recurring)} className="h-4 w-4 rounded border-slate-300" />
          Allow recurring reservations
        </label>
        <label className="flex items-center gap-2">
          <input name="active" type="checkbox" defaultChecked={product?.active ?? true} className="h-4 w-4 rounded border-slate-300" />
          Visible and available to buy
        </label>
      </div>
    </div>
  );
}

function ProductCard({
  active,
  title,
  subtitle,
  children,
}: {
  active: boolean;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-slate-900">{title}</h3>
            {activeBadge(active)}
          </div>
          <p className="mt-1 text-sm font-medium text-slate-700">{subtitle}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function ProductMeta({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-xs font-medium uppercase tracking-wide text-slate-500">{children}</p>;
}

function ProductActions({
  active,
  editing,
  onEdit,
  onArchive,
  onDelete,
  extraButton,
}: {
  active: boolean;
  editing: boolean;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
  extraButton?: React.ReactNode;
}) {
  return (
    <div className="mt-4 flex flex-wrap gap-2 text-sm font-semibold">
      <button type="button" onClick={onEdit} className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-700 hover:bg-slate-50">
        {editing ? 'Close editor' : 'Edit'}
      </button>
      {extraButton}
      <button type="button" onClick={onArchive} className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-700 hover:bg-slate-50">
        {active ? 'Archive' : 'Reactivate'}
      </button>
      <button type="button" onClick={onDelete} className="rounded-lg border border-red-200 px-3 py-1.5 text-red-700 hover:bg-red-50">
        Delete
      </button>
    </div>
  );
}

function SkeletonProductList({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading products">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonProductCard key={i} />
      ))}
    </div>
  );
}

function SkeletonProductCard() {
  return (
    <div className="animate-pulse rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-4 w-2/3 rounded bg-slate-200" />
          <div className="h-3 w-1/2 rounded bg-slate-100" />
        </div>
        <div className="h-5 w-14 rounded-full bg-slate-100" />
      </div>
      <div className="mt-4 h-3 w-3/4 rounded bg-slate-100" />
      <div className="mt-2 h-3 w-1/3 rounded bg-slate-100" />
      <div className="mt-4 flex gap-2">
        <div className="h-7 w-16 rounded-lg bg-slate-100" />
        <div className="h-7 w-20 rounded-lg bg-slate-100" />
      </div>
    </div>
  );
}

function EmptyProductState({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <p className="mt-2 text-sm text-slate-600">{copy}</p>
    </div>
  );
}
