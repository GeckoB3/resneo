import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Regression lock for review finding C4 (decision: REMOVE).
 *
 * The weekly-timetable -> instance-generation path was dead code: `generate-instances`
 * had no caller and no cron, and the `class_timetable` write entity produced no sessions.
 * It was removed in favour of the working bulk/one-off ClassScheduleModal. These checks
 * fail loudly if any of that machinery is reintroduced.
 */

const repoRoot = path.resolve(__dirname, '../../../../..');
const classesRouteSource = readFileSync(
  path.join(repoRoot, 'src/app/api/venue/classes/route.ts'),
  'utf8',
);

describe('C4: dead weekly-timetable machinery removed', () => {
  it('deletes the unwired generate-instances route', () => {
    expect(existsSync(path.join(repoRoot, 'src/app/api/venue/classes/generate-instances/route.ts'))).toBe(
      false,
    );
  });

  it('deletes the interval-weeks helper lib', () => {
    expect(existsSync(path.join(repoRoot, 'src/lib/scheduling/class-timetable-interval.ts'))).toBe(false);
  });

  it('drops the class_timetable POST/PATCH/DELETE entity branches from classes/route.ts', () => {
    // The timetable write entity is gone: no schema, no inserts/updates/deletes against the table.
    expect(classesRouteSource).not.toContain('timetableEntrySchema');
    expect(classesRouteSource).not.toMatch(/from\('class_timetable'\)\s*\.\s*(insert|update|delete)/);
    // The PATCH/DELETE dispatchers no longer recognise the 'timetable' entity type.
    expect(classesRouteSource).not.toContain("entity_type === 'timetable'");
  });

  it('no longer imports the timetable-entry delete guard or the deleted interval lib', () => {
    expect(classesRouteSource).not.toContain('hasUpcomingActiveBookingsForClassTimetableEntry');
    expect(classesRouteSource).not.toContain('class-timetable-interval');
  });
});
