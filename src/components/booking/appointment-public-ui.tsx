'use client';

import { forwardRef, type CSSProperties, type ReactNode } from 'react';

const BRAND_ACCENT = '#4e6b78';

/** Maps guest flow step to a 3-phase progress indicator (Choose → Schedule → Confirm). */
export function appointmentProgressPhase(
  step: string,
): { phase: 0 | 1 | 2; label: string } | null {
  const choose = new Set([
    'mode_choice',
    'service',
    'variant',
    'practitioner',
    'group_review',
    'group_person_label',
    'group_service',
    'group_variant',
    'group_practitioner',
  ]);
  const schedule = new Set(['slot', 'multi_service', 'group_slot']);
  const confirm = new Set(['details', 'payment', 'group_details', 'group_payment']);

  if (choose.has(step)) return { phase: 0, label: 'Choose' };
  if (schedule.has(step)) return { phase: 1, label: 'Schedule' };
  if (confirm.has(step)) return { phase: 2, label: 'Confirm' };
  if (step === 'confirmation' || step === 'group_confirmation') return null;
  return null;
}

export function appointmentAccentStyle(accentColour?: string | null): CSSProperties | undefined {
  if (!accentColour?.trim()) return undefined;
  const hex = accentColour.replace(/^#/, '').trim();
  if (!hex) return undefined;
  return { '--accent': `#${hex}` } as CSSProperties;
}

export const APPOINTMENT_PUBLIC_ROOT_CLASS = 'appointment-public';

export const AppointmentPublicShell = forwardRef<
  HTMLDivElement,
  {
    children: ReactNode;
    accentColour?: string | null;
    embed?: boolean;
    className?: string;
  }
>(function AppointmentPublicShell({ children, accentColour, embed = false, className = '' }, ref) {
  const accentStyle = appointmentAccentStyle(accentColour);

  if (embed) {
    return (
      <div
        ref={ref}
        className={`${APPOINTMENT_PUBLIC_ROOT_CLASS} relative w-full min-w-0 ${className}`.trim()}
        style={accentStyle}
      >
        <div className="w-full min-w-0 overflow-visible rounded-xl border border-slate-200/90 bg-white shadow-sm ring-1 ring-slate-900/[0.04]">
          <div className="ap-accent-bar h-1 w-full rounded-t-[11px]" />
          <div className="px-3 py-4 sm:px-4 sm:py-5">{children}</div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className={`${APPOINTMENT_PUBLIC_ROOT_CLASS} relative mx-auto w-full max-w-lg ${className}`.trim()}
      style={accentStyle}
    >
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[var(--ds-shadow-elevated)] ring-1 ring-slate-900/[0.03]">
        <div className="ap-accent-bar h-1 w-full" />
        <div className="px-5 py-6 sm:px-6 sm:py-7">{children}</div>
      </div>
    </div>
  );
});

export function AppointmentProgressBar({ phase }: { phase: 0 | 1 | 2 }) {
  const phases = ['Choose', 'Schedule', 'Confirm'] as const;
  return (
    <div className="mb-6" aria-label={`Booking progress: ${phases[phase]}`}>
      <div className="flex items-center gap-2">
        {phases.map((label, i) => {
          const done = i < phase;
          const active = i === phase;
          return (
            <div key={label} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold transition-colors ${
                  done
                    ? 'ap-progress-done text-white'
                    : active
                      ? 'ap-progress-active text-white shadow-sm'
                      : 'bg-slate-100 text-slate-400'
                }`}
              >
                {done ? (
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={`text-[10px] font-semibold uppercase tracking-wide ${
                  active ? 'text-slate-800' : done ? 'text-slate-600' : 'text-slate-400'
                }`}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex gap-1">
        {phases.map((_, i) => (
          <div
            key={i}
            className={`h-0.5 flex-1 rounded-full transition-colors ${
              i <= phase ? 'ap-progress-track-active' : 'bg-slate-100'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

export function AppointmentStepHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <header className="mb-5">
      <h2 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-[1.35rem]">{title}</h2>
      {description ? <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{description}</p> : null}
    </header>
  );
}

export function AppointmentBackLink({
  onClick,
  children = 'Back',
  className = '',
}: {
  onClick: () => void;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`ap-back-link mb-4 inline-flex items-center gap-1.5 text-sm font-medium ${className}`.trim()}
    >
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
      </svg>
      {children}
    </button>
  );
}

export function AppointmentChoiceCard({
  onClick,
  icon,
  title,
  description,
  tone = 'accent',
}: {
  onClick: () => void;
  icon: ReactNode;
  title: string;
  description: string;
  tone?: 'accent' | 'group';
}) {
  return (
    <button type="button" onClick={onClick} className="ap-choice-card group w-full text-left">
      <div className="flex items-center gap-4">
        <div
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
            tone === 'group' ? 'bg-violet-50 text-violet-600' : 'ap-choice-icon'
          }`}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-slate-900">{title}</div>
          <div className="mt-0.5 text-sm text-slate-500">{description}</div>
        </div>
        <svg
          className="h-5 w-5 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-400"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
        </svg>
      </div>
    </button>
  );
}

export function AppointmentSummaryStrip({ children }: { children: ReactNode }) {
  return <div className="ap-summary-strip mb-5 text-sm">{children}</div>;
}

/**
 * Container-aware grid for appointment time pickers (public page, embed, staff form).
 * See `globals.css` — `repeat(auto-fill, minmax(...))` adapts column count to width.
 */
export const APPOINTMENT_TIME_SLOTS_GRID_CLASS = 'ap-time-slots-grid';

/** @deprecated Use {@link APPOINTMENT_TIME_SLOTS_GRID_CLASS}. */
export const APPOINTMENT_STAFF_TIME_SLOTS_GRID_CLASS = APPOINTMENT_TIME_SLOTS_GRID_CLASS;

/** Inner label — keeps HH:mm centered and ellipsized if space is tight. */
export const APPOINTMENT_TIME_SLOT_LABEL_CLASS = 'ap-time-slot-label';

/**
 * Staff/dashboard slot button — shares base sizing with `.ap-time-slot` via `.ap-time-slot-btn`
 * in globals.css; brand hover uses Tailwind outside `.appointment-public`.
 */
export const APPOINTMENT_STAFF_TIME_SLOT_CLASS =
  'ap-time-slot-btn transition-[border-color,color,box-shadow,transform] duration-150 hover:border-brand-300 hover:text-brand-600 hover:shadow-md active:scale-[0.97]';

export function appointmentTimeSlotClass(selected = false, isPublic = true): string {
  if (!isPublic) {
    return APPOINTMENT_STAFF_TIME_SLOT_CLASS;
  }
  return selected ? 'ap-time-slot ap-time-slot-selected' : 'ap-time-slot';
}

/** Class names for DetailsStep when rendered inside the public appointment shell. */
export const APPOINTMENT_DETAILS_SUBMIT_CLASS =
  'ap-btn-primary min-h-[48px] w-full rounded-xl px-4 py-3 text-base font-semibold disabled:opacity-50';
export const APPOINTMENT_DETAILS_INPUT_CLASS =
  'min-h-[44px] w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-base placeholder:text-slate-400 ap-input-focus';

export { BRAND_ACCENT };
