'use client';

import Link from 'next/link';
import { useState } from 'react';
import { signOutCleanly } from '@/lib/auth/sign-out-cleanly';

interface Props {
  email: string;
  name: string | null;
  /** Dual-role salespeople (venue staff / customer) can hop between surfaces. */
  showSwitch?: boolean;
}

export function SalesSidebar({ email, name, showSwitch = false }: Props) {
  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleSignOut() {
    await signOutCleanly('/login');
  }

  const displayName = name?.trim() || 'Sales';

  return (
    <>
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between border-b border-slate-200 bg-slate-900 px-4 py-3 pt-[calc(0.75rem+env(safe-area-inset-top,0px))]">
        <span className="text-sm font-semibold text-white">ResNeo Sales</span>
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-2 text-slate-300 hover:bg-slate-800"
          aria-label="Toggle navigation"
        >
          {mobileOpen ? (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          )}
        </button>
      </div>

      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-30 bg-black/20 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
      )}

      <aside
        className={`
        fixed top-0 left-0 z-40 flex h-[100dvh] w-56 flex-col bg-slate-900
        transition-transform duration-200 ease-in-out
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:h-full lg:min-h-0 lg:translate-x-0 lg:static lg:self-stretch lg:z-auto
      `}
      >
        <div className="border-b border-slate-700 px-5 py-4">
          <span className="text-sm font-bold tracking-tight text-white">ResNeo</span>
          <span className="ml-2 rounded bg-blue-500 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
            Sales
          </span>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <Link
            href="/sales"
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-3 rounded-lg bg-slate-800 px-3 py-2.5 text-sm font-medium text-white"
          >
            <svg className="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
            </svg>
            Dashboard
          </Link>
        </nav>

        <div className="border-t border-slate-700 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500/20 text-xs font-medium text-blue-400">
              {displayName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-slate-300 truncate">{displayName}</p>
              <p className="text-[11px] text-slate-500 truncate">{email}</p>
            </div>
          </div>
          {showSwitch && (
            <Link
              href="/auth/choose-destination"
              className="block w-full rounded-lg border border-slate-700 px-3 py-2 text-center text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            >
              Switch dashboard
            </Link>
          )}
          <button
            onClick={handleSignOut}
            className="w-full rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          >
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
