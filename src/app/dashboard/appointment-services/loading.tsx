import { PageFrame } from '@/components/ui/dashboard/PageFrame';
import { DashboardCardGridSkeleton } from '@/components/ui/dashboard/DashboardSkeletons';

export default function AppointmentServicesLoading() {
  return (
    <PageFrame maxWidthClass="max-w-4xl">
      <DashboardCardGridSkeleton cards={3} />
    </PageFrame>
  );
}
