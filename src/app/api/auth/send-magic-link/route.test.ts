import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdminClient: vi.fn(),
}));

vi.mock('@/lib/emails/send-email', () => ({
  sendEmail: vi.fn(),
}));

import { getSupabaseAdminClient } from '@/lib/supabase';
import { sendEmail } from '@/lib/emails/send-email';
import { POST } from './route';

const mockAdmin = vi.mocked(getSupabaseAdminClient);
const mockSendEmail = vi.mocked(sendEmail);

/** Each test needs a fresh IP and email, because rate-limit buckets are module state. */
let seq = 0;
function uniqueIp(): string {
  seq += 1;
  return `203.0.113.${seq % 250}:${seq}`;
}
function uniqueEmail(): string {
  seq += 1;
  return `rl-${seq}-${Date.now()}@example.test`;
}

function post(email: string, ip: string): NextRequest {
  return new NextRequest('https://resneo.test/api/auth/send-magic-link', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ email, next: '/account/bookings' }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SENDGRID_API_KEY = 'test-key';
  process.env.NEXT_PUBLIC_BASE_URL = 'https://resneo.test';

  mockAdmin.mockReturnValue({
    auth: {
      admin: {
        generateLink: vi.fn().mockResolvedValue({
          data: { properties: { hashed_token: 'hashed-token-value' } },
          error: null,
        }),
      },
    },
  } as unknown as ReturnType<typeof getSupabaseAdminClient>);

  mockSendEmail.mockResolvedValue(undefined as never);
});

afterEach(() => {
  delete process.env.SENDGRID_API_KEY;
});

