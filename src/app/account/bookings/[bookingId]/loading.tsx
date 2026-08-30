import { PortalCardsSkeleton } from '@/components/account/PortalSkeletons';

/** Loading shape for a single booking (P0-5). */
export default function AccountBookingDetailLoading() {
  return <PortalCardsSkeleton title="Booking" subtitle="Loading this booking…" cards={2} />;
}
