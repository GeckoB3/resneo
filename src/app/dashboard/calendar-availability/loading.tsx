import { AppointmentAvailabilitySkeleton } from '@/components/ui/dashboard/DashboardSkeletons';

export default function CalendarAvailabilityLoading() {
  return (
    <div className="p-4 md:p-6 lg:p-8">
      <div className="mx-auto max-w-4xl">
        <AppointmentAvailabilitySkeleton />
      </div>
    </div>
  );
}
