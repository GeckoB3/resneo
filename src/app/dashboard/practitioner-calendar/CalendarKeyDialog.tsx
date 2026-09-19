'use client';

/**
 * The diary's colour key (spec §8.2, amended 2026-09-19). Every closed stripe already says why in
 * words, but the tints carried no explanation anywhere, and a linked column now draws the same
 * tints as an own one. One small dialog, opened from the toolbar, so the meaning is a click away
 * without living on the grid.
 */
import { Dialog } from '@/components/ui/primitives/Dialog';

export interface CalendarKeyEntry {
  label: string;
  meaning: string;
  shellClass: string;
  accent: string;
}

/** The same classes and accents the grid uses (`calendarBlockShellClass`, `calendarBlockAccentColor`). */
export const CALENDAR_KEY_ENTRIES: readonly CalendarKeyEntry[] = [
  {
    label: 'Venue closed',
    meaning: 'The business is shut, from its opening hours, a closure or amended hours. The calendar would otherwise be working.',
    shellClass: 'border-rose-200 bg-rose-50/95',
    accent: '#e11d48',
  },
  {
    label: 'Calendar unavailable',
    meaning: 'The business is open but this calendar is not working: its hours, a day off, or amended hours for the day.',
    shellClass: 'border-sky-200 bg-sky-50/95',
    accent: '#0284c7',
  },
  {
    label: 'Closed, Unavailable or On leave',
    meaning: 'A closure entered for this calendar, with the words its Label gives it. Nothing can be booked over it.',
    shellClass: 'border-violet-200 bg-violet-50/95',
    accent: '#7c3aed',
  },
  {
    label: 'Calendar closed',
    meaning: 'The business is shut and the calendar is not working either.',
    shellClass: 'border-slate-300 bg-slate-200/90',
    accent: '#94a3b8',
  },
  {
    label: 'Break',
    meaning: 'A break set in Calendar availability.',
    shellClass: 'border-amber-200 bg-amber-50/95',
    accent: '#d97706',
  },
];

export function CalendarKeyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="What the colours mean"
      description="Linked venues' calendars use the same colours as your own, drawn from their own hours and closures."
      size="sm"
    >
      <ul className="space-y-2 text-sm text-slate-700">
        {CALENDAR_KEY_ENTRIES.map((entry) => (
          <li key={entry.label} className="flex items-start gap-3">
            <span
              aria-hidden
              className={`mt-0.5 h-9 w-9 shrink-0 rounded-lg border ${entry.shellClass}`}
              style={{ borderLeftWidth: 3, borderLeftColor: entry.accent }}
            />
            <span>
              <span className="block font-semibold text-slate-900">{entry.label}</span>
              <span className="block text-xs text-slate-600">{entry.meaning}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-slate-500">
        Staff can book over a closed stripe on your own calendars, with a note, but never inside a linked venue&rsquo;s closed hours.
      </p>
    </Dialog>
  );
}
