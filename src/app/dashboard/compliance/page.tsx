import { createClient } from '@/lib/supabase/server';
import { getDashboardStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { complianceFeatureEnabledForVenue } from '@/lib/compliance/page-access';
import { PageFrame } from '@/components/ui/dashboard/PageFrame';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';
import { ComplianceDashboardView } from './ComplianceDashboardView';
import { ComplianceTypesUnavailable } from '../compliance-types/_shared';

export default async function ComplianceDashboardPage() {
  const supabase = await createClient();
  const staff = await getDashboardStaff(supabase);
  const admin = getSupabaseAdminClient();
  if (!staff.venue_id || !(await complianceFeatureEnabledForVenue(admin, staff.venue_id))) {
    return <ComplianceTypesUnavailable />;
  }

  return (
    <PageFrame maxWidthClass="max-w-3xl">
      <PageHeader
        eyebrow="Compliance"
        title="Compliance"
        subtitle="Your daily sweep: what’s missing, expiring, or awaiting a client."
      />
      <ComplianceDashboardView />
    </PageFrame>
  );
}
