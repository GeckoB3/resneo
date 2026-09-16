/**
 * "What needs you" (UX spec §2 item 3; the Collective area's overview).
 *
 * The strip earns its place by being short and true: only what this venue can act on, counted per
 * venue rather than per service, and nothing at all when there is nothing to do. These pin the
 * judgement calls, because a strip that cries wolf is worse than no strip.
 */
import { describe, expect, it } from 'vitest';
import { buildCollectiveTodos, type CollectiveTodoService } from './collective-todos';
import type { CollectiveCalendarGroup } from './host-calendars';
import type { CollectiveServiceBlock } from './service-blocks';

const block = (overrides: Partial<CollectiveServiceBlock> = {}): CollectiveServiceBlock => ({
  role: 'master',
  collective_id: 'collective-1',
  collective_name: 'Northside',
  host_venue_name: 'Host Venue',
  item_id: 'item-1',
  locked_fields: [],
  delegated_fields: [],
  status: 'up_to_date',
  status_reason: null,
  last_applied_at: null,
  hidden_reasons: [],
  ...overrides,
});

const service = (overrides: Partial<CollectiveTodoService> = {}): CollectiveTodoService => ({
  id: 'svc-1',
  name: 'Facial',
  collective: block(),
  ...overrides,
});

const group = (overrides: Partial<CollectiveCalendarGroup> = {}): CollectiveCalendarGroup => ({
  venue_id: 'member',
  venue_name: 'Zen Studio',
  is_host: false,
  sync: { venues: 1, applied: 1, pending: [], failed: [] },
  calendars: [{ id: 'cal-1', name: 'Chair 2', is_active: true, assigned: [] }],
  ...overrides,
});

const assigned = (itemId = 'item-1') => ({
  item_id: itemId,
  service_id: 'svc-x',
  values: {
    custom_price_pence: null,
    custom_duration_minutes: null,
    custom_name: null,
    custom_description: null,
    custom_buffer_minutes: null,
    custom_deposit_pence: null,
    custom_colour: null,
  },
  last_changed: null,
});

describe('a host', () => {
  it('is told about a service on the page that no calendar anywhere offers', () => {
    const todos = buildCollectiveTodos({ isHost: true, services: [service()], calendarGroups: [group()] });
    expect(todos[0]!.text).toBe('Facial is on the page but no calendar offers it, so guests cannot book it.');
    expect(todos[0]!.action).toEqual({ kind: 'service', serviceId: 'svc-1', label: 'Choose calendars' });
  });

  it('says nothing about a service a calendar already offers', () => {
    const todos = buildCollectiveTodos({
      isHost: true,
      services: [service()],
      calendarGroups: [
        group({ calendars: [{ id: 'cal-1', name: 'Chair 2', is_active: true, assigned: [assigned()] }] }),
      ],
    });
    expect(todos).toEqual([]);
  });

  it('asks for a new venue once, not once per service', () => {
    const todos = buildCollectiveTodos({
      isHost: true,
      services: [
        service({ collective: block() }),
        service({ id: 'svc-2', name: 'Massage', collective: block({ item_id: 'item-2' }) }),
      ],
      calendarGroups: [
        group({
          venue_id: 'host',
          venue_name: 'Host Venue',
          is_host: true,
          calendars: [
            { id: 'cal-host', name: 'Room 1', is_active: true, assigned: [assigned('item-1'), assigned('item-2')] },
          ],
        }),
        group(),
      ],
    });
    expect(todos.filter((t) => t.id.startsWith('new-venue'))).toHaveLength(1);
    expect(todos.find((t) => t.id.startsWith('new-venue'))!.text).toBe(
      'Zen Studio has joined. Choose their calendars on 2 services.',
    );
  });

  it('counts a venue that cannot take payments once, however many services it holds', () => {
    const hidden = [{ venue_id: 'member', venue_name: 'Zen Studio', reason: 'payments' as const }];
    const todos = buildCollectiveTodos({
      isHost: true,
      services: [
        service({ collective: block({ hidden_reasons: hidden }) }),
        service({ id: 'svc-2', name: 'Massage', collective: block({ item_id: 'item-2', hidden_reasons: hidden }) }),
      ],
      calendarGroups: [
        group({
          calendars: [
            { id: 'cal-1', name: 'Chair 2', is_active: true, assigned: [assigned('item-1'), assigned('item-2')] },
          ],
        }),
      ],
    });
    const payments = todos.filter((t) => t.id.startsWith('payments'));
    expect(payments).toHaveLength(1);
    expect(payments[0]!.text).toBe(
      'Zen Studio cannot take card payments yet, so 2 paid services are hidden from guests there.',
    );
    // A host cannot connect another venue's Stripe, so the row offers no shortcut it cannot honour.
    expect(payments[0]!.action).toBeUndefined();
  });

  it('offers the one Retry for a venue an update did not reach', () => {
    const todos = buildCollectiveTodos({
      isHost: true,
      services: [service({ collective: block({ status: 'failed' }) })],
      calendarGroups: [
        group({
          sync: {
            venues: 1,
            applied: 0,
            pending: [],
            failed: [{ venue_id: 'member', venue_name: 'Zen Studio', message: 'busy', code: 'lock_timeout' }],
          },
          calendars: [{ id: 'cal-1', name: 'Chair 2', is_active: true, assigned: [assigned()] }],
        }),
      ],
    });
    const failed = todos.find((t) => t.id.startsWith('failed'));
    expect(failed!.text).toBe('1 service could not be updated at Zen Studio.');
    expect(failed!.action).toEqual({ kind: 'retry', venueId: 'member', label: 'Retry now' });
  });
});

