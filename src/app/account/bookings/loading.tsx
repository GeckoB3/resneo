import { PortalListSkeleton } from '@/components/account/PortalSkeletons';

/** Loading shape for the bookings list, including its filter tabs (P0-5). */
export default function AccountBookingsLoading() {
  return (
    <PortalListSkeleton
      title="Your bookings"
      subtitle="Loading your bookings…"
      rows={4}
      tabs={3}
    />
  );
}
