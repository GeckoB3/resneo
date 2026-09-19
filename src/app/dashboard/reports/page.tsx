import { redirect } from 'next/navigation';

/** Reports live under Settings → Reports tab (admin only). */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  qs.set('tab', 'reports');
  if (sp.tab === 'clients' || sp.tab === 'revenue' || sp.tab === 'new-bookings') {
    qs.set('reportsTab', sp.tab);
  }
  redirect(`/dashboard/settings?${qs.toString()}`);
}
