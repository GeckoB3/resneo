'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/browser';

interface Props {
  email: string;
  name: string | null;
}

export function SalesSidebar({ email, name }: Props) {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  const displayName = name?.trim() || 'Sales';

  return (
    <>
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between border-b border-slate-200 bg-slate-900 px-4 py-3 pt-[calc(0.75rem+env(safe-area-inset-top,0px))]">
        <span className="text-sm font-semibold text-white">Resneo Sales</span>
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-2 text-slate-300 hover:bg-slate-800"
          aria-label="Toggle navigation"
        >
          {mobileOpen ? '✕' : '☰'}
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
          <span className="text-sm font-bold tracking-tight text-white">Resneo</span>
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
