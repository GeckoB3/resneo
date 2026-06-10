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
  if (isSalesAgent(user)) {
    const admin = getSupabaseAdminClient();
    const { data: sp } = await admin
      .from('salespeople')
      .select('name')
      .eq('user_id', user.id)
      .is('revoked_at', null)
      .maybeSingle();
    displayName = (sp as { name: string | null } | null)?.name ?? null;
  }

  return (
    <div className="flex h-[100dvh] max-h-[100dvh] overflow-hidden bg-slate-50">
      <SalesSidebar email={user.email ?? ''} name={displayName} />
      <main className="min-h-0 flex-1 overflow-y-auto pt-[calc(3.5rem+env(safe-area-inset-top,0px))] lg:pt-0">
        {children}
      </main>
    </div>
  );
}
