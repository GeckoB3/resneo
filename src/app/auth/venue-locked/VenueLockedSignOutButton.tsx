'use client';

import { useState } from 'react';
import { signOutCleanly } from '@/lib/auth/sign-out-cleanly';

export function VenueLockedSignOutButton() {
  const [busy, setBusy] = useState(false);

  async function handleSignOut() {
    if (busy) return;
    setBusy(true);
    await signOutCleanly('/login');
  }

  return (
    <button
      type="button"
      onClick={() => void handleSignOut()}
      disabled={busy}
      className="text-sm font-medium text-slate-500 transition-colors hover:text-brand-600 disabled:opacity-50"
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
