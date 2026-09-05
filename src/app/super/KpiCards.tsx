import { getSupabaseAdminClient } from '@/lib/supabase';
import { computeSuperKpis, type SuperKpiVenueRow, type SuperKpis } from '@/lib/platform/super-kpis';

async function fetchKpis(): Promise<SuperKpis> {
  const admin = getSupabaseAdminClient();

  const [venuesResult, staffResult] = await Promise.all([
    admin
      .from('venues')
      .select('id, pricing_tier, plan_status, subscription_current_period_end, billing_access_source, is_test'),
    admin.from('staff').select('id', { count: 'exact', head: true }),
  ]);

  return computeSuperKpis((venuesResult.data ?? []) as SuperKpiVenueRow[], staffResult.count ?? 0);
}

export async function KpiCards() {
  const data = await fetchKpis();

  const cards: Array<{ label: string; value: number; valueClass: string; hint?: string }> = [
    {
      label: 'Live venues',
      value: data.liveVenues,
      valueClass: 'text-blue-700',
      hint: data.freeAccess > 0 ? `not cancelled, incl. ${data.freeAccess} complimentary` : 'not cancelled, excludes test venues',
    },
    { label: 'Paying (active)', value: data.paying, valueClass: 'text-emerald-700' },
    { label: 'Trialing', value: data.trialing, valueClass: 'text-cyan-700' },
    { label: 'Past due', value: data.pastDue, valueClass: data.pastDue > 0 ? 'text-red-600' : 'text-slate-700' },
    { label: 'Cancelled / cancelling', value: data.cancelled, valueClass: 'text-slate-700' },
    { label: 'Appointments plans', value: data.appointmentsPlans, valueClass: 'text-violet-700', hint: 'Light / Plus / Pro, live venues' },
    { label: 'Restaurant / Founding', value: data.restaurantFounding, valueClass: 'text-amber-700', hint: 'live venues' },
    { label: 'Staff logins', value: data.staffLogins, valueClass: 'text-slate-700', hint: 'all venues' },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {cards.map((c) => (
        <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400">{c.label}</p>
          <p className={`mt-2 text-2xl font-bold ${c.valueClass}`}>{c.value}</p>
          {c.hint ? <p className="mt-0.5 text-[11px] text-slate-400">{c.hint}</p> : null}
        </div>
      ))}
    </div>
  );
}
