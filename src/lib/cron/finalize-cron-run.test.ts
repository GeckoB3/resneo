import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/emails/send-email', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@sentry/nextjs', () => ({
  captureMessage: vi.fn(),
}));

import { sendEmail } from '@/lib/emails/send-email';
import * as Sentry from '@sentry/nextjs';
import { finalizeCronRun } from './finalize-cron-run';

const mockSendEmail = vi.mocked(sendEmail);
const mockCapture = vi.mocked(Sentry.captureMessage);

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('finalizeCronRun', () => {
  it('returns 200 and ok:true when errors is 0', async () => {
    const outcome = await finalizeCronRun({
      job: 'account-link-maintenance',
      results: { expired_requests: 2 },
      errors: 0,
    });
    expect(outcome.httpStatus).toBe(200);
    expect(outcome.body.ok).toBe(true);
    expect(mockCapture).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('returns 500, captures Sentry, and emails ops when errors > 0', async () => {
    vi.stubEnv('CRON_ALERT_EMAIL', 'ops@example.com');
    const outcome = await finalizeCronRun({
      job: 'account-link-maintenance',
      results: { expired_requests: 0 },
      errors: 2,
    });
    expect(outcome.httpStatus).toBe(500);
    expect(outcome.body.ok).toBe(false);
    expect(mockCapture).toHaveBeenCalledOnce();
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'ops@example.com', subject: expect.stringContaining('account-link-maintenance') }),
    );
  });
});
