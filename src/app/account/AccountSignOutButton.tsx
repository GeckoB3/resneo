'use client';

import { useState } from 'react';
import { signOutCleanly } from '@/lib/auth/sign-out-cleanly';

export function AccountSignOutButton() {
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    // Hard teardown; the navigation replaces this page, so busy never resets.
    await signOutCleanly('/login');
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void signOut()}
      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm shadow-slate-900/5 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
    >
      {busy ? (
        <span
          className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600"
          aria-hidden
        />
      ) : (
        <svg className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M18 9l3 3m0 0-3 3m3-3H9"
          />
        </svg>
      )}
      Sign out
    </button>
  );
}
