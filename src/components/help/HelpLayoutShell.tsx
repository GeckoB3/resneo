'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { HelpAudienceContext } from '@/lib/help/help-audience-context';
import type { HelpCategory, HelpSearchDoc } from '@/lib/help/types';
import { isAppointmentPlanTier, isRestaurantTableProductTier } from '@/lib/tier-enforcement';
import { HelpSidebar } from './HelpSidebar';
import { HelpSearch } from './HelpSearch';

function audienceBannerLabel(ctx: HelpAudienceContext): string | null {
  if (ctx.mode !== 'venue') return null;
  if (ctx.hybridScheduleAddOns) {
    return 'Showing help for your restaurant venue, including schedule and add-on booking types you have enabled.';
  }
  if (isRestaurantTableProductTier(ctx.pricingTier)) {
    return 'Showing help tailored to your Restaurant plan.';
  }
  if (isAppointmentPlanTier(ctx.pricingTier)) {
    return 'Showing help tailored to your Appointments plan.';
  }
  return null;
}

export function HelpLayoutShell({
  children,
  audienceContext,
  visibleCategories,
  searchDocs,
}: {
  children: React.ReactNode;
  audienceContext: HelpAudienceContext;
  visibleCategories: HelpCategory[];
  searchDocs: HelpSearchDoc[];
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!mobileNavOpen) return;
    closeButtonRef.current?.focus();
  }, [mobileNavOpen]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMobileNavOpen(false);
      }
    }
    const previousOverflow = document.body.style.overflow;
    const menuBtn = menuButtonRef.current;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      menuBtn?.focus();
    };
  }, [mobileNavOpen]);

  const banner = audienceBannerLabel(audienceContext);

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-3 sm:px-6">
          <button
            ref={menuButtonRef}
            type="button"
            className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm lg:hidden"
            aria-expanded={mobileNavOpen}
            aria-controls="help-mobile-drawer"
            onClick={() => setMobileNavOpen((o) => !o)}
          >
            <span className="sr-only">{mobileNavOpen ? 'Close menu' : 'Open menu'}</span>
            {mobileNavOpen ? (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            )}
          </button>
          <Link href="/help" className="shrink-0 text-base font-bold text-slate-900">
            ResNeo <span className="font-semibold text-brand-700">Help</span>
          </Link>
          <div className="hidden min-w-0 flex-1 lg:block">
            <HelpSearch className="max-w-xl" searchDocs={searchDocs} />
          </div>
          <Link
            href="/dashboard"
            className="shrink-0 rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          >
            Dashboard
          </Link>
        </div>
        <div className="border-t border-slate-100 px-4 py-2 lg:hidden">
          <HelpSearch searchDocs={searchDocs} />
        </div>
        {banner ? (
          <div className="border-t border-emerald-100 bg-emerald-50/90 px-4 py-2.5 text-center sm:px-6">
            <p className="text-xs text-emerald-950 sm:text-sm">
              {banner}{' '}
              <Link href="/help" className="font-semibold text-brand-800 underline underline-offset-2 hover:text-brand-950">
                Open the full catalogue
              </Link>{' '}
              any time (choose &quot;All topics&quot; on the help home).
            </p>
          </div>
        ) : null}
      </header>

      <div className="mx-auto flex w-full max-w-[1400px] flex-1 gap-0">
        {/* Desktop sidebar */}
        <aside className="sticky top-[4.5rem] hidden max-h-[calc(100dvh-4.5rem)] w-[280px] shrink-0 overflow-y-auto border-r border-slate-200/80 bg-white px-4 py-6 lg:block">
          <HelpSidebar categories={visibleCategories} />
        </aside>

        {/* Mobile drawer */}
        {mobileNavOpen ? (
          <div
            id="help-mobile-drawer"
            className="animate-fade-in fixed inset-0 z-50 flex lg:hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Help navigation"
          >
            <button
              type="button"
              className="absolute inset-0 bg-slate-900/40"
              aria-label="Close menu"
              onClick={() => setMobileNavOpen(false)}
            />
            <div className="relative ml-0 flex h-full w-[min(100%,320px)] flex-col bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <span className="text-sm font-bold text-slate-900">Topics</span>
                <button
                  ref={closeButtonRef}
                  type="button"
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                  aria-label="Close help navigation"
                  onClick={() => setMobileNavOpen(false)}
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-4">
                <HelpSidebar categories={visibleCategories} onNavigate={() => setMobileNavOpen(false)} />
              </div>
            </div>
          </div>
        ) : null}

        <main className="min-w-0 flex-1 px-4 py-8 sm:px-8 sm:py-10">{children}</main>
      </div>
    </div>
  );
}
