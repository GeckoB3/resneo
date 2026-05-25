import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { requireCronAuthorisation } from '@/lib/cron-auth';
import { sendClassCommerceComm } from '@/lib/communications/send-class-commerce';

interface BalanceRow {
  id: string;
  user_id: string;
  venue_id: string;
  product_id: string;
  credits_remaining: number;
  expires_at: string | null;
  reminder_sent_at: string | null;
}

const REMINDER_DAYS_BEFORE = 7;

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Cron — 4.3 of the class commerce plan.
 *  1. Expire any balance whose expires_at has passed (idempotent via ledger key).
 *  2. Send a single 7-day-before reminder email per balance.
 */
export async function GET(request: NextRequest) {
  const denied = requireCronAuthorisation(request);
  if (denied) return denied;

  const admin = getSupabaseAdminClient();
  const nowIso = new Date().toISOString();
  const reminderHorizonIso = isoDaysFromNow(REMINDER_DAYS_BEFORE);

  let expired = 0;
  let remindersSent = 0;
  const errors: string[] = [];

  // 1. Expire balances whose expires_at has passed and still have remaining credits.
  const { data: dueRows, error: dueErr } = await admin
    .from('user_class_credit_balances')
    .select('id, user_id, venue_id, product_id, credits_remaining, expires_at, reminder_sent_at')
    .gt('credits_remaining', 0)
    .not('expires_at', 'is', null)
    .lt('expires_at', nowIso)
    .limit(500);

  if (dueErr) {
    console.error('[cron/class-credit-expiry] due select', dueErr);
    return NextResponse.json({ ok: false, error: dueErr.message }, { status: 500 });
  }

  for (const row of (dueRows ?? []) as BalanceRow[]) {
    const delta = -row.credits_remaining;
    const idempotencyKey = `expire:${row.id}:${row.expires_at ?? 'null'}`;

    const { error: ledErr } = await admin.from('class_credit_ledger').insert({
      balance_id: row.id,
      user_id: row.user_id,
      venue_id: row.venue_id,
      delta_credits: delta,
      reason: 'expire',
      idempotency_key: idempotencyKey,
      note: 'Auto-expired by nightly cron',
    });

    if (ledErr) {
      // Idempotency collision (already expired this balance) — fine, skip.
      if (!/duplicate key|unique/i.test(ledErr.message)) {
        errors.push(`ledger expire ${row.id}: ${ledErr.message}`);
        continue;
      }
    }

    const { error: upErr } = await admin
      .from('user_class_credit_balances')
      .update({ credits_remaining: 0, updated_at: new Date().toISOString() })
      .eq('id', row.id);
    if (upErr) {
      errors.push(`zero balance ${row.id}: ${upErr.message}`);
      continue;
    }
    expired += 1;
  }

  // 2. Send 7-day-before reminder for balances whose expires_at falls within the
  //    horizon and that have not yet been reminded.
  const { data: dueReminders, error: rErr } = await admin
    .from('user_class_credit_balances')
    .select('id, user_id, venue_id, product_id, credits_remaining, expires_at, reminder_sent_at')
    .gt('credits_remaining', 0)
    .not('expires_at', 'is', null)
    .is('reminder_sent_at', null)
    .gt('expires_at', nowIso)
    .lt('expires_at', reminderHorizonIso)
    .limit(500);

  if (rErr) {
    console.error('[cron/class-credit-expiry] reminders select', rErr);
  } else {
    for (const row of (dueReminders ?? []) as BalanceRow[]) {
      if (!row.expires_at) continue;
      try {
        const daysUntil = Math.max(
          1,
          Math.ceil((new Date(row.expires_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
        );
        await sendClassCommerceComm({
          venueId: row.venue_id,
          userId: row.user_id,
          payload: {
            key: 'class_credits_expiring',
            vars: {
              venueName: '',
              creditsRemaining: row.credits_remaining,
              expiresAtIso: row.expires_at,
              daysUntilExpiry: daysUntil,
            },
          },
        });

        await admin
          .from('user_class_credit_balances')
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq('id', row.id);
        remindersSent += 1;
      } catch (err) {
        errors.push(`reminder ${row.id}: ${err instanceof Error ? err.message : 'unknown'}`);
      }
    }
  }

  return NextResponse.json({
    ok: errors.length === 0,
    expired,
    reminders_sent: remindersSent,
    errors,
  });
}
