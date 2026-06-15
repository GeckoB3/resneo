'use client';

type AppointmentPlanModel = 'unified_scheduling' | 'event_ticket' | 'class_session' | 'resource_booking';

interface Props {
  isLightPlan: boolean;
  activeModels: AppointmentPlanModel[];
  modelLabel: Record<AppointmentPlanModel, string>;
  staffTerm: string;
}

interface ModelDescription {
  label: string;
  description: string;
  example: string;
}

function buildModelDescription(
  model: AppointmentPlanModel,
  label: string,
  staffTerm: string,
): ModelDescription {
  switch (model) {
    case 'unified_scheduling':
      return {
        label,
        description: `One-to-one bookings with a ${staffTerm.toLowerCase()}, room, or resource. Guests pick a time that suits them from your schedule.`,
        example: 'e.g. 30-minute consultation, 60-minute massage, hair colouring service.',
      };
    case 'class_session':
      return {
        label,
        description: 'Recurring group sessions that many guests book into the same time slot.',
        example: 'e.g. Yoga class, pottery workshop, Pilates, kids’ swim lesson.',
      };
    case 'event_ticket':
      return {
        label,
        description: 'One-off or recurring ticketed occasions with limited capacity and optional ticket types.',
        example: 'e.g. Live music night, wine tasting, guided tour, masterclass.',
      };
    case 'resource_booking':
      return {
        label,
        description: 'Slot-based bookings for something guests rent, like a court, room, or piece of kit.',
        example: 'e.g. Tennis court, meeting room, studio, salon chair, padel pitch.',
      };
  }
}

export function AppointmentsWelcomeStep({
  isLightPlan,
  activeModels,
  modelLabel,
  staffTerm,
}: Props) {
  const modelCards = activeModels.map((m) => buildModelDescription(m, modelLabel[m], staffTerm));

  const stepPreviews: { title: string; summary: string; example: string; show: boolean }[] = [
    {
      title: 'Business profile',
      summary: 'Your public name, address, phone, and currency.',
      example: 'Shown on your booking page and in confirmation emails.',
      show: true,
    },
    {
      title: 'Opening hours',
      summary: 'The outer window when your business accepts online bookings.',
      example: 'e.g. Mon–Fri 09:00–18:00. Per-calendar hours come next.',
      show: true,
    },
    {
      title: isLightPlan ? 'Your calendar' : 'Calendars',
      summary: isLightPlan
        ? 'Name your single bookable calendar.'
        : `Add a calendar lane for each ${staffTerm.toLowerCase()}, room, or resource.`,
      example: isLightPlan
        ? 'Often your name or business name.'
        : 'e.g. Dr Smith, Dr Jones, Room A, Room B.',
      show: true,
    },
    {
      title: 'Calendar availability',
      summary: 'Weekly working hours for each calendar.',
      example: 'Bookings are offered where opening hours and calendar hours overlap.',
      show: activeModels.length > 0,
    },
    {
      title: 'Other users',
      summary: 'Invite teammates so they can sign in and help run the diary.',
      example: 'Admins manage everything; staff run day-to-day.',
      show: !isLightPlan,
    },
    ...(activeModels.includes('unified_scheduling')
      ? [
          {
            title: 'Appointments setup',
            summary: 'The services guests can book with you.',
            example: 'Duration, price, buffer, payment, and which calendars offer each service.',
            show: true,
          },
        ]
      : []),
    ...(activeModels.includes('class_session')
      ? [
          {
            title: 'Classes setup',
            summary: 'Class types with a duration, capacity, and price.',
            example: 'Schedule the sessions themselves later from the Class timetable.',
            show: true,
          },
        ]
      : []),
    ...(activeModels.includes('event_ticket')
      ? [
          {
            title: 'Events setup',
            summary: 'Your first one-off or recurring ticketed event.',
            example: 'Add dates, capacity, ticket types, and an image. Skippable if you’d rather wait.',
            show: true,
          },
        ]
      : []),
    ...(activeModels.includes('resource_booking')
      ? [
          {
            title: 'Resources setup',
            summary: 'Slot-based bookings like courts, rooms, or equipment.',
            example: 'Weekly availability, slot length, pricing, and how it shows on the calendar.',
            show: true,
          },
        ]
      : []),
    {
      title: 'Your dashboard',
      summary: 'A guided tour of where you’ll work every day.',
      example: 'Calendar, Bookings, plus Events / Classes / Resources tabs when enabled.',
      show: true,
    },
    {
      title: 'Payments (optional)',
      summary: 'Connect Stripe if you want deposits or prepayment.',
      example: 'Skippable: guests can still book for free while you set this up later.',
      show: true,
    },
    {
      title: 'Review & go live',
      summary: 'A final summary and your public booking link.',
      example: 'Share the link and start taking bookings straight away.',
      show: true,
    },
  ].filter((c) => c.show);

  return (
    <div>
      <div className="mb-6 flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25m10.5-2.25V5.25M3.75 8.25h16.5M4.5 6h15A1.5 1.5 0 0 1 21 7.5V19.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5V7.5A1.5 1.5 0 0 1 4.5 6Z" />
          </svg>
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-slate-900">Welcome to ResNeo</h2>
          <p className="mt-1 text-sm text-slate-500">
            {isLightPlan
              ? 'Let’s get your diary ready in about 10 minutes. Every step is skippable, so you can always finish later from your dashboard.'
              : 'Let’s get your diary ready in about 10–15 minutes. Every step is skippable, so you can always finish later from your dashboard.'}
          </p>
        </div>
      </div>

      {modelCards.length > 0 && (
        <div className="mb-6 rounded-xl border border-brand-100 bg-brand-50/50 p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-800">
            {modelCards.length === 1 ? 'Booking model enabled' : 'Booking models enabled'}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {modelCards.map((m) => (
              <div key={m.label} className="rounded-lg border border-brand-100 bg-white p-3 shadow-sm">
                <p className="text-sm font-semibold text-slate-900">{m.label}</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">{m.description}</p>
                <p className="mt-1 text-[11px] italic leading-relaxed text-slate-400">{m.example}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-600">
            {isLightPlan
              ? 'You can change booking models later from Settings → Profile.'
              : 'You can enable or disable booking models later from Settings → Profile. This flow makes sure the ones above are ready to use straight away.'}
          </p>
        </div>
      )}

      <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-700">
        <p className="mb-1 font-medium text-slate-800">What we’ll set up together</p>
        <p className="text-sm text-slate-600">
          We’ll ask a few questions about how your business runs and pre-fill sensible defaults. Nothing is
          final: you can change every setting later from the dashboard.
        </p>
      </div>

      <ol className="mb-6 grid gap-2 sm:grid-cols-2">
        {stepPreviews.map((card, idx) => (
          <li
            key={card.title}
            className="flex gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm"
          >
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">
              {idx + 1}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-slate-900">{card.title}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-slate-600">{card.summary}</span>
              <span className="mt-1 block text-[11px] italic leading-relaxed text-slate-400">{card.example}</span>
            </span>
          </li>
        ))}
      </ol>

      <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-600">
        <p className="mb-1 font-medium text-slate-800">New to booking software?</p>
        <p>
          No problem. Each step explains what the setting does, why it matters, and shows an example. When in
          doubt, accept the defaults and click Continue.
        </p>
      </div>
    </div>
  );
}
