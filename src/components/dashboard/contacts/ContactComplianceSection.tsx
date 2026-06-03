'use client';

import { useAppointmentsFeatureFlag } from '@/components/providers/VenueFeatureFlagsProvider';
import { ComplianceSection } from '@/components/dashboard/compliance/ComplianceSection';

/**
 * Contact-panel compliance surface (spec §3.2). A sibling of ContactDocumentsSection
 * etc. — no booking context, so the requirements panel is absent and only the
 * records list + audit trail render. Hidden entirely when the feature is off.
 */
export function ContactComplianceSection({
  guestId,
  onRecordCount,
}: {
  guestId: string;
  onRecordCount?: (count: number | null) => void;
}) {
  const enabled = useAppointmentsFeatureFlag('compliance_records_enabled');
  if (!enabled) return null;
  return <ComplianceSection guestId={guestId} complianceEnabled={enabled} onRecordCount={onRecordCount} />;
}
