import { describe, it, expect, vi } from 'vitest';
import {
  fetchExperienceEventBlocksForCalendar,
  fetchClassInstanceBlocksForCalendar,
  fetchScheduledSessionBlocksForCalendar,
} from './calendar-session-blocks';

vi.mock('@/lib/class-instances/instructor-calendar-block', () => ({
  resolveInstructorCalendarIdForClass: vi.fn(async (_admin: unknown, _venueId: string, instructorId: string | null) => {
    // Resources and legacy ids forward to a host calendar; everything else is its own column.
    if (instructorId === 'resource-row') return 'cal-1';
    if (instructorId === 'other-staff') return 'cal-2';
    return instructorId;
  }),
}));

type QueryResult = { data: unknown[] | null; error: { message: string } | null };

/**
 * Builds a deterministic Supabase query-chain stub keyed by the first table referenced.
 * Each handler receives the filters passed via `.eq()`/`.in()` calls.
 */
function makeAdmin(handlers: Record<string, (filters: Record<string, unknown>) => QueryResult>) {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {
        select: vi.fn(() => chain),
        eq: vi.fn((col: string, val: unknown) => {
          filters[col] = val;
          return chain;
        }),
        in: vi.fn((col: string, vals: unknown[]) => {
          filters[col] = vals;
          return chain;
        }),
        maybeSingle: vi.fn(() => chain),
        single: vi.fn(() => chain),
        then: (resolve: (v: QueryResult) => unknown) => {
          const handler = handlers[table];
          return Promise.resolve(handler ? handler(filters) : { data: [], error: null }).then(resolve);
        },
      };
      return chain;
    },
  } as unknown as Parameters<typeof fetchExperienceEventBlocksForCalendar>[0];
}

describe('fetchExperienceEventBlocksForCalendar', () => {
  it('maps active event rows to inclusive-exclusive minute ranges', async () => {
    const admin = makeAdmin({
      experience_events: () => ({
        data: [
          { start_time: '10:00:00', end_time: '12:00:00' },
          { start_time: '14:30', end_time: '15:30' },
        ],
        error: null,
      }),
    });

    const out = await fetchExperienceEventBlocksForCalendar(admin, 'v1', 'cal-1', '2030-01-05');
    expect(out).toEqual([
      { start: 10 * 60, end: 12 * 60 },
      { start: 14 * 60 + 30, end: 15 * 60 + 30 },
    ]);
  });

  it('returns [] on query error and logs a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const admin = makeAdmin({
      experience_events: () => ({ data: null, error: { message: 'boom' } }),
    });

    const out = await fetchExperienceEventBlocksForCalendar(admin, 'v1', 'cal-1', '2030-01-05');
    expect(out).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('drops zero or negative-length rows', async () => {
    const admin = makeAdmin({
      experience_events: () => ({
        data: [{ start_time: '10:00', end_time: '10:00' }],
        error: null,
      }),
    });

    const out = await fetchExperienceEventBlocksForCalendar(admin, 'v1', 'cal-1', '2030-01-05');
    expect(out).toEqual([]);
  });
});

describe('fetchClassInstanceBlocksForCalendar', () => {
  it('keeps only classes whose instructor resolves to the target calendar', async () => {
    const admin = makeAdmin({
      class_types: () => ({
        data: [
          { id: 'ct-same', duration_minutes: 45, instructor_id: 'cal-1' },       // direct match
          { id: 'ct-via-resource', duration_minutes: 60, instructor_id: 'resource-row' }, // chains to cal-1
          { id: 'ct-other', duration_minutes: 30, instructor_id: 'other-staff' }, // resolves to cal-2
        ],
        error: null,
      }),
      class_instances: (filters) => {
        const inList = (filters.class_type_id as string[]) ?? [];
        const rows: Array<{ start_time: string; class_type_id: string }> = [];
        if (inList.includes('ct-same')) rows.push({ start_time: '09:00:00', class_type_id: 'ct-same' });
        if (inList.includes('ct-via-resource')) rows.push({ start_time: '11:30', class_type_id: 'ct-via-resource' });
        return { data: rows, error: null };
      },
    });

    const out = await fetchClassInstanceBlocksForCalendar(admin, 'v1', 'cal-1', '2030-01-05');
    expect(out).toEqual(
      expect.arrayContaining([
        { start: 9 * 60, end: 9 * 60 + 45 },
        { start: 11 * 60 + 30, end: 12 * 60 + 30 },
      ]),
    );
    expect(out).toHaveLength(2);
  });

  it('falls back to a 60-minute duration when class_types.duration_minutes is missing or invalid', async () => {
    const admin = makeAdmin({
      class_types: () => ({
        data: [{ id: 'ct-missing', duration_minutes: null, instructor_id: 'cal-1' }],
        error: null,
      }),
      class_instances: () => ({
        data: [{ start_time: '08:00', class_type_id: 'ct-missing' }],
        error: null,
      }),
    });

    const out = await fetchClassInstanceBlocksForCalendar(admin, 'v1', 'cal-1', '2030-01-05');
    expect(out).toEqual([{ start: 8 * 60, end: 9 * 60 }]);
  });

  it('returns [] when no class types match the target calendar', async () => {
    const admin = makeAdmin({
      class_types: () => ({
        data: [{ id: 'ct-elsewhere', duration_minutes: 30, instructor_id: 'other-staff' }],
        error: null,
      }),
    });

    const out = await fetchClassInstanceBlocksForCalendar(admin, 'v1', 'cal-1', '2030-01-05');
    expect(out).toEqual([]);
  });
});

