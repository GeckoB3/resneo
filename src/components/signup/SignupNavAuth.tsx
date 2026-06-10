'use client';

import Link from 'next/link';
import { createClient } from '@/lib/supabase/browser';
import { signOutCleanly } from '@/lib/auth/sign-out-cleanly';
import { useEffect, useState } from 'react';

export function SignupNavAuth() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);

  useEffect(() => {
    const supabase = createClient();
    void supabase.auth.getSession().then(({ data: { session } }) => {
      setLoggedIn(!!session);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setLoggedIn(!!session);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleSignOut() {
    await signOutCleanly('/signup');
  }

  if (loggedIn === null) {
    return <div className="h-5 w-32 animate-pulse rounded bg-slate-100" aria-hidden />;
  }

  if (loggedIn) {
    return (
      <button
        type="button"
        onClick={handleSignOut}
        className="text-sm font-medium text-slate-500 hover:text-brand-600 transition-colors"
      >
        Log out
      </button>
    );
  }

  return (
    <Link href="/login" className="text-sm font-medium text-slate-500 hover:text-brand-600 transition-colors">
      Already have an account? Sign in
    </Link>
  );
}
