import { PortalListSkeleton } from '@/components/account/PortalSkeletons';

/** Loading shape for the upcoming-events hub (P0-5; was hand-rolled markup). */
export default function AccountEventsLoading() {
  return <PortalListSkeleton title="Your events" subtitle="Loading your upcoming event tickets…" />;
}
