import type { ReactNode } from 'react';

export function SettingsProfileGroup({
  id,
  eyebrow,
  title,
  description,
  brandHeadings = false,
  children,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  description?: ReactNode;
  /** Booking-page tab: larger navy headings aligned with product brand. */
  brandHeadings?: boolean;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-28 space-y-4">
      <div className="rounded-2xl border border-slate-200/90 bg-gradient-to-br from-slate-50 to-white px-4 py-4 shadow-sm shadow-slate-900/[0.03] sm:px-5 sm:py-4">
        <p
          className={
            brandHeadings
              ? 'text-[10px] font-bold uppercase tracking-widest text-brand-600'
              : 'text-[10px] font-semibold uppercase tracking-widest text-slate-500'
          }
        >
          {eyebrow}
        </p>
        <h2
          className={
            brandHeadings
              ? 'mt-1 break-words text-xl font-bold tracking-tight text-brand-900 sm:text-2xl'
              : 'mt-1 text-lg font-bold tracking-tight text-slate-900 sm:text-xl'
          }
        >
          {title}
        </h2>
        {description ? <div className="mt-1.5 text-sm leading-relaxed text-slate-600">{description}</div> : null}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}
