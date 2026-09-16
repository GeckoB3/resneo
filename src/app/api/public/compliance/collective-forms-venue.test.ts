import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * SEC-03 / RT2-2. On a combined page a pre-booking form must file at the venue that will hold the
 * booking. With a chosen calendar the offering resolves to one owning venue, and that venue's own
 * form and version are served with `venue_id` naming it for uploads. With "any available" the
 * calendar is not known yet: if every calendar that could take the booking belongs to one venue its
 * forms are still served, and only when they span venues is no form served at all, because a form
 * completed first would file at one venue while the booking landed at another.
 *
 * The route is a large handler with network and rate-limit dependencies; this pins the rule and the
 * guest-facing line that goes with it.
 */
const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('forms on a combined page follow the calendar (SEC-03)', () => {
  const route = read('src/app/api/public/compliance/booking-requirements/route.ts');

  it('serves a form only when the venue that will hold the record is certain', () => {
    expect(route).toMatch(/const serveForms = Boolean\(concrete\) \|\| sourceIdsByVenue\.size === 1/);
    expect(route).toMatch(/const keepForms = serveForms && venueId === formsVenue/);
  });

  it('keeps venue_id on the collective when no form is served, so an upload cannot land at a venue', () => {
    expect(route).toMatch(/venue_id: serveForms \? formsVenue \?\? params\.collectiveId : params\.collectiveId/);
    expect(route).toMatch(/forms_deferred: out\.requirements\.length > 0/);
  });

  it('still merges the requirement states across venues, so the guest is told what is needed', () => {
    expect(route).toContain('Worst state wins when two venues require the same type.');
  });

  it('tells the guest how to complete a deferred form', () => {
    const block = read('src/components/booking/BookingComplianceBlock.tsx');
    expect(block).toContain('compliance-forms-deferred');
    expect(block).toMatch(/choose a specific team member above/i);
    expect(block).not.toContain('—');
  });
});
