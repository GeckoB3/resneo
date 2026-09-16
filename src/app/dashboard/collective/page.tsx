import { createClient } from '@/lib/supabase/server';
import { getDashboardStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { PageFrame } from '@/components/ui/dashboard/PageFrame';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { CollectiveAreaClient } from './CollectiveAreaClient';

/**
 * The Collective area (UX spec §2 item 15; W5).
 *
 * Items 1 to 14 make one service feel like one venue. This is where a host runs the collective
 * itself: which services are on the page and which calendars at which venues offer them, in bulk,
 * across everything. A venue that is not in a live collective has no business here and is told so
 * rather than shown an empty grid.
 */
export default async function CollectiveAreaPage() {
  const supabase = await createClient();
  const staff = await getDashboardStaff(supabase);
  if (!staff.venue_id) {
    return (
      <PageFrame maxWidthClass="max-w-lg">
        <SectionCard elevated>
          <SectionCard.Body className="py-10 text-center">
            <p className="text-slate-600">No venue linked to your account.</p>
          </SectionCard.Body>
        </SectionCard>
      </PageFrame>
    );
  }

  const admin = getSupabaseAdminClient();
  const { data: venue } = await admin
    .from('venues')
    .select('currency')
    .eq('id', staff.venue_id)
    .maybeSingle();

  // Only an admin runs a collective: a team member's place is the Services page.
  if (staff.role !== 'admin') {
    return (
      <PageFrame maxWidthClass="max-w-lg">
        <SectionCard elevated>
          <SectionCard.Body className="py-10 text-center">
            <p className="text-slate-600">Only venue admins can manage a collective.</p>
          </SectionCard.Body>
        </SectionCard>
      </PageFrame>
    );
  }

  return (
    <PageFrame maxWidthClass="max-w-6xl">
      <CollectiveAreaClient currency={(venue?.currency as string) ?? 'GBP'} />
    </PageFrame>
  );
}
