import { SubscribersPageClient } from './SubscribersPageClient';

export const dynamic = 'force-dynamic';

export default function SuperSubscribersPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <SubscribersPageClient />
    </div>
  );
}
