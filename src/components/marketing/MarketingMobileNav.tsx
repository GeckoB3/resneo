'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import {
  MARKETING_NAV_ITEMS,
  MARKETING_NAV_SECONDARY,
  type MarketingNavItem,
} from './marketing-nav-items';

/* ────────────────────────────────────────────────────────────────────────
   Small-screen navigation for the marketing pages (solutions hub and the
   vertical pages). The desktop links are hidden below md, so without this
   the site has no navigation at all on a phone.

   The panel dims the page and locks scrolling, so it is treated as a modal
   throughout: focus moves in on open, Tab is trapped inside, and focus
   returns to the toggle on close. Dismissal paths are Escape, an outside
   press, a link press, and crossing the md breakpoint (which hides the
   toggle, so without that last one a resize could strand the page locked).

   This deliberately mirrors the homepage's own mobile nav rather than
   importing it: the homepage component is under separate review and must
   not be edited, and a small amount of duplication is cheaper than coupling
   the two.
   ──────────────────────────────────────────────────────────────────────── */

/** Matches the `md:hidden` on the wrapper: above this the toggle does not exist. */
const DESKTOP_QUERY = '(min-width: 768px)';

export function MarketingMobileNav({
  currentHref,
  sectionHref,
  extraLink,
}: {
  /** Href of the page we are on. Emits aria-current="page". */
  currentHref?: string;
  /** Href of a section this page sits under. Emits aria-current="true". */
  sectionHref?: string;
  /** Optional page-specific anchor, shown after the shared links. */
  extraLink?: MarketingNavItem;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const focusables = () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? [],
      );

    const close = ({ restoreFocus }: { restoreFocus: boolean }) => {
      setOpen(false);
      if (restoreFocus) toggleRef.current?.focus();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close({ restoreFocus: true });
        return;
      }
      if (event.key !== 'Tab') return;
      // Trap: the toggle is the first stop, the panel links follow.
      const stops = [toggleRef.current, ...focusables()].filter(Boolean) as HTMLElement[];
      if (stops.length === 0) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    // Dismiss on any press that lands outside the toggle and the panel.
    const onPointerDown = (event: PointerEvent) => {
      const node = rootRef.current;
      if (node && !node.contains(event.target as Node)) close({ restoreFocus: false });
    };

    // Crossing into desktop hides the toggle and the panel, so close rather
    // than leave the page scroll-locked with no visible control.
    const desktop = window.matchMedia(DESKTOP_QUERY);
    const onBreakpoint = () => {
      if (desktop.matches) close({ restoreFocus: false });
    };

    // Lock the page behind the panel. Compensating for the scrollbar keeps the
    // sticky nav from shifting on desktop-narrow windows.
    const { body, documentElement } = document;
    const scrollbar = window.innerWidth - documentElement.clientWidth;
    const prevOverflow = body.style.overflow;
    const prevPadding = body.style.paddingRight;
    body.style.overflow = 'hidden';
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;

    // The cookie consent banner is `fixed bottom-0 z-50` and sits after the nav
    // in the DOM, so it paints over the bottom of the panel: links there look
    // visible but hit the banner instead. Shrink the panel to stop above
    // whatever is pinned to the bottom of the viewport.
    //
    // Probing a point rather than reading the banner directly keeps this
    // decoupled from the analytics component, and covers any future bottom bar.
    const panel = panelRef.current;
    if (panel) {
      const probe = document.elementFromPoint(
        Math.floor(window.innerWidth / 2),
        window.innerHeight - 8,
      );
      let obstructionTop = window.innerHeight;
      for (let el: Element | null = probe; el && el !== document.body; el = el.parentElement) {
        if (rootRef.current?.contains(el)) continue;
        if (window.getComputedStyle(el).position === 'fixed') {
          obstructionTop = Math.min(obstructionTop, el.getBoundingClientRect().top);
          break;
        }
      }
      if (obstructionTop < window.innerHeight) {
        const panelTop = panel.getBoundingClientRect().top;
        panel.style.maxHeight = `${Math.max(160, obstructionTop - panelTop - 8)}px`;
      }
    }

    focusables()[0]?.focus();

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    desktop.addEventListener('change', onBreakpoint);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
      desktop.removeEventListener('change', onBreakpoint);
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPadding;
      // Hand height control back to the max-h class for the next open.
      if (panel) panel.style.maxHeight = '';
    };
  }, [open]);

  const linkClass =
    'flex min-h-12 items-center rounded-xl px-4 text-base font-semibold text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 aria-[current=page]:bg-brand-50 aria-[current=page]:text-brand-700 aria-[current=true]:bg-brand-50 aria-[current=true]:text-brand-700';

  const primary = extraLink ? [...MARKETING_NAV_ITEMS, extraLink] : MARKETING_NAV_ITEMS;

  const renderItem = (item: MarketingNavItem, liClassName?: string) => {
    const current =
      item.href === currentHref
        ? ('page' as const)
        : item.href === sectionHref
          ? ('true' as const)
          : undefined;
    const props = {
      className: linkClass,
      onClick: () => setOpen(false),
      'aria-current': current,
    };
    return (
      <li key={item.href} className={liClassName}>
        {item.route ? (
          <Link href={item.href} {...props}>
            {item.label}
          </Link>
        ) : (
          <a href={item.href} {...props}>
            {item.label}
          </a>
        )}
      </li>
    );
  };

  return (
    <div ref={rootRef} className="md:hidden">
      <button
        ref={toggleRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? 'Close menu' : 'Open menu'}
        onClick={() => setOpen((v) => !v)}
        className="grid h-11 w-11 place-items-center rounded-xl border border-slate-200 text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        <svg
          className="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden
        >
          {open ? (
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          ) : (
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5"
            />
          )}
        </svg>
      </button>

      {/* Backdrop: dims the page and gives an obvious tap-to-dismiss area.
          Anchored below the bar so the nav itself is not tinted, and negative
          z-index keeps it behind the panel but above the page (the sticky
          z-50 nav is its stacking context).

          It carries its own dismiss handler because it lives inside rootRef,
          which the document-level outside-press listener deliberately ignores.
          Without this the backdrop swallows every tap: it covers the viewport
          and the page is scroll-locked, so a phone (no Escape key) would be
          left with the X as the only way out. */}
      <div
        hidden={!open}
        aria-hidden
        onPointerDown={() => setOpen(false)}
        className="absolute left-0 right-0 top-full -z-10 h-screen bg-slate-900/25"
      />

      {/* Capped to the space under the bar and scrollable, so the lower links
          stay reachable on a short viewport (landscape phones especially). */}
      <div
        ref={panelRef}
        id={panelId}
        hidden={!open}
        className="absolute left-0 right-0 top-full max-h-[calc(100dvh-4.5rem)] overflow-y-auto overscroll-contain border-b border-slate-200 bg-white shadow-lg shadow-slate-900/5"
      >
        {/* Plain list, not a nav landmark: this sits inside the shared header's
            own nav aria-label="Primary", and nesting a second one duplicates it. */}
        <div className="mx-auto max-w-6xl px-4 py-3">
          <ul className="flex flex-col gap-0.5">
            {primary.map((item) => renderItem(item))}
            {MARKETING_NAV_SECONDARY.map((item, i) =>
              renderItem(item, i === 0 ? 'mt-2 border-t border-slate-100 pt-2' : undefined),
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
