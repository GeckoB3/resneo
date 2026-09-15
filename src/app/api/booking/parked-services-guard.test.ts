import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * D2 guard (plan §6.6, W4). While a venue is live in a replicas-model collective, only the
 * collective's services take new bookings. The database refuses the write (RN007,
 * 20270217120000); every appointment create path also checks first with `parkedServiceRefusal`, so
 * the refusal is a plain coded 409 before any payment is set up, and maps the database's refusal the
 * same way when a race gets past the check.
 *
 * The routes are too large to drive end to end here (see collective-create-terms.test.ts); this pins
 * that none of them loses the check, and that the check comes before the booking insert.
 */
const PRECHECKED = [
  'src/app/api/booking/create/route.ts',
  'src/app/api/booking/create-group/route.ts',
  'src/app/api/booking/create-multi-service/route.ts',
  'src/app/api/venue/bookings/route.ts',
  'src/app/api/venue/visits/[groupBookingId]/services/route.ts',
];
const MAPS_DATABASE_REFUSAL = [...PRECHECKED, 'src/app/api/venue/linked-calendar/booking/route.ts'];

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('parked services are refused on every create path (D2)', () => {
  it.each(PRECHECKED)('%s checks for a parked service before inserting', (rel) => {
    const src = read(rel);
    const check = src.indexOf('await parkedServiceRefusal(');
    expect(check, 'calls parkedServiceRefusal').toBeGreaterThan(-1);
    const lastInsert = src.lastIndexOf(".from('bookings')");
    expect(lastInsert).toBeGreaterThan(check);
  });

  it.each(MAPS_DATABASE_REFUSAL)('%s answers the database refusal as a coded 409', (rel) => {
    expect(read(rel)).toMatch(/collectiveDbError\((bookErr|apptErr|insErr|updErr|rpcError)\)/);
  });

  it('the appointment catalogue leaves parked services out unless a caller asks for them', () => {
    const src = read('src/lib/availability/appointment-catalog.ts');
    expect(src).toMatch(/options\?\.includeParked\s*\?\s*null\s*:\s*await loadBookableServiceIds/);
    expect(src).toMatch(/withoutParked\(/);
    // Only the legacy combined-page builder, a management view, asks for them.
    expect(read('src/lib/linked-accounts/catalogue.ts')).toContain('includeParked: true');
  });

  it.each(['src/app/api/booking/availability/route.ts', 'src/app/api/venue/appointment-availability/route.ts'])(
    '%s offers no slots for a parked service, except when moving an existing booking',
    (rel) => {
      const src = read(rel);
      expect(src).toMatch(/if \(!excludeBookingId[^{]*\{\s*const bookable = await loadBookableServiceIds/);
      expect(src).toMatch(/isParked\(bookable/);
    },
  );

  it('the check fails open and leaves the backstop to the trigger', () => {
    const src = read('src/lib/linked-accounts/replicas/parking.ts');
    expect(src).toContain("rpc('collective_bookable_service_ids'");
    expect(src).toMatch(/if \(error\) \{[\s\S]*?return null;/);
  });
});
