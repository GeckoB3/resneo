import { Suspense } from 'react';
import { AccountMembershipsSection } from '@/components/account/AccountMembershipsSection';

export default function AccountMembershipsPage() {
  return (
    <Suspense fallback={null}>
      <AccountMembershipsSection />
    </Suspense>
  );
}
