'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const STEPS = [
  { href: 'upload', label: 'Upload' },
  { href: 'map', label: 'Map' },
  { href: 'review', label: 'Review' },
  { href: 'references', label: 'References' },
  { href: 'validate', label: 'Validate' },
  { href: 'importing', label: 'Import' },
] as const;

type StepHref = (typeof STEPS)[number]['href'];

function resolveCurrentStep(pathname: string | null, sessionId: string): StepHref | null {
  if (!pathname) return null;
  const prefix = `/dashboard/import/${sessionId}/`;
  if (!pathname.startsWith(prefix)) return null;
  const slug = pathname.slice(prefix.length).split('/')[0] ?? '';
  return STEPS.some((s) => s.href === slug) ? (slug as StepHref) : null;
}

export function ImportSessionNav({ sessionId }: { sessionId: string }) {
  const pathname = usePathname();
  const current = resolveCurrentStep(pathname, sessionId);
  const currentLabel = STEPS.find((s) => s.href === current)?.label ?? 'Session';

  return (
    <nav aria-label="Data import navigation" className="space-y-3 border-b border-slate-200 pb-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <Link
          href="/dashboard/import"
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
        >
          <svg
            aria-hidden
            className="h-3.5 w-3.5"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
          Back to imports
        </Link>
        <p className="text-[11px] font-medium text-slate-500" aria-live="polite">
          <span className="text-slate-400">Step</span>{' '}
          <span className="font-semibold text-slate-700">
            {current ? STEPS.findIndex((s) => s.href === current) + 1 : '—'}
          </span>
          <span className="text-slate-400"> of {STEPS.length}</span>
          <span className="text-slate-400"> · </span>
          <span className="font-semibold text-slate-700">{currentLabel}</span>
        </p>
      </div>
      <ol className="-mb-px flex flex-wrap gap-1" role="list">
        {STEPS.map((s, idx) => {
          const isActive = current === s.href;
          return (
            <li key={s.href} className="flex">
              <Link
                href={`/dashboard/import/${sessionId}/${s.href}`}
                aria-current={isActive ? 'step' : undefined}
                className={`inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-brand-50 text-brand-800 ring-1 ring-brand-200'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums ${
                    isActive ? 'bg-brand-600 text-white' : 'bg-slate-200 text-slate-700'
                  }`}
                  aria-hidden
                >
                  {idx + 1}
                </span>
                <span>{s.label}</span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
