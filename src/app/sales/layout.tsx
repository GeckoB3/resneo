import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { isSalesAgent } from '@/lib/sales/auth';
import { isPlatformSuperuser } from '@/lib/platform-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { SalesSidebar } from './SalesSidebar';

export default async function SalesLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login?redirectTo=/sales');
  }

  const allowed = isSalesAgent(user) || isPlatformSuperuser(user);
  if (!allowed) {
    redirect('/dashboard');
  }

  let displayName: string | null = null;
  let showSwitch = false;
  if (isSalesAgent(user)) {
    const admin = getSupabaseAdminClient();
    const emailNorm = (user.email ?? '').trim().toLowerCase();
    const [{ data: sp }, staffByUserRes, staffByEmailRes, guestRes] = await Promise.all([
      admin
        .from('salespeople')
        .select('name')
        .eq('user_id', user.id)
        .is('revoked_at', null)
        .maybeSingle(),
      admin
        .from('staff')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .is('revoked_at', null),
      emailNorm
        ? admin
            .from('staff')
            .select('id', { count: 'exact', head: true })
            .ilike('email', emailNorm)
            .is('revoked_at', null)
        : Promise.resolve({ count: 0 }),
      emailNorm
        ? admin.from('guests').select('id', { count: 'exact', head: true }).ilike('email', emailNorm)
        : Promise.resolve({ count: 0 }),
    ]);
    displayName = (sp as { name: string | null } | null)?.name ?? null;
    showSwitch =
      ((staffByUserRes.count ?? 0) > 0) ||
      ((staffByEmailRes.count ?? 0) > 0) ||
      ((guestRes.count ?? 0) > 0);
  }

  return (
    <div className="flex h-[100dvh] max-h-[100dvh] overflow-hidden bg-slate-50">
      <SalesSidebar email={user.email ?? ''} name={displayName} showSwitch={showSwitch} />
      <main className="min-h-0 flex-1 overflow-y-auto pt-[calc(3.5rem+env(safe-area-inset-top,0px))] lg:pt-0">
        {children}
      </main>
    </div>
  );
}
