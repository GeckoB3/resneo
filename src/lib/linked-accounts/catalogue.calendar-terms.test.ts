import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/availability/appointment-catalog', () => ({
  fetchAppointmentCatalog: vi.fn(),
}));

import { fetchAppointmentCatalog } from '@/lib/availability/appointment-catalog';
import { calendarServiceTermsKey, loadVenueCatalogueData } from './catalogue';

const mockCatalog = vi.mocked(fetchAppointmentCatalog);

/** A catalogue service as `fetchAppointmentCatalog` returns it: already merged with the calendar. */
function svc(id: string, durationMinutes: number, pricePence: number | null) {
  return {
    id,
    name: 'Cut',
    description: null,
    duration_minutes: durationMinutes,
    buffer_minutes: 0,
    price_pence: pricePence,
    deposit_pence: null,
    sort_order: 0,
    category: null,
    payment_requirement: 'none',
    cancellation_notice_hours: 48,
    variants: [],
    addon_groups: [],
    processing_time_blocks: durationMinutes === 50 ? [{ start_minute: 20, duration_minutes: 10 }] : [],
  };
}

describe('loadVenueCatalogueData calendar terms (CB-01)', () => {
  beforeEach(() => {
    mockCatalog.mockReset();
    // Plain chair books the service's own 30 min / 25.00; Senior chair has its own 50 min / 22.00.
    mockCatalog.mockResolvedValue({
      practitioners: [
        { id: 'cal-plain', name: 'Plain chair', services: [svc('s1', 30, 2500)] },
        { id: 'cal-senior', name: 'Senior chair', services: [svc('s1', 50, 2200)] },
      ],
      categories: [],
    } as never);
  });

  it("keeps each calendar's own price and length instead of the first calendar's", async () => {
    const data = await loadVenueCatalogueData({} as never, 'venue-1');
    expect(data.calendarServiceTerms.get(calendarServiceTermsKey('cal-plain', 's1'))).toEqual({
      durationMinutes: 30,
      pricePence: 2500,
      processingBlocks: [],
    });
    expect(data.calendarServiceTerms.get(calendarServiceTermsKey('cal-senior', 's1'))).toEqual({
      durationMinutes: 50,
      pricePence: 2200,
      processingBlocks: [{ start_minute: 20, duration_minutes: 10 }],
    });
  });

  it('summarises the service with the lowest price and shortest length for labels', async () => {
    const data = await loadVenueCatalogueData({} as never, 'venue-1');
    expect(data.services.get('s1')).toMatchObject({ pricePence: 2200, durationMinutes: 30 });
    expect(data.serviceCalendars.get('s1')).toEqual(['cal-plain', 'cal-senior']);
  });

  it('does not depend on calendar order', async () => {
    mockCatalog.mockResolvedValue({
      practitioners: [
        { id: 'cal-senior', name: 'Senior chair', services: [svc('s1', 50, 2200)] },
        { id: 'cal-plain', name: 'Plain chair', services: [svc('s1', 30, 2500)] },
      ],
      categories: [],
    } as never);
    const data = await loadVenueCatalogueData({} as never, 'venue-1');
    expect(data.calendarServiceTerms.get(calendarServiceTermsKey('cal-plain', 's1'))?.pricePence).toBe(2500);
    expect(data.services.get('s1')).toMatchObject({ pricePence: 2200, durationMinutes: 30 });
  });
});
