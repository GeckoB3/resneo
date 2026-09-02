'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';

/* ────────────────────────────────────────────────────────────────────────
   Small-screen navigation. The desktop nav links are hidden below md, so
   without this the primary sections are unreachable from the top of the
   page on a phone.

   The panel dims the page and locks scrolling, so it is treated as a modal
   throughout: focus moves in on open, Tab is trapped inside, and focus
   returns to the toggle on close. Dismissal paths are Escape, an outside
   press, a link press, and crossing the md breakpoint (which hides the
   toggle, so without that last one a resize could strand the page locked).
   ──────────────────────────────────────────────────────────────────────── */

/** Matches the `md:hidden` on the wrapper: above this the toggle does not exist. */
const DESKTOP_QUERY = '(min-width: 768px)';

const ITEMS: { href: string; label: string; internal?: boolean }[] = [
  { href: '#features', label: 'Features' },
  { href: '#link-break', label: 'Link & break' },
  { href: '/solutions', label: 'Solutions', internal: true },
  { href: '#pricing', label: 'Pricing' },
  { href: '/help', label: 'Help', internal: true },
  { href: '#faq', label: 'FAQ' },
  { href: '/about', label: 'About', internal: true },
  { href: '#contact', label: 'Contact' },
];

export function HomeMobileNav() {
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
    'flex min-h-12 items-center rounded-full px-4 text-base font-bold text-slate-700 transition-colors hover:bg-white hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600';

  return (
    <div ref={rootRef} className="md:hidden">
      <button
        ref={toggleRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? 'Close menu' : 'Open menu'}
        onClick={() => setOpen((v) => !v)}
        className="grid h-11 w-11 place-items-center rounded-full border border-[#E8E4DC] bg-white text-slate-700 transition-colors hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
          {open ? (
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
          )}
        </svg>
      </button>

      {/* Backdrop: dims the page and gives an obvious tap-to-dismiss area.
          Anchored below the bar so the nav itself is not tinted, and negative
          z-index keeps it behind the panel but above the page (the sticky
          z-50 nav is its stacking context).

          It needs its own dismiss handler: it lives inside rootRef, which the
          document-level outside-press listener deliberately ignores, and it
          covers the whole viewport while the page is scroll-locked. */}
      <div
        hidden={!open}
        aria-hidden
        onPointerDown={() => setOpen(false)}
        className="absolute left-0 right-0 top-full -z-10 h-screen bg-slate-900/25"
      />

      <div
        ref={panelRef}
        id={panelId}
        hidden={!open}
        className="absolute left-0 right-0 top-full max-h-[calc(100dvh-4.5rem)] overflow-y-auto overscroll-contain border-b border-[#EEE9E0] bg-[#FDFBF7] shadow-lg shadow-slate-900/5"
      >
        <nav aria-label="Primary" className="mx-auto max-w-6xl px-4 py-3">
          <ul className="flex flex-col gap-0.5">
            {ITEMS.map((item) => (
              <li key={item.href}>
                {item.internal ? (
                  <Link href={item.href} className={linkClass} onClick={() => setOpen(false)}>
                    {item.label}
                  </Link>
                ) : (
                  <a href={item.href} className={linkClass} onClick={() => setOpen(false)}>
                    {item.label}
                  </a>
                )}
              </li>
            ))}
            <li className="mt-2 border-t border-[#EEE9E0] pt-2">
              <Link href="/login" className={linkClass} onClick={() => setOpen(false)}>
                Log in
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </div>
  );
}
