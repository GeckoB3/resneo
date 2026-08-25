import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * EV-4 (Resneo_Codebase_Audit_August_2026.md).
 *
 * `ticket_lines` is declared on the public create route's single zod schema, so
 * it is accepted on EVERY request regardless of booking model. The insert then
 * read:
 *
 *   const ticketLinesToInsert = validatedEventTicketLines ?? ticket_lines;
 *
 * `validatedEventTicketLines` is only ever populated inside the `event_ticket`
 * branch, by `validateEventTicketBooking`, which re-derives every label and
 * price from the catalogue. On any other model the `??` fell through to the raw
 * client array. A crafted POST could therefore store its own labels, its own
 * prices, and a `ticket_type_id` belonging to any venue: because a tier's
 * pre-delete sales lookup matches on `ticket_type_id` alone, that foreign row
 * then permanently blocked the real owner from deleting their own tier.
 *
 * Separately the insert's error was discarded, so a genuine event booking could
 * be paid for and end up with zero ticket lines. Remaining tier capacity is
 * computed from those rows, so the seats silently went back on sale. The staff
 * route (`api/venue/bookings`) already treated the same insert as fatal and
 * rolled the booking back.
 *
 * ---------------------------------------------------------------------------
 * This is a bypass guard, not a behaviour test, and it follows the precedent
 * set by `public-create-routes-booking-window.test.ts` for this same route: the
 * create route is ~2,200 lines with Stripe, compliance, add-on resolution and
 * five model branches in the path, and has no test harness. A behavioural test
 * of these two lines would cost more to build than it proves. What regresses
 * here is textual (someone reinstating the `??` fallback, or dropping the error
 * check), and that is exactly what this pins. Reached-ness is covered by booking
 * a real event through the public flow on staging.
 */

const CREATE_ROUTE = 'src/app/api/booking/create/route.ts';

function readRoute(): string {
  return readFileSync(path.join(process.cwd(), CREATE_ROUTE), 'utf8');
}

describe('public create route ticket_lines handling (EV-4)', () => {
  it('rejects ticket_lines on any model that is not event_ticket', () => {
    const src = readRoute();

    expect(src).toMatch(/ticket_lines !== undefined && effectiveModel !== 'event_ticket'/);
    expect(src).toContain('ticket_lines is only valid for event ticket bookings.');
  });

  it('never falls back to the client-supplied ticket_lines when inserting', () => {
    const src = readRoute();

    // The defect, verbatim. If this reappears the client controls stored prices.
    expect(src).not.toMatch(/validatedEventTicketLines\s*\?\?\s*ticket_lines/);
    // Only the server-derived lines reach the insert.
    expect(src).toMatch(/if \(validatedEventTicketLines && validatedEventTicketLines\.length > 0\)/);
  });

  it('checks the ticket-line insert error and rolls the booking back', () => {
    const src = readRoute();

    const insertIdx = src.indexOf("from('booking_ticket_lines').insert(lines)");
    expect(insertIdx).toBeGreaterThan(-1);

    // The insert must be destructured for its error, not fired and forgotten.
    expect(src.slice(Math.max(0, insertIdx - 120), insertIdx)).toMatch(/const \{ error: lineErr \}/);

    // ...and the failure path must delete the booking it just created, the same
    // way the booking_addons block below it does.
    const afterInsert = src.slice(insertIdx, insertIdx + 700);
    expect(afterInsert).toMatch(/if \(lineErr\)/);
    expect(afterInsert).toMatch(/from\('bookings'\)\.delete\(\)\.eq\('id', booking\.id\)/);
  });

  it('keeps the schema field, so the gate is the thing doing the work', () => {
    // A reader might "fix" this by deleting ticket_lines from the schema, which
    // would break real event bookings. The field stays; the gate scopes it.
    const src = readRoute();
    expect(src).toMatch(/ticket_lines: z\.array\(/);
  });
});
