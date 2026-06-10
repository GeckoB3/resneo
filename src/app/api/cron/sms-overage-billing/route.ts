import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuthorisation } from '@/lib/cron-auth';
import { withCronRunLogging } from '@/lib/platform/cron-log';
import { reportUnreportedSmsUsageRows } from '@/lib/sms-usage';

/**
 * Monthly safety net: report any SMS overage segments that were counted locally
 * but not accepted by Stripe Billing Meter events at send time.
 */
export const GET = withCronRunLogging('sms-overage-billing', handleGet);

async function handleGet(request: NextRequest) {
  const denied = requireCronAuthorisation(request);
  if (denied) return denied;

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'STRIPE_SECRET_KEY not set' });
  }

  try {
    const { reported } = await reportUnreportedSmsUsageRows();
    return NextResponse.json({ ok: true, reported });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SMS overage backfill failed';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
