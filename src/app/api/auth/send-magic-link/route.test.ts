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
