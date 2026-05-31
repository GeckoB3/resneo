import type { ReactNode } from 'react';

function SectionCardRoot({
  children,
  className = '',
  elevated = false,
}: {
  children: ReactNode;
  className?: string;
  /** Stronger shadow for primary panels */
  elevated?: boolean;
}) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border border-slate-200/95 bg-white text-slate-900 ${
        elevated ? 'shadow-lg shadow-slate-900/[0.07] ring-1 ring-slate-900/[0.04]' : 'shadow-sm shadow-slate-900/[0.04]'
      } ${className}`}
    >
      {children}
    </div>
  );
}

function SectionCardHeader({
  eyebrow,
  title,
  description,
  right,
  eyebrowClassName,
  titleClassName,
}: {
  eyebrow?: string;
  title?: string;
  description?: ReactNode;
  right?: ReactNode;
  eyebrowClassName?: string;
  titleClassName?: string;
}) {
  if (!eyebrow && !title && !description && !right) return null;
  return (
    <div className="flex flex-col gap-3 border-b border-slate-100/90 bg-gradient-to-r from-slate-50/80 to-white px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6 sm:py-5">
      <div className="min-w-0">
        {eyebrow ? (
          <p
            className={
              eyebrowClassName ??
              'text-[10px] font-semibold uppercase tracking-widest text-slate-500'
            }
          >
            {eyebrow}
          </p>
        ) : null}
        {title ? (
          <h2
            className={
              titleClassName ??
              'mt-1 break-words text-lg font-bold tracking-tight text-slate-900 sm:text-xl'
            }
          >
            {title}
          </h2>
        ) : null}
        {description ? <p className="mt-1 break-words text-sm text-slate-600">{description}</p> : null}
      </div>
      {right ? (
        <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          {right}
        </div>
      ) : null}
    </div>
  );
}

function SectionCardBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`px-4 py-5 sm:px-6 sm:py-6 ${className}`}>{children}</div>;
}

function SectionCardDivider() {
  return <div className="border-t border-slate-100" role="separator" />;
}

function SectionCardFooter({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`border-t border-slate-100 bg-slate-50/40 px-4 py-3 sm:px-6 ${className}`}>{children}</div>
  );
}

export const SectionCard = Object.assign(SectionCardRoot, {
  Header: SectionCardHeader,
  Body: SectionCardBody,
  Divider: SectionCardDivider,
  Footer: SectionCardFooter,
});