describe('a member', () => {
  const replica = (overrides: Partial<CollectiveServiceBlock> = {}) =>
    service({ collective: block({ role: 'replica', ...overrides }) });

  it('is told which of the services it holds none of its calendars offer', () => {
    const todos = buildCollectiveTodos({
      isHost: false,
      services: [replica()],
      ownCalendarCount: () => 0,
    });
    expect(todos[0]!.text).toContain('no calendar offers it');
  });

  it('says nothing when its calendars already offer them', () => {
    const todos = buildCollectiveTodos({ isHost: false, services: [replica()], ownCalendarCount: () => 2 });
    expect(todos).toEqual([]);
  });

  it('gets the link to the thing it can fix itself', () => {
    const todos = buildCollectiveTodos({
      isHost: false,
      services: [
        replica({ hidden_reasons: [{ venue_id: 'member', venue_name: 'Zen Studio', reason: 'forms' }] }),
      ],
      ownCalendarCount: () => 1,
      ownVenueId: 'member',
    });
    expect(todos[0]!.text).toContain('has forms switched off');
    expect(todos[0]!.action).toEqual({ kind: 'forms', label: 'Turn on' });
  });
});

describe('the strip itself', () => {
  it('is empty when nothing is on the page', () => {
    expect(buildCollectiveTodos({ isHost: true, services: [service({ collective: null })] })).toEqual([]);
  });

  it('ignores parked and retired services, which are not on the page', () => {
    expect(
      buildCollectiveTodos({
        isHost: true,
        services: [
          service({ collective: block({ role: 'parked', item_id: null }) }),
          service({ id: 'svc-2', collective: block({ role: 'retired' }) }),
        ],
        calendarGroups: [group()],
      }),
    ).toEqual([]);
  });

  it('stays a strip rather than becoming a list nobody reads', () => {
    const services = Array.from({ length: 12 }, (_, i) =>
      service({ id: `svc-${i}`, name: `Service ${i}`, collective: block({ item_id: `item-${i}` }) }),
    );
    const todos = buildCollectiveTodos({ isHost: true, services, calendarGroups: [group()] });
    expect(todos).toHaveLength(5);
  });
});