describe('fetchScheduledSessionBlocksForCalendar', () => {
  it('concatenates event and class ranges', async () => {
    const admin = makeAdmin({
      experience_events: () => ({
        data: [{ start_time: '18:00', end_time: '19:00' }],
        error: null,
      }),
      class_types: () => ({
        data: [{ id: 'ct-1', duration_minutes: 30, instructor_id: 'cal-1' }],
        error: null,
      }),
      class_instances: () => ({
        data: [{ start_time: '09:00', class_type_id: 'ct-1' }],
        error: null,
      }),
    });

    const out = await fetchScheduledSessionBlocksForCalendar(admin, 'v1', 'cal-1', '2030-01-05', {
      classes: true,
      events: true,
    });
    expect(out).toEqual(
      expect.arrayContaining([
        { start: 18 * 60, end: 19 * 60 },
        { start: 9 * 60, end: 9 * 60 + 30 },
      ]),
    );
    expect(out).toHaveLength(2);
  });

  /**
   * A model that is switched off must not block. These cover the bug this gating exists for:
   * the window kept holding the calendar after the model stopped being drawn on it.
   */
  describe('with a model switched off', () => {
    /** Records which tables were queried, so "skipped" means never asked, not merely discarded. */
    function makeCountingAdmin() {
      const tablesQueried: string[] = [];
      const admin = makeAdmin({
        experience_events: () => {
          tablesQueried.push('experience_events');
          return { data: [{ start_time: '18:00', end_time: '19:00' }], error: null };
        },
        class_types: () => {
          tablesQueried.push('class_types');
          return { data: [{ id: 'ct-1', duration_minutes: 30, instructor_id: 'cal-1' }], error: null };
        },
        class_instances: () => {
          tablesQueried.push('class_instances');
          return { data: [{ start_time: '09:00', class_type_id: 'ct-1' }], error: null };
        },
      });
      return { admin, tablesQueried };
    }

    it('drops class ranges but keeps events when the class model is off', async () => {
      const { admin, tablesQueried } = makeCountingAdmin();

      const out = await fetchScheduledSessionBlocksForCalendar(admin, 'v1', 'cal-1', '2030-01-05', {
        classes: false,
        events: true,
      });

      expect(out).toEqual([{ start: 18 * 60, end: 19 * 60 }]);
      expect(tablesQueried).toContain('experience_events');
      expect(tablesQueried).not.toContain('class_types');
    });

    it('drops event ranges but keeps classes when the event model is off', async () => {
      const { admin, tablesQueried } = makeCountingAdmin();

      const out = await fetchScheduledSessionBlocksForCalendar(admin, 'v1', 'cal-1', '2030-01-05', {
        classes: true,
        events: false,
      });

      expect(out).toEqual([{ start: 9 * 60, end: 9 * 60 + 30 }]);
      expect(tablesQueried).toContain('class_types');
      expect(tablesQueried).not.toContain('experience_events');
    });

    it('blocks nothing, and queries nothing, when both models are off', async () => {
      const { admin, tablesQueried } = makeCountingAdmin();

      const out = await fetchScheduledSessionBlocksForCalendar(admin, 'v1', 'cal-1', '2030-01-05', {
        classes: false,
        events: false,
      });

      expect(out).toEqual([]);
      expect(tablesQueried).toEqual([]);
    });
  });
});
