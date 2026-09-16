/**
 * The support console's one action is for superusers only, and is recorded in the platform audit log.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: vi.fn(() => ({})) }));
vi.mock('@/lib/platform-api-auth', () => ({
  requirePlatformSuperuserAuth: vi.fn(),
  isPlatformAuthFailure: (r: unknown) => r instanceof NextResponse,
}));
vi.mock('@/lib/platform/audit', () => ({ recordPlatformAuditEvent: vi.fn(async () => undefined) }));
vi.mock('@/lib/platform/collective-support', () => ({
  retrySupportLink: vi.fn(async () => ({ ok: true, applied: true, error: null })),
}));

import { requirePlatformSuperuserAuth } from '@/lib/platform-api-auth';
import { recordPlatformAuditEvent } from '@/lib/platform/audit';
import { retrySupportLink } from '@/lib/platform/collective-support';
import { POST } from './route';

const LINK = 'aaaaaaaa-0000-4000-8000-000000000001';
const post = (body: unknown) =>
  POST(new Request('http://test/api', { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: 'c-1' }),
  });

beforeEach(() => {
  vi.mocked(retrySupportLink).mockClear();
  vi.mocked(recordPlatformAuditEvent).mockClear();
});

describe('POST /api/platform/collectives/[id]/retry', () => {
  it('is refused without a superuser', async () => {
    vi.mocked(requirePlatformSuperuserAuth).mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    expect((await post({ link_id: LINK })).status).toBe(403);
    expect(retrySupportLink).not.toHaveBeenCalled();
  });

  it('retries and records who asked', async () => {
    vi.mocked(requirePlatformSuperuserAuth).mockResolvedValue({ user: { id: 'su-1', email: 'ops@x.test' } } as never);
    const response = await post({ link_id: LINK });
    expect(await response.json()).toEqual({ ok: true, applied: true, error: null });
    expect(retrySupportLink).toHaveBeenCalledWith({}, 'c-1', LINK);
    expect(recordPlatformAuditEvent).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        action: 'collective.retry_link',
        targetId: 'c-1',
        metadata: expect.objectContaining({ link_id: LINK }),
      }),
    );
  });

  it('needs a link', async () => {
    vi.mocked(requirePlatformSuperuserAuth).mockResolvedValue({ user: { id: 'su-1', email: null } } as never);
    expect((await post({})).status).toBe(400);
  });
});
