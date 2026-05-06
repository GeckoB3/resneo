'use client';

type AppointmentPlanModel = 'unified_scheduling' | 'event_ticket' | 'class_session' | 'resource_booking';

interface Props {
  activeModels: AppointmentPlanModel[];
  isLightPlan: boolean;
  staffTerm: string;
  hasTeamCalendars: boolean;
}

interface DashboardCard {
  title: string;
  description: string;
  detail: string;
  active: boolean;
  badge?: string;
}

export function AppointmentsDashboardStep({
  activeModels,
  isLightPlan,
  staffTerm,
  hasTeamCalendars,
}: Props) {
  const hasAppointments = activeModels.includes('unified_scheduling');
  const hasEvents = activeModels.includes('event_ticket');
  const hasClasses = activeModels.includes('class_session');
  const hasResources = activeModels.includes('resource_booking');

  const cards: DashboardCard[] = [
    {
      title: 'Appointment Calendar',
      description: 'Your day-to-day schedule view.',
      detail: hasTeamCalendars
        ? `A column per ${staffTerm.toLowerCase()}, room, or resource with bookings laid out by time. Drag to move, click to edit, and add bookings with a tap.`
        : 'A timeline of your day with every booking in order. Drag to move, click to edit, and add bookings with a tap.',
      active: true,
      badge: hasAppointments ? 'Your main view' : undefined,
    },
    {
      title: 'Bookings',
      description: 'Find, filter, and manage every booking in one place.',
      detail:
        'Search by guest, date, or status. Create phone bookings, edit details, reschedule, cancel, or mark as checked in.',
      active: true,
      badge: 'All models',
    },
    {
      title: 'Contacts',
      description: 'Your guest list with contact details and booking history.',
      detail:
        'Search, tag, and take notes on regulars. Spot first-time visitors and follow up on cancellations or no-shows.',
      active: true,
    },
    {
      title: 'Class timetable',
      description: 'Publish and manage recurring class sessions.',
      detail: hasClasses
        ? 'Create class types, generate the week’s sessions, manage attendance, and track capacity at a glance.'
        : 'Unlocks when you add the Classes booking model from Settings → Plan.',
      active: hasClasses,
      badge: hasClasses ? 'Classes' : 'Disabled',
    },
    {
      title: 'Event manager',
      description: 'Create and publish ticketed events.',
      detail: hasEvents
        ? 'Set up ticket types, manage capacity, see the attendee list, and publish events to your public Events tab.'
        : 'Unlocks when you add the Events booking model from Settings → Plan.',
      active: hasEvents,
      badge: hasEvents ? 'Events' : 'Disabled',
    },
    {
      title: 'Resource timeline',
      description: 'Manage bookable facilities and their reservations.',
      detail: hasResources
        ? 'Create courts, rooms, or equipment guests can book in fixed slots; set weekly hours, intervals, and pricing. Upcoming bookings appear here and on the Appointment Calendar column each resource is shown on.'
        : 'Unlocks when you add the Resources booking model from Settings → Plan.',
      active: hasResources,
      badge: hasResources ? 'Resources' : 'Disabled',
    },
  ];

  return (
    <div>
      <h2 className="mb-1 text-lg font-bold text-slate-900">Where you’ll work every day</h2>
      <p className="mb-4 text-sm text-slate-500">
        A quick tour of the dashboard so nothing feels unfamiliar on day one. You can always come back here from
        Settings → Help.
      </p>

      <div className="mb-6 rounded-xl border border-brand-100 bg-brand-50/50 p-4 text-sm text-slate-700">
        <p className="mb-1 font-medium text-slate-800">Your primary live view</p>
        <p className="text-slate-600">
          {hasAppointments
            ? 'The Appointment Calendar is where most Appointments plans spend the day. It shows today’s bookings at a glance, and you can add, move, or edit bookings inline.'
            : hasClasses
              ? 'The Class timetable is where you’ll spend most of your time. It shows every session with attendance, capacity, and quick actions.'
              : hasEvents
                ? 'The Event manager is your home base. It shows upcoming events, ticket sales, and attendee lists.'
                : hasResources
                  ? 'The Resource timeline is your home base for facility booking: configure each resource, its weekly hours and slot rules, and review upcoming reservations.'
                  : 'Your dashboard adapts to the booking models you have enabled.'}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map((card) => (
          <div
            key={card.title}
            className={`rounded-xl border p-4 ${
              card.active
                ? 'border-slate-200 bg-white shadow-sm'
                : 'border-slate-100 bg-slate-50/60 opacity-70'
            }`}
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <p className="font-semibold text-slate-900">{card.title}</p>
              {card.badge && (
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                    card.active ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {card.badge}
                </span>
              )}
            </div>
            <p className="mb-2 text-sm font-medium text-slate-700">{card.description}</p>
            <p className="text-xs text-slate-500">{card.detail}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-600">
        <p className="mb-1 font-medium text-slate-800">A few things to know</p>
        <ul className="list-inside list-disc space-y-1.5">
          <li>
            {isLightPlan
              ? 'Every booking made by a guest or by you appears on the calendar and in Bookings automatically.'
              : 'Every booking made by a guest, by you, or by another user appears on the calendar and in Bookings automatically.'}
          </li>
          <li>
            You can share your public booking page URL on your website, Instagram bio, or Google Business
            profile, so guests can book 24/7.
          </li>
          <li>
            Notifications (emails and optional SMS) are sent to guests automatically on booking, rescheduling,
            and cancellation. Adjust templates, timing, and policies anytime in Settings → Communications.
          </li>
        </ul>
      </div>
    </div>
  );
}
