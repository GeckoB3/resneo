/**
 * Pins for the customer side of a multi-service visit (Docs/visit-services-independent-plan.md,
 * test plan phase 0). Staff surfaces are gaining per-service control; the customer's are
 * meant to stay exactly as they are. These read the source rather than mock the routes,
 * because what they protect is the ABSENCE of sibling handling, which a behavioural test
 * built on today's fixtures would pass by accident.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** Vitest runs from the repository root. */
const read = (p: string) => readFileSync(path.resolve(process.cwd(), 'src', p), 'utf8');

describe('customer visit surfaces stay single-row', () => {
  it('a customer reschedule moves the row its link belongs to and never touches siblings', () => {
    const source = read('lib/booking/guest-actions/reschedule.ts');
    // No sibling read or write by group id anywhere in the customer reschedule.
    expect(source).not.toMatch(/\.eq\(\s*['"]group_booking_id['"]/);
    expect(source).not.toContain('applyGroupBookingStatusChange');
    expect(source).not.toContain('resequenceVisit');
  });

  it('the customer email still lists every service of the visit', () => {
    const source = read('lib/emails/booking-email-enrichment.ts');
    expect(source).toMatch(/\.eq\(\s*['"]group_booking_id['"],\s*anchor\.group_booking_id\)/);
  });

  it('the account portal never offers a per-service time control', () => {
    const view = read('components/booking/GuestBookingDetailView.tsx');
    expect(view).not.toContain('visits/');
    expect(view).not.toContain('per-service');
  });
});
