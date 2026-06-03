import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getDashboardStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { complianceFeatureEnabledForVenue } from '@/lib/compliance/page-access';
import { PageFrame } from '@/components/ui/dashboard/PageFrame';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';
import { ComplianceFormBuilder } from '@/components/dashboard/compliance/ComplianceFormBuilder';
import { ComplianceTypesUnavailable } from '../_shared';

export default async function NewComplianceTypePage() {
  const supabase = await createClient();
  const staff = await getDashboardStaff(supabase);
  const admin = getSupabaseAdminClient();
  if (!staff.venue_id || staff.role !== 'admin' || !(await complianceFeatureEnabledForVenue(admin, staff.venue_id))) {
    return <ComplianceTypesUnavailable />;
  }

  return (
    <PageFrame maxWidthClass="max-w-5xl">
      <PageHeader
        eyebrow="Compliance"
        title="New compliance type"
        actions={
          <Link href="/dashboard/settings?tab=compliance" className="text-sm font-medium text-slate-600 underline">
            Back to Compliance settings
          </Link>
        }
      />
      <ComplianceFormBuilder mode="new" />
    </PageFrame>
  );
}
