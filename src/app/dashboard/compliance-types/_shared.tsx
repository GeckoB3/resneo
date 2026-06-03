import Link from 'next/link';
import { PageFrame } from '@/components/ui/dashboard/PageFrame';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';

/** Shown when a user reaches a compliance-types page without an enabled, eligible venue. */
export function ComplianceTypesUnavailable() {
  return (
    <PageFrame maxWidthClass="max-w-lg">
      <SectionCard elevated>
        <SectionCard.Body className="py-10 text-center">
          <p className="text-slate-700">Compliance records aren’t enabled for this venue.</p>
          <p className="mt-2 text-sm text-slate-500">
            An admin can turn them on in{' '}
            <Link href="/dashboard/settings?tab=compliance" className="text-brand-600 underline">
              Settings → Compliance → General settings
            </Link>
            .
          </p>
        </SectionCard.Body>
      </SectionCard>
    </PageFrame>
  );
}
