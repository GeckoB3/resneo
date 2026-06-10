'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { signOutCleanly } from '@/lib/auth/sign-out-cleanly';

interface Props {
  email: string;
}

export function SuperSidebar({ email }: Props) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navGroups: Array<{ heading: string | null; items: Array<{ href: string; label: string }> }> = [
    {
      heading: null,
      items: [{ href: '/super', label: 'Overview' }],
    },
    {
      heading: 'Monitor',
      items: [
        { href: '/super/revenue', label: 'Revenue' },
        { href: '/super/health', label: 'Venue health' },
        { href: '/super/subscribers', label: 'Subscribers' },
        { href: '/super/comms', label: 'Communications' },
        { href: '/super/system', label: 'System status' },
      ],
    },
    {
      heading: 'Manage',
      items: [
        { href: '/super/salespeople', label: 'Salespeople' },
        { href: '/super/announcements', label: 'Announcements' },
        { href: '/super/flags', label: 'Feature flags' },
        { href: '/super/users', label: 'Superusers' },
      ],
    },
    {
      heading: 'Compliance',
      items: [{ href: '/super/support-audit', label: 'Audit log' }],
    },
  ];

  async function handleSignOut() {
    await signOutCleanly('/login');
  }

  return (
    <>
      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between border-b border-slate-200 bg-slate-900 px-4 py-3 pt-[calc(0.75rem+env(safe-area-inset-top,0px))]">
        <span className="text-sm font-semibold text-white">Resneo Platform</span>
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

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-30 bg-black/20 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed top-0 left-0 z-40 flex h-[100dvh] w-56 flex-col bg-slate-900
        transition-transform duration-200 ease-in-out
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:h-full lg:min-h-0 lg:translate-x-0 lg:static lg:self-stretch lg:z-auto
      `}>
        {/* Brand */}
        <div className="border-b border-slate-700 px-5 py-4">
          <span className="text-sm font-bold tracking-tight text-white">Resneo</span>
          <span className="ml-2 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-900">Platform</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-4">
          {navGroups.map((group, gi) => (
            <div key={group.heading ?? gi}>
              {group.heading ? (
                <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                  {group.heading}
                </p>
              ) : null}
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active =
                    item.href === '/super'
                      ? pathname === '/super'
                      : pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        active
                          ? 'bg-slate-800 text-white'
                          : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-slate-700 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500/20 text-xs font-medium text-amber-400">
              {email.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-slate-300 truncate">Superuser</p>
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
