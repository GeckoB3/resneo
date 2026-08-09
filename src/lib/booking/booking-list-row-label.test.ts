import { describe, expect, it } from 'vitest';
import { resolveBookingListRowLabels } from '@/lib/booking/booking-list-row-label';

/**
 * A stand-in for the catalogue, so a test can describe a service that has since
 * been renamed or deleted simply by leaving it out.
 */
function db(tables: Record<string, Array<Record<string, unknown>>>) {
  return {
    from(table: string) {
      const rows = tables[table] ?? [];
      const builder = {
        select: () => builder,
        in: async (_col: string, ids: string[]) => ({
          data: rows.filter((r) => ids.includes(r.id as string)),
        }),
      };
      return builder as never;
    },
  };
}

const CATALOGUE = {
  service_items: [{ id: 'svc-1', name: 'Classic Cut' }],
  class_instances: [{ id: 'ci-1', class_type_id: 'ct-1' }],
  class_types: [{ id: 'ct-1', name: 'Morning Yoga' }],
};

describe('resolveBookingListRowLabels', () => {
  it('still reads the live catalogue for a booking taken before snapshots existed', async () => {
    const labels = await resolveBookingListRowLabels(db(CATALOGUE), [
      { id: 'b1', calendar_id: 'cal-1', service_item_id: 'svc-1' },
    ]);

    expect(labels.get('b1')).toBe('Classic Cut');
  });

  it('says what the booking was actually for after the service is renamed', async () => {
    const labels = await resolveBookingListRowLabels(db(CATALOGUE), [
      {
        id: 'b1',
        calendar_id: 'cal-1',
        service_item_id: 'svc-1',
        service_name_snapshot: 'Gents Cut',
      },
    ]);

    // The catalogue now says "Classic Cut". The booking was taken as "Gents Cut".
    expect(labels.get('b1')).toBe('Gents Cut');
  });

  it('survives the service being deleted and the link nulled', async () => {
    const labels = await resolveBookingListRowLabels(db(CATALOGUE), [
      { id: 'b1', calendar_id: 'cal-1', service_item_id: null, service_name_snapshot: 'Hot Towel Shave' },
    ]);

    expect(labels.get('b1')).toBe('Hot Towel Shave');
  });

  it('leaves a pre-snapshot booking blank once its service is gone, as it is today', async () => {
    const labels = await resolveBookingListRowLabels(db(CATALOGUE), [
      { id: 'b1', calendar_id: 'cal-1', service_item_id: null },
    ]);

    expect(labels.get('b1')).toBeUndefined();
  });

  it('does not let a service snapshot relabel a class booking', async () => {
    // Some rows carry both. The class must keep winning, as it does today.
    const labels = await resolveBookingListRowLabels(db(CATALOGUE), [
      {
        id: 'b1',
        class_instance_id: 'ci-1',
        service_item_id: 'svc-1',
        service_name_snapshot: 'Gents Cut',
      },
    ]);

    expect(labels.get('b1')).toBe('Morning Yoga');
  });

  it('ignores a blank snapshot rather than showing an empty label', async () => {
    const labels = await resolveBookingListRowLabels(db(CATALOGUE), [
      { id: 'b1', calendar_id: 'cal-1', service_item_id: 'svc-1', service_name_snapshot: '   ' },
    ]);

    expect(labels.get('b1')).toBe('Classic Cut');
  });
});
