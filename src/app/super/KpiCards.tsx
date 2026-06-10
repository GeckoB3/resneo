import { getSupabaseAdminClient } from '@/lib/supabase';

interface KpiData {
  totalLiveVenues: number;
  active: number;
  trialing: number;
  pastDue: number;
  cancelled: number;
  appointments: number;
  restaurantFounding: number;
  totalStaff: number;
  testVenues: number;
}

async function fetchKpis(): Promise<KpiData> {
  const admin = getSupabaseAdminClient();

  const [venuesResult, staffResult] = await Promise.all([
    admin.from('venues').select('id, pricing_tier, plan_status, is_test'),
    admin.from('staff').select('id', { count: 'exact', head: true }),
  ]);

  const venues = venuesResult.data ?? [];
  const totalStaff = staffResult.count ?? 0;

  const data: KpiData = {
    totalLiveVenues: 0,
    active: 0,
    trialing: 0,
    pastDue: 0,
    cancelled: 0,
    appointments: 0,
    restaurantFounding: 0,
    totalStaff,
    testVenues: 0,
  };

  for (const v of venues) {
    if ((v as { is_test?: boolean }).is_test) {
      data.testVenues++;
      continue;
    }
    data.totalLiveVenues++;

    const tier = ((v.pricing_tier as string) ?? '').toLowerCase().trim();
    const status = ((v.plan_status as string) ?? '').toLowerCase().trim();

    if (status === 'active') data.active++;
    else if (status === 'trialing') data.trialing++;
    else if (status === 'past_due') data.pastDue++;
    else if (status === 'cancelled' || status === 'cancelling') data.cancelled++;

    if (tier === 'appointments' || tier === 'plus' || tier === 'light') data.appointments++;
    else if (tier === 'restaurant' || tier === 'founding') data.restaurantFounding++;
  }

  return data;
}

export async function KpiCards() {
  const data = await fetchKpis();

  const cards: Array<{ label: string; value: number; valueClass: string; hint?: string }> = [
    { label: 'Live venues', value: data.totalLiveVenues, valueClass: 'text-blue-700', hint: 'excludes test venues' },
    { label: 'Paying (active)', value: data.active, valueClass: 'text-emerald-700' },
    { label: 'Trialing', value: data.trialing, valueClass: 'text-cyan-700' },
    { label: 'Past due', value: data.pastDue, valueClass: data.pastDue > 0 ? 'text-red-600' : 'text-slate-700' },
    { label: 'Cancelled / cancelling', value: data.cancelled, valueClass: 'text-slate-700' },
    { label: 'Appointments plans', value: data.appointments, valueClass: 'text-violet-700', hint: 'Light / Plus / Pro' },
    { label: 'Restaurant / Founding', value: data.restaurantFounding, valueClass: 'text-amber-700' },
    { label: 'Staff logins', value: data.totalStaff, valueClass: 'text-slate-700', hint: 'all venues' },
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
