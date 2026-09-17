/**
 * The owner's rule (2026-09-17): at their own venue, staff work bookings like an admin. They open,
 * edit, move between calendars, check in and re-service bookings and visits on any calendar.
 * Calendar assignment limits only calendar setup (hours, closures, service links and values,
 * classes, events and resources). This replaced the own-venue leg of audit finding C8.
 *
 * The booking and visit routes must therefore never gate on the staff member's assigned calendars.
 * A partner venue's bookings are still limited by the account link, which these routes check
 * separately (`linkedGrantAllows*`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROUTES = [
  'src/app/api/venue/bookings/[id]/route.ts',
  'src/app/api/venue/bookings/[id]/validate-appointment-modification/route.ts',
  'src/app/api/venue/bookings/[id]/check-in/route.ts',
  'src/app/api/venue/visits/[groupBookingId]/schedule/route.ts',
  'src/app/api/venue/visits/[groupBookingId]/services/route.ts',
  'src/lib/linked-accounts/move-booking.ts',
];

describe('staff and booking calendars', () => {
  for (const route of ROUTES) {
    it(`${route} does not limit staff to their assigned calendars`, () => {
      const source = readFileSync(join(process.cwd(), route), 'utf8');
      expect(source).not.toMatch(/requireManagedCalendar(Access|Ids)\s*\(/);
      expect(source).not.toMatch(/resolveBookingScopedCalendarId\s*\(/);
    });
  }

  it('still limits a partner venue by its account link', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/api/venue/bookings/[id]/route.ts'), 'utf8');
    expect(source).toMatch(/linkedGrantAllowsCalendar\(linkedGrant, false, body\.practitioner_id/);
  });
});
