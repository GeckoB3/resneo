import { SuperUsersPageClient } from './SuperUsersPageClient';

export const dynamic = 'force-dynamic';

export default function SuperUsersPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <SuperUsersPageClient />
    </div>
  );
}
