import { PortalCardsSkeleton } from '@/components/account/PortalSkeletons';

/** Loading shape for the profile page (P0-5). */
export default function AccountProfileLoading() {
  return (
    <PortalCardsSkeleton title="Profile & preferences" subtitle="Loading your profile…" cards={4} />
  );
}
