import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getDashboardStaff } from '@/lib/venue-auth';
import { ImportSessionNav } from '@/components/import/ImportSessionNav';

export default async function ImportSessionLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ sessionId: string }>;
}) {
  const supabase = await createClient();
  const staff = await getDashboardStaff(supabase);
  if (!staff?.venue_id || staff.role !== 'admin') {
    redirect('/dashboard');
  }

  const { sessionId } = await params;

  return (
    <div className="p-4 pb-[max(2rem,env(safe-area-inset-bottom,0px))] md:p-6 md:pb-6 lg:p-8 lg:pb-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <ImportSessionNav sessionId={sessionId} />
        {children}
      </div>
    </div>
  );
}