describe('POST /api/auth/send-magic-link rate limiting', () => {
  it('allows the first requests for an address', async () => {
    const email = uniqueEmail();
    const res = await POST(post(email, uniqueIp()));
    expect(res.status).toBe(200);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it('throttles a single address after the per-email limit, from any IP', async () => {
    const email = uniqueEmail();

    // Each request comes from a different IP, so only the per-email bucket can trip.
    for (let i = 0; i < 3; i += 1) {
      const ok = await POST(post(email, uniqueIp()));
      expect(ok.status).toBe(200);
    }

    const blocked = await POST(post(email, uniqueIp()));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBeTruthy();

    // The fourth attempt must not have produced an email.
    expect(mockSendEmail).toHaveBeenCalledTimes(3);
  });

  it('throttles one IP spraying many different addresses', async () => {
    const ip = uniqueIp();

    for (let i = 0; i < 10; i += 1) {
      const ok = await POST(post(uniqueEmail(), ip));
      expect(ok.status).toBe(200);
    }

    const blocked = await POST(post(uniqueEmail(), ip));
    expect(blocked.status).toBe(429);
    expect(mockSendEmail).toHaveBeenCalledTimes(10);
  });

  it('rejects an invalid body without consuming the per-email bucket', async () => {
    const ip = uniqueIp();
    const bad = new NextRequest('https://resneo.test/api/auth/send-magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ email: 'not-an-email' }),
    });

    const res = await POST(bad);
    expect(res.status).toBe(400);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('returns the same 429 shape for an unregistered address', async () => {
    // generateLink failing (unknown address) must not change the throttle
    // response, or a 429 would reveal whether an account exists.
    mockAdmin.mockReturnValue({
      auth: {
        admin: {
          generateLink: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
        },
      },
    } as unknown as ReturnType<typeof getSupabaseAdminClient>);

    const email = uniqueEmail();
    for (let i = 0; i < 3; i += 1) {
      const res = await POST(post(email, uniqueIp()));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ fallback: true });
    }

    const blocked = await POST(post(email, uniqueIp()));
    expect(blocked.status).toBe(429);
  });
});

/**
 * The contract the ResNeo mobile app now signs in against.
 *
 * As of 2026-08-31 the app calls this route instead of Supabase directly, and
 * it branches on the RESPONSE SHAPE. These are not implementation details any
 * more; each one has a specific way of failing silently in the app.
 */
describe('POST /api/auth/send-magic-link: the mobile sign-in contract', () => {
  function adminReturning(properties: Record<string, unknown> | null) {
    mockAdmin.mockReturnValue({
      auth: {
        admin: {
          generateLink: vi.fn().mockResolvedValue({
            data: properties ? { properties } : null,
            error: properties ? null : { message: 'nope' },
          }),
        },
      },
    } as unknown as ReturnType<typeof getSupabaseAdminClient>);
  }

  const sentEmail = () => mockSendEmail.mock.calls[0][0] as { html: string; text: string };

  it.each(['123456', '12345678'])(
    'puts the %s code Supabase issued into the email, whatever its length',
    async (otp) => {
      /*
        The code, not the link, is how the app actually signs in. Supabase's
        link redirects into resneo://callback, which needs the scheme
        allowlisted AND the mail client and browser both willing to hand a
        custom scheme off from an HTTP 302. Plenty will not (Gmail on Android
        especially) and it fails by silently landing on the website. A typed
        code has none of that in its path.

        Both lengths are asserted because otp_length is a per-project HOSTED
        setting that supabase/config.toml does not govern. The config file says
        six; staging issues eight. Nothing in this path may assume either.
      */
      adminReturning({ hashed_token: 'hashed-token-value', email_otp: otp });

      const res = await POST(post(uniqueEmail(), uniqueIp()));

      expect(await res.json()).toEqual({ ok: true });
      expect(sentEmail().text).toContain(otp);
      expect(sentEmail().html).toContain(otp);
    },
  );

  it('answers a sent email with ok, never with fallback', async () => {
    // The app reads fallback as "not sent" and sends its own via Supabase. If a
    // success ever carried it, the user would get two emails; if a failure ever
    // dropped it, they would be told to check an inbox nothing was sent to.
    adminReturning({ hashed_token: 'hashed-token-value', email_otp: '12345678' });

    const body = await (await POST(post(uniqueEmail(), uniqueIp()))).json();

    expect(body).toEqual({ ok: true });
    expect(body).not.toHaveProperty('fallback');
  });

  it.each([
    ['SendGrid is not configured', () => { delete process.env.SENDGRID_API_KEY; }],
    ['generateLink fails', () => adminReturning(null)],
    ['generateLink returns no hashed_token', () => adminReturning({ email_otp: '12345678' })],
    ['the send itself throws', () => { mockSendEmail.mockRejectedValue(new Error('smtp down')); }],
  ])('says fallback, not ok, when %s', async (_label, arrange) => {
    // Every path where no ResNeo email went out has to be distinguishable from
    // one where it did. A bare { ok: true } here shows "check your email" for a
    // message nobody sent, and the user waits for it forever.
    arrange();

    const body = await (await POST(post(uniqueEmail(), uniqueIp()))).json();

    expect(body).toEqual({ fallback: true });
    expect(body).not.toHaveProperty('ok');
  });

  it('gives a throttled caller a readable error and no reason to retry elsewhere', async () => {
    /*
      Two things at once, both load-bearing.

      The error string is shown to the user VERBATIM by the app, so it has to
      read as an explanation rather than a code.

      And the 429 must not carry `fallback`. The app deliberately does not fall
      back on this status: falling through would send, via Supabase, the exact
      email this route just declined to send. The rate limit would throttle
      nothing at all.
    */
    adminReturning({ hashed_token: 'hashed-token-value', email_otp: '12345678' });

    const email = uniqueEmail();
    for (let i = 0; i < 3; i += 1) {
      expect((await POST(post(email, uniqueIp()))).status).toBe(200);
    }

    const blocked = await POST(post(email, uniqueIp()));
    const body = await blocked.json();

    expect(blocked.status).toBe(429);
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(10);
    expect(body).not.toHaveProperty('fallback');
    expect(blocked.headers.get('Retry-After')).toBeTruthy();
  });
});
