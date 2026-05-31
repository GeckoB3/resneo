import type { OpeningHours } from '@/components/booking/types';

const DAY_LABELS: Record<string, string> = {
  '0': 'Sunday',
  '1': 'Monday',
  '2': 'Tuesday',
  '3': 'Wednesday',
  '4': 'Thursday',
  '5': 'Friday',
  '6': 'Saturday',
};
const DAY_ORDER = ['1', '2', '3', '4', '5', '6', '0'];

function formatTime(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const ampm = (h ?? 0) >= 12 ? 'pm' : 'am';
  const h12 = (h ?? 0) % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2, '0')}${ampm}` : `${h12}${ampm}`;
}

function hasVisibleOpeningHours(hours: OpeningHours): boolean {
  return DAY_ORDER.some((d) => {
    const day = hours[d];
    return day && !('closed' in day && day.closed);
  });
}

function OpeningHoursList({
  hours,
  size = 'sm',
}: {
  hours: OpeningHours;
  size?: 'xs' | 'sm';
}) {
  const rowClass = size === 'xs' ? 'text-xs leading-snug' : 'text-sm leading-snug';
  const gapClass = size === 'xs' ? 'gap-3' : 'gap-4';
  const spaceClass = size === 'xs' ? 'space-y-0.5' : 'space-y-1';

  return (
    <dl className={spaceClass}>
      {DAY_ORDER.map((d) => {
        const day = hours[d];
        const label = DAY_LABELS[d]!;
        const closed = !day || ('closed' in day && day.closed);
        const periods = !closed && 'periods' in day ? day.periods : [];
        return (
          <div key={d} className={`flex justify-between ${gapClass} ${rowClass}`}>
            <dt className="shrink-0 font-medium text-slate-600">{label}</dt>
            <dd className={`text-right ${closed ? 'text-slate-400' : 'text-slate-700'}`}>
              {closed
                ? 'Closed'
                : periods.map((p, i) => (
                    <span key={i}>
                      {i > 0 && <span className="text-slate-300"> · </span>}
                      {formatTime(p.open)}&ndash;{formatTime(p.close)}
                    </span>
                  ))}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

type BookOpeningHoursProps = {
  hours: OpeningHours;
  /** `compact` = collapsible control for the header; `expanded` = always-visible list (e.g. About tab). */
  variant?: 'compact' | 'expanded';
};

/** Opening hours for the public booking page. */
export function BookOpeningHours({ hours, variant = 'compact' }: BookOpeningHoursProps) {
  if (!hasVisibleOpeningHours(hours)) return null;

  if (variant === 'expanded') {
    return <OpeningHoursList hours={hours} />;
  }

  return (
    <details className="group inline-block min-w-0 max-w-full align-top">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-slate-500 hover:text-slate-700 [&::-webkit-details-marker]:hidden">
        <svg
          className="h-3.5 w-3.5 shrink-0 text-slate-400"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
        <span className="text-sm">Opening hours</span>
        <svg
          className="h-3 w-3 shrink-0 text-slate-400 transition-transform group-open:rotate-180"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </summary>
      <div className="mt-1.5 w-full max-w-xs rounded-lg border border-slate-100 bg-slate-50/90 px-2.5 py-2 shadow-sm">
        <OpeningHoursList hours={hours} size="xs" />
      </div>
    </details>
  );
}
