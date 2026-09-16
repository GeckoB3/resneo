/**
 * "What guests will see" before a host saves (UX spec §2 item 15; plan contract 13's preview half).
 *
 * The preview's whole value is that it is not a guess: it applies the staged changes to what the
 * collective looks like now and answers per venue. So the tests are about the cases a host would
 * get wrong by eye: a service nobody's calendar offers, a venue that cannot take the payment, and
 * a change that only affects one venue.
 */
import { describe, expect, it } from 'vitest';
import { previewBulkOps, PREVIEW_REASON_WORDS } from './bulk-preview';
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

const assignment = (itemId: string) => ({
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

const groups = (): CollectiveCalendarGroup[] => [
  {
    venue_id: 'host',
    venue_name: 'Host Venue',
    is_host: true,
    sync: { venues: 1, applied: 1, pending: [], failed: [] },
    calendars: [{ id: 'cal-h1', name: 'Room 1', is_active: true, assigned: [assignment('item-1')] }],
  },
  {
    venue_id: 'member',
    venue_name: 'Zen Studio',
    is_host: false,
    sync: { venues: 1, applied: 1, pending: [], failed: [] },
    calendars: [
      { id: 'cal-m1', name: 'Chair 2', is_active: true, assigned: [] },
      { id: 'cal-m2', name: 'Spare', is_active: false, assigned: [] },
    ],
  },
];

const services = (overrides: Partial<CollectiveServiceBlock> = {}) => [
  { id: 'svc-1', name: 'Facial', collective: block(overrides) },
  { id: 'svc-2', name: 'Massage', collective: block({ role: 'parked', item_id: null, status: 'hidden' }) },
];

describe('previewBulkOps', () => {
  it('says what each venue shows today when nothing is staged', () => {
    const { venues } = previewBulkOps({ services: services(), groups: groups(), ops: [] });
    expect(venues.map((v) => v.venue_name)).toEqual(['Host Venue', 'Zen Studio']);
    expect(venues[0]!.shows.map((s) => s.name)).toEqual(['Facial']);
    // The member has the service but no calendar offering it, which is the commonest surprise.
    expect(venues[1]!.hides).toEqual([{ service_id: 'svc-1', name: 'Facial', reason: 'no_calendars' }]);
  });

  it('shows a service at a venue once a calendar there would offer it', () => {
    const { venues } = previewBulkOps({
      services: services(),
      groups: groups(),
      ops: [{ op: 'assign', service_id: 'svc-1', venue_id: 'member', calendar_id: 'cal-m1' }],
    });
    expect(venues[1]!.shows.map((s) => s.name)).toEqual(['Facial']);
    expect(venues[1]!.hides).toEqual([]);
  });

  it('takes it away again when the host stages the removal', () => {
    const { venues } = previewBulkOps({
      services: services(),
      groups: groups(),
      ops: [{ op: 'unassign', service_id: 'svc-1', venue_id: 'host', calendar_id: 'cal-h1' }],
    });
    expect(venues[0]!.shows).toEqual([]);
    expect(venues[0]!.hides[0]).toMatchObject({ name: 'Facial', reason: 'no_calendars' });
  });

  it('ignores a calendar that is turned off, whatever is staged for it', () => {
    const { venues } = previewBulkOps({
      services: services(),
      groups: groups(),
      ops: [{ op: 'assign', service_id: 'svc-1', venue_id: 'member', calendar_id: 'cal-m2' }],
    });
    expect(venues[1]!.shows).toEqual([]);
  });

  it('keeps a venue that cannot take the payment out of the list, and says why', () => {
    const { venues } = previewBulkOps({
      services: services({
        hidden_reasons: [{ venue_id: 'member', venue_name: 'Zen Studio', reason: 'payments' }],
      }),
      groups: groups(),
      ops: [{ op: 'assign', service_id: 'svc-1', venue_id: 'member', calendar_id: 'cal-m1' }],
    });
    expect(venues[1]!.shows).toEqual([]);
    expect(venues[1]!.hides[0]).toMatchObject({ name: 'Facial', reason: 'payments' });
    expect(PREVIEW_REASON_WORDS.payments).toBe('card payments are not set up there');
  });

  it('adds a service the host is putting on the page, with nothing offering it yet', () => {
    const { venues } = previewBulkOps({
      services: services(),
      groups: groups(),
      ops: [{ op: 'offer', service_id: 'svc-2' }],
    });
    expect(venues[0]!.hides.map((h) => h.name)).toContain('Massage');
    expect(venues[0]!.shows.map((s) => s.name)).toEqual(['Facial']);
  });

  it('drops a service the host is taking off the page from every venue', () => {
    const { venues } = previewBulkOps({
      services: services(),
      groups: groups(),
      ops: [{ op: 'withdraw', service_id: 'svc-1' }],
    });
    expect(venues.every((v) => v.shows.length === 0 && v.hides.length === 0)).toBe(true);
  });

  it('is unmoved by a retry, which changes nothing about what is offered', () => {
    const before = previewBulkOps({ services: services(), groups: groups(), ops: [] });
    const after = previewBulkOps({
      services: services(),
      groups: groups(),
      ops: [{ op: 'retry', service_id: 'svc-1', venue_id: 'member' }],
    });
    expect(after).toEqual(before);
  });
});
