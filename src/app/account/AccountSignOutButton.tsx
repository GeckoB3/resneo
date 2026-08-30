'use client';

import { useState } from 'react';
import { signOutCleanly } from '@/lib/auth/sign-out-cleanly';
import { Button } from '@/components/ui/primitives';

export function AccountSignOutButton() {
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    // Hard teardown; the navigation replaces this page, so busy never resets.
    await signOutCleanly('/login');
  }

  return (
    // `loading` renders the primitive's own spinner and sets `disabled`, so the
    // hand-rolled spinner and the `disabled={busy}` prop both go. The icon is
    // hidden while loading for the same reason it was before: two spinners
    // would be worse than one.
    <Button
      type="button"
      variant="secondary"
      loading={busy}
      onClick={() => void signOut()}
      className="min-h-10 gap-2 rounded-xl shadow-sm shadow-slate-900/5"
    >
      {busy ? null : (
        <svg className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M18 9l3 3m0 0-3 3m3-3H9"
          />
        </svg>
      )}
      Sign out
    </Button>
  );
}
