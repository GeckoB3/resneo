/**
 * P2-3. The routing decision every modify surface now shares.
 *
 * Worth testing on its own rather than only through the view: the thing that
 * can go wrong here is silent. A session actor posting to `/api/confirm` gets
 * a 400 the guest reads as "the site is broken", and a token actor posting to
 * the account route gets a 401 for a link that is perfectly valid. Both look
 * like a network problem from the outside, and neither shows up as a render
 * difference the component tests would catch.
 */
import { describe, it, expect } from 'vitest';
import {
  buildGuestModifyRequest,
  readGuestModifyError,
  type GuestModifyChanges,
} from './guest-modify-request';

const CHANGES: GuestModifyChanges = {
  booking_date: '2026-07-01',
  booking_time: '11:00:00',
  party_size: 2,
};

describe('buildGuestModifyRequest', () => {
  it('sends a signed-in customer to their own booking, with no credential', () => {
    const req = buildGuestModifyRequest({ kind: 'session' }, 'bk-1', CHANGES);
    expect(req).toEqual({
      url: '/api/account/bookings/bk-1/reschedule',
      body: CHANGES,
    });
  });

  it('does not put an action or a booking id in the account body', () => {
    // The route has the booking in its path and reschedules by definition.
    // Naming either again would be a second place for them to disagree, and
    // `readChanges` would ignore both, so a bug there would be invisible.
    const req = buildGuestModifyRequest({ kind: 'session' }, 'bk-1', CHANGES);
    expect(req?.body).not.toHaveProperty('action');
    expect(req?.body).not.toHaveProperty('booking_id');
  });

  it('escapes the booking id, so a crafted id cannot reach another path', () => {
    const req = buildGuestModifyRequest({ kind: 'session' }, '../../venue/x', CHANGES);
    expect(req?.url).toBe('/api/account/bookings/..%2F..%2Fvenue%2Fx/reschedule');
  });

  it('sends an emailed-link holder to /api/confirm with its token', () => {
    const req = buildGuestModifyRequest({ kind: 'token', token: 'tok-1' }, 'bk-1', CHANGES);
    expect(req).toEqual({
      url: '/api/confirm',
      body: { booking_id: 'bk-1', token: 'tok-1', action: 'modify', ...CHANGES },
    });
  });

  it('sends a short-link holder the same way, with its hmac', () => {
    const req = buildGuestModifyRequest({ kind: 'hmac', hmac: 'h-1' }, 'bk-1', CHANGES);
    expect(req?.url).toBe('/api/confirm');
    expect(req?.body).toMatchObject({ hmac: 'h-1', action: 'modify' });
    expect(req?.body).not.toHaveProperty('token');
  });

  it('never carries a token and an hmac at once', () => {
    // `/api/confirm` accepts either; sending both would leave which one it
    // authenticated on up to the route's ordering rather than the caller's.
    for (const actor of [
      { kind: 'token', token: 't' } as const,
      { kind: 'hmac', hmac: 'h' } as const,
    ]) {
      const body = buildGuestModifyRequest(actor, 'bk-1', CHANGES)!.body;
      expect(['token', 'hmac'].filter((k) => k in body)).toHaveLength(1);
    }
  });

  it('passes each model its own fields and invents none', () => {
    // A class move sends only its target instance. An earlier draft of the
    // surfaces defaulted the absent fields to null, which the service reads as
    // "clear this column" rather than "leave it alone".
    const req = buildGuestModifyRequest({ kind: 'session' }, 'bk-1', {
      target_class_instance_id: 'inst-9',
    });
    expect(req?.body).toEqual({ target_class_instance_id: 'inst-9' });
  });
});

describe('readGuestModifyError', () => {
  it('turns a 412 into the lost-update sentence, whatever the body says', () => {
    const res = new Response(JSON.stringify({ error: 'Precondition' }), { status: 412 });
    return expect(readGuestModifyError(res)).resolves.toMatch(/updated elsewhere/);
  });

  it('prefers the route’s own message for everything else', async () => {
    const res = new Response(JSON.stringify({ error: 'That slot was just taken.' }), {
      status: 409,
    });
    await expect(readGuestModifyError(res)).resolves.toBe('That slot was just taken.');
  });

  it('still says something when the body is not JSON at all', async () => {
    // A 502 from in front of the app returns HTML. Four copies of this parse
    // used to exist and every one of them had to remember the catch.
    const res = new Response('<html>gateway</html>', { status: 502 });
    await expect(readGuestModifyError(res)).resolves.toBe('Failed to update booking.');
  });
});
