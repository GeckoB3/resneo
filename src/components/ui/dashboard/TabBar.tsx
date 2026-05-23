'use client';

import { Skeleton } from '@/components/ui/Skeleton';

export type TabBarMobileLayout = 'single-row-scroll' | 'two-row-scroll';

type TabBarTab<T extends string> = { id: T; label: string; description?: string };

export function TabBar<T extends string>({
  tabs,
  value,
  pendingValue,
  onChange,
  mobileNote = 'Scroll sideways to see all settings tabs',
  density = 'default',
  mobileLayout = 'single-row-scroll',
}: {
  tabs: readonly TabBarTab<T>[];
  value: T;
  pendingValue?: T | null;
  onChange: (id: T) => void;
  mobileNote?: string | null;
  density?: 'default' | 'compact';
  /** Mobile (&lt; sm): one scrollable row, or two rows with a single horizontal scroll. */
  mobileLayout?: TabBarMobileLayout;
}) {
  const active = tabs.find((t) => t.id === value);
  const isCompact = density === 'compact';
  const useTwoRowMobile = mobileLayout === 'two-row-scroll';
  const mobileRowSplit = Math.ceil(tabs.length / 2);
  const mobileRows: [TabBarTab<T>[], TabBarTab<T>[]] = [
    tabs.slice(0, mobileRowSplit),
    tabs.slice(mobileRowSplit),
  ];

  const tabButtonClass = (isActive: boolean) =>
    `shrink-0 snap-start rounded-xl text-left font-semibold transition-colors duration-150 ease-out ${
      isCompact
        ? 'min-h-9 px-3 py-1.5 text-xs sm:min-h-9 sm:px-3.5 sm:py-1.5'
        : 'min-h-11 px-3.5 py-2.5 text-sm sm:min-h-10 sm:px-4 sm:py-2'
    } ${
      isActive
        ? 'bg-white text-brand-800 shadow-md shadow-slate-900/10 ring-1 ring-slate-200/80'
        : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
    }`;

  function renderTabButton(t: TabBarTab<T>) {
    const isActive = t.id === value;
    const isPending = pendingValue === t.id;
    return (
      <button
        key={t.id}
        type="button"
        role="tab"
        aria-selected={isActive}
        aria-busy={isPending || undefined}
        aria-current={isActive ? 'page' : undefined}
        title={t.description}
        onClick={() => onChange(t.id)}
        className={tabButtonClass(isActive)}
      >
        <span className="flex items-center gap-2 whitespace-nowrap">
          {isPending ? <Skeleton.Line className="h-2.5 w-7 shrink-0" /> : null}
          {t.label}
        </span>
      </button>
    );
  }

  const tabListShellClass = `rounded-2xl border border-slate-200/90 bg-slate-50/90 p-1 shadow-inner ${
    isCompact ? 'min-h-9' : 'min-h-11'
  }`;

  return (
    <div className={`${isCompact ? 'space-y-1' : 'space-y-2'} min-w-0 max-w-full`}>
      {mobileNote ? (
        <p className="text-[11px] font-medium text-slate-500 sm:hidden" role="note">
          {mobileNote}
        </p>
      ) : null}
      <div className="overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch] pb-0.5 sm:overflow-visible sm:pb-0">
        {useTwoRowMobile ? (
          <>
            <div
              className={`inline-flex w-max min-w-full flex-col gap-1 sm:hidden ${tabListShellClass}`}
              role="tablist"
            >
              {mobileRows.map((row, rowIndex) =>
                row.length > 0 ? (
                  <div key={rowIndex} className="flex flex-nowrap gap-1">
                    {row.map((t) => renderTabButton(t))}
                  </div>
                ) : null,
              )}
            </div>
            <div
              className={`hidden gap-1.5 sm:inline-flex sm:flex-wrap ${tabListShellClass}`}
              role="tablist"
            >
              {tabs.map((t) => renderTabButton(t))}
            </div>
          </>
        ) : (
          <div
            className={`inline-flex flex-nowrap gap-1 sm:flex-wrap sm:gap-1.5 ${tabListShellClass}`}
            role="tablist"
          >
            {tabs.map((t) => renderTabButton(t))}
          </div>
        )}
      </div>
      {active?.description ? (
        <p className="hidden text-sm leading-relaxed text-slate-600 sm:block">{active.description}</p>
      ) : null}
    </div>
  );
}
