/**
 * "What needs you" (UX spec §2 item 3 and the Collective area's overview; W6).
 *
 * A short list of the things this venue can actually do something about, in the same shape for a
 * host and for a member so the two roles learn one pattern. Everything else the collective knows
 * about a service belongs on that service's own card, not here: this is for the handful of things
 * that stop guests booking and that nobody will notice otherwise.
 *
 * Pure: the page hands it what it already loaded, and gets back rows to render.
 */
import { collectiveCopy, type CollectiveCopyId } from '@/lib/linked-accounts/collective-copy';
import type { CollectiveCalendarGroup } from '@/lib/linked-accounts/replicas/host-calendars';
import type { CollectiveServiceBlock } from '@/lib/linked-accounts/replicas/service-blocks';

export type CollectiveTodoAction =
  | { kind: 'service'; serviceId: string; label: string }
  | { kind: 'venue_calendars'; venueId: string; label: string }
  | { kind: 'payments'; label: string }
  | { kind: 'forms'; label: string }
  | { kind: 'retry'; venueId: string; label: string };

export interface CollectiveTodo {
  id: string;
  text: string;
  action?: CollectiveTodoAction;
}

export interface CollectiveTodoService {
  id: string;
  name: string;
  collective: CollectiveServiceBlock | null;
}

export interface CollectiveTodoInput {
  isHost: boolean;
  services: CollectiveTodoService[];
  /** Host only: every venue in the collective and what each of its calendars offers. */
  calendarGroups?: CollectiveCalendarGroup[];
  /** Member only: how many of its own calendars offer each of its services. */
  ownCalendarCount?: (serviceId: string) => number;
  /** Member only: its own venue id, to read the hidden reasons that are about itself. */
  ownVenueId?: string | null;
  /** A strip is a strip: past this many rows it is a list nobody reads. */
  limit?: number;
}

/** One service reads as one service: the deck carries both, and the count decides. */
const counted = (id: CollectiveCopyId, count: number, params: Record<string, string | number>): string =>
  collectiveCopy(count === 1 ? (`${id}One` as CollectiveCopyId) : id, { ...params, count });

/** What needs this venue, most urgent first, or an empty list when nothing does. */
export function buildCollectiveTodos(input: CollectiveTodoInput): CollectiveTodo[] {
  const onPage = input.services.filter(
    (s) => s.collective && s.collective.role !== 'parked' && s.collective.role !== 'retired',
  );
  if (onPage.length === 0) return [];

  const todos: CollectiveTodo[] = input.isHost ? hostTodos(input, onPage) : memberTodos(input, onPage);
  return todos.slice(0, input.limit ?? 5);
}

function hostTodos(input: CollectiveTodoInput, onPage: CollectiveTodoService[]): CollectiveTodo[] {
  const groups = input.calendarGroups ?? [];
  const todos: CollectiveTodo[] = [];

  // A service nobody's calendar offers cannot be booked anywhere, which is the worst state a
  // service on the page can be in and the easiest to miss.
  for (const service of onPage) {
    const itemId = service.collective?.item_id;
    if (!itemId) continue;
    const offered = groups.some((g) => g.calendars.some((c) => c.assigned.some((a) => a.item_id === itemId)));
    if (!offered) {
      todos.push({
        id: `no-calendars-${service.id}`,
        text: collectiveCopy('ov.todo.noCalendars', { service: service.name }),
        action: { kind: 'service', serviceId: service.id, label: collectiveCopy('svc.offer.chooseCalendars') },
      });
    }
  }

  // A venue that has joined and offers nothing yet: one row, not one per service.
  for (const group of groups) {
    if (group.is_host) continue;
    const offersAnything = group.calendars.some((c) => c.assigned.length > 0);
    if (!offersAnything && onPage.length > 0) {
      todos.push({
        id: `new-venue-${group.venue_id}`,
        text: counted('ov.todo.newVenue', onPage.length, { venue: group.venue_name }),
        action: {
          kind: 'venue_calendars',
          venueId: group.venue_id,
          label: collectiveCopy('svc.offer.chooseCalendars'),
        },
      });
    }
  }

  for (const group of groups) {
    for (const failure of group.sync.failed) {
      const count = onPage.filter((s) => s.collective?.status === 'failed').length || 1;
      todos.push({
        id: `failed-${failure.venue_id}`,
        text: counted('ov.todo.failed', count, { venue: failure.venue_name }),
        action: { kind: 'retry', venueId: failure.venue_id, label: collectiveCopy('svc.save.retry') },
      });
    }
  }

  // A host cannot connect another venue's Stripe or turn on its forms, so those rows say what is
  // in the way and stop there. The venue itself gets the link, on its own page.
  todos.push(...hiddenReasonTodos(onPage, { withActions: false }));
  return todos;
}

function memberTodos(input: CollectiveTodoInput, onPage: CollectiveTodoService[]): CollectiveTodo[] {
  const todos: CollectiveTodo[] = [];
  const count = input.ownCalendarCount;

  if (count) {
    for (const service of onPage) {
      if (count(service.id) === 0) {
        todos.push({
          id: `no-calendars-${service.id}`,
          text: collectiveCopy('ov.todo.noCalendars', { service: service.name }),
          action: { kind: 'service', serviceId: service.id, label: collectiveCopy('svc.offer.chooseCalendars') },
        });
      }
    }
  }

  todos.push(...hiddenReasonTodos(onPage, { onlyVenueId: input.ownVenueId ?? null, withActions: true }));
  return todos;
}

/**
 * The two things a venue fixes in its own settings, counted per venue rather than per service, so
 * twelve paid services are one row and not twelve.
 */
function hiddenReasonTodos(
  services: CollectiveTodoService[],
  options: { onlyVenueId?: string | null; withActions: boolean },
): CollectiveTodo[] {
  const onlyVenueId = options.onlyVenueId ?? null;
  const payments = new Map<string, { name: string; count: number }>();
  const forms = new Map<string, { name: string; count: number }>();
  for (const service of services) {
    for (const reason of service.collective?.hidden_reasons ?? []) {
      if (onlyVenueId && reason.venue_id !== onlyVenueId) continue;
      const bucket = reason.reason === 'payments' ? payments : reason.reason === 'forms' ? forms : null;
      if (!bucket) continue;
      const seen = bucket.get(reason.venue_id);
      bucket.set(reason.venue_id, { name: reason.venue_name, count: (seen?.count ?? 0) + 1 });
    }
  }

  const todos: CollectiveTodo[] = [];
  for (const [venueId, venue] of payments) {
    todos.push({
      id: `payments-${venueId}`,
      text: counted('ov.todo.noStripe', venue.count, { venue: venue.name }),
      ...(options.withActions
        ? { action: { kind: 'payments' as const, label: collectiveCopy('svc.member.card.connectStripe') } }
        : {}),
    });
  }
  for (const [venueId, venue] of forms) {
    todos.push({
      id: `forms-${venueId}`,
      text: counted('ov.todo.formsOff', venue.count, { venue: venue.name }),
      ...(options.withActions
        ? { action: { kind: 'forms' as const, label: collectiveCopy('svc.member.card.turnOn') } }
        : {}),
    });
  }
  return todos;
}
