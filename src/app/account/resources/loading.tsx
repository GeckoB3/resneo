import { PortalListSkeleton } from '@/components/account/PortalSkeletons';

/** Loading shape for the upcoming-resources hub (P0-5; was hand-rolled markup). */
export default function AccountResourcesLoading() {
  return (
    <PortalListSkeleton title="Your resources" subtitle="Loading your upcoming bookings…" />
  );
}
