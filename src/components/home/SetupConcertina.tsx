'use client';

import { useEffect, useId, useState, useSyncExternalStore, type ReactNode } from 'react';

/** Nothing to subscribe to: the hash is only read when the page first renders. */
const subscribeNever = () => () => {};

/**
 * A homepage concertina that starts closed, with the same open and close
 * motion as the FAQ.
 *
 * Any link to `#{id}` on the page opens it (the section's "See the setup
 * steps", the Getting started note), and so does arriving on the page with
 * that hash. The closed content stays in the server HTML, so search engines
 * still read it, but it is inert, so its links are not tab stops while hidden.
 */
export function SetupConcertina({
  id,
  eyebrow,
  title,
  summary,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  summary: string;
  children: ReactNode;
}) {
  const baseId = useId();
  const buttonId = `${baseId}-button`;
  const titleId = `${baseId}-title`;
  const summaryId = `${baseId}-summary`;
  const panelId = `${baseId}-panel`;
  const target = `#${id}`;

  // A deep link opens it on arrival. Read as a snapshot rather than set in an
  // effect, so the server render (closed) hydrates without a mismatch.
  const arrivedOnTarget = useSyncExternalStore(
    subscribeNever,
    () => window.location.hash === target,
    () => false,
  );
  // null until someone opens or closes it, or follows a link to it.
  const [choice, setChoice] = useState<boolean | null>(null);
  const open = choice ?? arrivedOnTarget;

  useEffect(() => {
    // A click, not only hashchange: following the same link a second time
    // leaves the hash unchanged, and must still reopen it.
    const onClick = (e: MouseEvent) => {
      const link = e.target instanceof Element ? e.target.closest('a[href]') : null;
      const href = link?.getAttribute('href');
      if (href === target || href === `/${target}`) setChoice(true);
    };
    const onHashChange = () => {
      if (window.location.hash === target) setChoice(true);
    };
    document.addEventListener('click', onClick);
    window.addEventListener('hashchange', onHashChange);
    return () => {
      document.removeEventListener('click', onClick);
      window.removeEventListener('hashchange', onHashChange);
    };
  }, [target]);

  return (
    <div
      id={id}
      className="scroll-mt-24 overflow-hidden rounded-[32px] border border-[#EEE9E0] bg-white shadow-[0_18px_40px_-24px_rgba(0,59,111,0.2)]"
    >
      <div className="h-1.5 w-full bg-accent-400" aria-hidden />
      <h3 className="m-0">
        <button
          id={buttonId}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          // The heading and the button are named by the title alone; the
          // summary is read as a description rather than as part of the name.
          aria-labelledby={titleId}
          aria-describedby={summaryId}
          onClick={() => setChoice(!open)}
          className="group flex w-full items-center gap-4 px-7 py-6 text-left transition-colors hover:bg-accent-50/40 focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-brand-600 sm:gap-6 sm:px-9 sm:py-7"
        >
          <span className="min-w-0 flex-1">
            <span className="home-body block text-xs font-bold uppercase tracking-[0.16em] text-accent-700">{eyebrow}</span>
            {/* No colour of its own: it takes the navy every homepage h3 has. */}
            <span id={titleId} className="mt-1.5 block text-lg font-bold tracking-tight sm:text-xl">
              {title}
            </span>
            {/* home-body and font-normal: inside the h3 it would otherwise take the
                heading's display font and weight. */}
            <span id={summaryId} className="home-body mt-1 block text-sm font-normal leading-relaxed text-slate-600">
              {summary}
            </span>
          </span>
          <ToggleIcon open={open} />
        </button>
      </h3>
      <div
        id={panelId}
        role="region"
        aria-labelledby={buttonId}
        inert={!open}
        className={`grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none ${
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            className={`border-t border-[#EEE9E0] transition-opacity duration-300 ease-out motion-reduce:transition-none ${
              open ? 'opacity-100 delay-75' : 'opacity-0'
            }`}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Plus when closed, minus when open: the FAQ's toggle, so the page has one concertina language. */
function ToggleIcon({ open }: { open: boolean }) {
  return (
    <span
      className={`relative flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border transition-all duration-300 ease-out ${
        open
          ? 'border-brand-300/80 bg-brand-600 text-white shadow-md shadow-brand-900/15'
          : 'border-[#EEE9E0] bg-[#FDFBF7] text-slate-500 shadow-sm group-hover:border-accent-200 group-hover:bg-accent-50 group-hover:text-brand-700'
      }`}
      aria-hidden
    >
      <svg
        className={`absolute h-4 w-4 transition-all duration-300 ease-out ${
          open ? 'scale-75 rotate-90 opacity-0' : 'scale-100 rotate-0 opacity-100'
        }`}
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={2.25}
        stroke="currentColor"
      >
        <path strokeLinecap="round" d="M12 5v14M5 12h14" />
      </svg>
      <svg
        className={`absolute h-4 w-4 transition-all duration-300 ease-out ${
          open ? 'scale-100 rotate-0 opacity-100' : 'scale-75 -rotate-90 opacity-0'
        }`}
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={2.25}
        stroke="currentColor"
      >
        <path strokeLinecap="round" d="M5 12h14" />
      </svg>
    </span>
  );
}
