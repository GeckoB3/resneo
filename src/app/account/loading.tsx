import { PortalCardsSkeleton } from '@/components/account/PortalSkeletons';

/** Loading shape for the account hub (P0-5). */
export default function AccountHubLoading() {
  return <PortalCardsSkeleton title="My account" subtitle="Loading your account…" cards={3} />;
}
