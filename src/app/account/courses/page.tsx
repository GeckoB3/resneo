import { Suspense } from 'react';
import { AccountCoursesSection } from '@/components/account/AccountCoursesSection';

export default function AccountCoursesPage() {
  return (
    <Suspense fallback={null}>
      <AccountCoursesSection />
    </Suspense>
  );
}
