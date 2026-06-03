import { redirect } from 'next/navigation';

/**
 * The compliance types list lives in Settings → Compliance → Templates & types.
 * The dedicated builder routes are /dashboard/compliance-types/new and /[id]/edit.
 */
export default function ComplianceTypesPage() {
  redirect('/dashboard/settings?tab=compliance');
}
