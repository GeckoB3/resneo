/**
 * DIARY-01 (SB-39): a partner column is drawn from the partner's resolved schedule, not its weekly
 * template. The route sends the schedule and the partner venue's hours context; the diary resolves
 * them with `linkedPractitionerOpenRanges`, so a partner shut for the day shows shut.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb, type Responder } from '@/lib/testing/recording-supabase';

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createRouteHandlerClientFromHeaders: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) },
  })),
}));
vi.mock('@/lib/venue-auth', () => ({ getVenueStaff: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: vi.fn() }));
vi.mock('@/lib/linked-accounts/queries', () => ({ loadAccessibleLinkedVenueIds: vi.fn() }));
vi.mock('@/lib/linked-accounts/audit', () => ({ recordReadAudit: vi.fn() }));
vi.mock('@/lib/booking/unified-calendar-list', () => ({ venueUsesUnifiedCalendarList: vi.fn(async () => true) }));
vi.mock('@/lib/venue/service-variants', () => ({ loadVariantsForServices: vi.fn(async () => new Map()) }));
vi.mock('@/lib/booking/booking-list-row-label', () => ({ resolveBookingListRowLabels: vi.fn(async () => new Map()) }));
vi.mock('@/lib/linked-accounts/linked-schedule-blocks', () => ({
  buildLinkedVenueScheduleBlocks: vi.fn(async () => []),
  loadLinkedCdeColumnMaps: vi.fn(async () => ({ eventCalendarByEventId: new Map(), classCalendarByInstanceId: new Map() })),
}));

import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { loadAccessibleLinkedVenueIds } from '@/lib/linked-accounts/queries';
import { linkedPractitionerOpenRanges, type LinkedVenueCalendar } from '@/lib/linked-accounts/calendar';
import { GET } from './route';

const HOST = '11111111-1111-4111-8111-111111111111';
const MEMBER = '22222222-2222-4222-8222-222222222222';
// A Monday.
const DATE = '2026-10-12';

interface World {
  memberOpeningHours?: Record<string, unknown>;
  daysOff?: string[];
  leave?: Array<Record<string, unknown>>;
}

function world({ memberOpeningHours = { '1': { periods: [{ open: '09:00', close: '17:00' }] } }, daysOff = [], leave = [] }: World): Responder {
  return (call) => {
    if (call.table === 'venues') {
      return { data: [{ id: MEMBER, name: 'Bloom', timezone: 'Europe/London', opening_hours: memberOpeningHours }] };
    }
    if (call.table === 'unified_calendars') {
      return {
        data: [
          {
            id: 'cal-b',
            name: 'Sam',
            is_active: true,
            calendar_type: 'practitioner',
            // The weekly template alone says open all Monday.
            working_hours: { '1': [{ start: '09:00', end: '17:00' }] },
            break_times: [],
            break_times_by_day: null,
            days_off: daysOff,
            availability_exceptions: null,
            schedule_periods: null,
            working_hours_rota: null,
          },
        ],
      };
    }
    if (call.table === 'practitioner_leave_periods') return { data: leave };
    return { data: [] };
  };
}

async function memberColumn(w: World) {
  vi.mocked(getSupabaseAdminClient).mockReturnValue(makeRecordingDb(world(w)).db as unknown as SupabaseClient);
  const res = await GET(new NextRequest(`https://resneo.test/api/venue/linked-calendar?date=${DATE}`));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { venues: LinkedVenueCalendar[] };
  const venue = body.venues[0]!;
  const practitioner = venue.practitioners[0]!;
  return {
    template: practitioner.workingHours,
    open: linkedPractitionerOpenRanges(practitioner.id, practitioner.schedule, venue.hours, DATE),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getVenueStaff).mockResolvedValue({ id: 's', venue_id: HOST, email: 'a@b.c', role: 'admin', db: {} } as never);
  vi.mocked(loadAccessibleLinkedVenueIds).mockResolvedValue([
    { venueId: MEMBER, linkId: 'link-1', grant: { calendar: 'full_details', pii: true, act: 'create_edit_cancel', calendarIds: null } },
  ] as never);
});

describe('GET /api/venue/linked-calendar partner hours', () => {
  it('shows the partner open when its venue and calendar are open', async () => {
    const { open } = await memberColumn({});
    expect(open).toEqual([{ start: 540, end: 1020 }]);
  });

  it('shows the partner shut on a day its venue is closed, whatever the weekly template says', async () => {
    const { template, open } = await memberColumn({ memberOpeningHours: { '1': { closed: true } } });
    expect(template?.['1']).toEqual([{ start: '09:00', end: '17:00' }]);
    expect(open).toEqual([]);
  });

  it('shows the partner shut on a dated day off and on a full day of leave', async () => {
    expect((await memberColumn({ daysOff: [DATE] })).open).toEqual([]);
    const leave = [
      { practitioner_id: 'cal-b', start_date: DATE, end_date: DATE, unavailable_start_time: null, unavailable_end_time: null, leave_type: 'holiday' },
    ];
    expect((await memberColumn({ leave })).open).toEqual([]);
  });
});
