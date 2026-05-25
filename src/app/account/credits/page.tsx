import { Suspense } from 'react';
import { AccountCreditsSection } from '@/components/account/AccountCreditsSection';

export default function AccountCreditsPage() {
  return (
    <Suspense fallback={null}>
      <AccountCreditsSection />
    </Suspense>
  );
}
