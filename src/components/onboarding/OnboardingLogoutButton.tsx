'use client';

import { signOutCleanly } from '@/lib/auth/sign-out-cleanly';
import { useState } from 'react';

export function OnboardingLogoutButton() {
  const [busy, setBusy] = useState(false);

  async function handleSignOut() {
    if (busy) return;
    setBusy(true);
    await signOutCleanly('/login?redirectTo=/onboarding');
  }

  return (
    <button
      type="button"
      onClick={() => void handleSignOut()}
      disabled={busy}
      className="text-sm font-medium text-slate-500 transition-colors hover:text-brand-600 disabled:opacity-50"
    >
      {busy ? 'Signing out…' : 'Log out'}
    </button>
  );
}
