import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * TERMS-05 guard (CB-02). A combined-page booking is sized and charged at the calendar's own
 * terms, which the engine input already carries. Every create path used to substitute the
 * source service's base price or length on top ("the collective's own length"), so a
 * calendar with a custom price was charged the base price and reserved the base length.
 *
 * The routes are too large to drive end to end here; this pins that none of them brings the
 * substitution back, and that the attribution resolver cannot hand them a price or length.
 */
const ROUTES = [
  'src/app/api/booking/create/route.ts',
  'src/app/api/booking/create-group/route.ts',
  'src/app/api/booking/create-multi-service/route.ts',
  'src/app/api/booking/validate-appointment-slot/route.ts',
  'src/app/api/venue/bookings/route.ts',
];

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('collective creates use the calendar terms (TERMS-05)', () => {
  it.each(ROUTES)('%s does not substitute a collective price or length', (rel) => {
    const src = read(rel);
    expect(src).not.toMatch(/collective_?[dD]uration_?[oO]verride/);
    expect(src).not.toMatch(/resolveCollectiveServiceOverride/);
    expect(src).not.toMatch(/collective\w*\.(pricePence|durationMinutes)/i);
    expect(src).not.toMatch(/target\.(pricePence|durationMinutes)/);
  });

  it('the attribution resolver returns only the offering id', () => {
    const src = read('src/lib/linked-accounts/collective-booking-override.ts');
    const body = src.slice(src.indexOf('export interface CollectiveServiceAttribution'));
    const iface = body.slice(0, body.indexOf('}'));
    expect(iface).toContain('collectiveServiceItemId: string;');
    expect(iface).not.toMatch(/pricePence|durationMinutes/);
  });
});
