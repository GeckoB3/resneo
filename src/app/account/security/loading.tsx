import { PortalCardsSkeleton } from '@/components/account/PortalSkeletons';

/** Loading shape for the security page (P0-5). */
export default function AccountSecurityLoading() {
  return <PortalCardsSkeleton title="Security & data" subtitle="Loading…" cards={3} />;
}
