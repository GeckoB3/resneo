import type { ReactNode } from 'react';

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{eyebrow}</p>
        ) : null}
        <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-2xl text-sm text-slate-600">{subtitle}</p> : null}
      </div>
      {actions ? (
        <div className="flex w-full min-w-0 shrink-0 flex-col items-stretch gap-2 pt-1 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:gap-2 sm:pt-0 [&>a.inline-flex]:justify-center">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
