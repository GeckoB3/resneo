import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isPlatformSuperuser } from '@/lib/platform-auth';
import { SignupPlanConflictBanner } from '@/components/signup/SignupPlanConflictBanner';
import { SignupNavAuth } from '@/components/signup/SignupNavAuth';

export default async function SignupLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user && isPlatformSuperuser(user)) {
    redirect('/super');
  }
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <nav className="border-b border-slate-100 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3 sm:px-6 sm:py-4">
          <Link href="/" className="flex-shrink-0">
            <img src="/Logo.png" alt="Resneo" className="h-9 w-auto" />
          </Link>
          <SignupNavAuth />
        </div>
      </nav>
      <main className="flex flex-1 flex-col items-center px-4 pb-10 pt-8 sm:py-16">
        <Suspense fallback={null}>
          <SignupPlanConflictBanner />
        </Suspense>
        <Suspense
          fallback={
            <div className="flex min-h-[40vh] w-full flex-1 items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
            </div>
          }
        >
          {children}
        </Suspense>
      </main>
    </div>
  );
}
