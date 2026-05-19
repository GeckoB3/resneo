import { describe, expect, it, vi } from 'vitest';
import { enrichWaitlistEntriesForDisplay } from './waitlist-entry-display';

describe('enrichWaitlistEntriesForDisplay', () => {
  it('maps service and practitioner names onto entry ids', async () => {
    const serviceChain = {
      select: vi.fn(() => ({
        in: vi.fn(async () => ({
          data: [{ id: 'svc-1', name: 'Cut & blow-dry' }],
        })),
      })),
    };
    const calendarChain = {
      select: vi.fn(() => ({
        in: vi.fn(async () => ({
          data: [{ id: 'cal-1', name: 'Sam' }],
        })),
      })),
    };
    const admin = {
      from: vi.fn((table: string) => {
        if (table === 'service_items') return serviceChain;
        if (table === 'unified_calendars') return calendarChain;
        if (table === 'appointment_services') {
          return {
            select: vi.fn(() => ({ in: vi.fn(async () => ({ data: [] })) })),
          };
        }
        return {
          select: vi.fn(() => ({ in: vi.fn(async () => ({ data: [] })) })),
        };
      }),
    };

    const map = await enrichWaitlistEntriesForDisplay(admin as never, [
      {
        id: 'w1',
        service_item_id: 'svc-1',
        appointment_service_id: null,
        practitioner_id: 'cal-1',
      },
    ]);

    expect(map.get('w1')).toEqual({
      service_name: 'Cut & blow-dry',
      practitioner_name: 'Sam',
    });
  });
});
