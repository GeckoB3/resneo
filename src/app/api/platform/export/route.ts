import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { isPlatformAuthFailure, requirePlatformSuperuserAuth } from '@/lib/platform-api-auth';
import { recordPlatformAuditEvent } from '@/lib/platform/audit';
import { planDisplayName } from '@/lib/pricing-constants';

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * GET /api/platform/export?type=venues|invoices
 * CSV download of live-venue data for board reporting. Audited.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePlatformSuperuserAuth();
  if (isPlatformAuthFailure(auth)) return auth;

  const type = req.nextUrl.searchParams.get('type') ?? 'venues';
  if (type !== 'venues' && type !== 'invoices') {
    return NextResponse.json({ error: 'type must be venues or invoices' }, { status: 400 });
  }

  const admin = getSupabaseAdminClient();
  const stamp = new Date().toISOString().slice(0, 10);

  try {
    let csv: string;
    let filename: string;

    if (type === 'venues') {
      const { data: venues, error } = await admin
        .from('venues')
        .select(
          `id, name, slug, email, phone, pricing_tier, plan_status, billing_access_source,
           booking_model, onboarding_completed, created_at,
           subscription_current_period_end, stripe_customer_id, stripe_subscription_id,
           staff ( id )`,
        )
        .eq('is_test', false)
        .order('created_at', { ascending: false });

      if (error) throw new Error(error.message);

      csv = toCsv(
        [
          'Venue', 'Slug', 'Email', 'Phone', 'Plan', 'Status', 'Billing source',
          'Onboarded', 'Staff count', 'Created', 'Period end', 'Stripe customer', 'Stripe subscription',
        ],
        ((venues ?? []) as Array<Record<string, unknown>>).map((v) => [
          v.name,
          v.slug,
          v.email,
          v.phone,
          planDisplayName(v.pricing_tier as string | null),
          v.plan_status,
          v.billing_access_source ?? 'stripe',
          (v.onboarding_completed as boolean) ? 'yes' : 'no',
          Array.isArray(v.staff) ? v.staff.length : 0,
          v.created_at,
          v.subscription_current_period_end,
          v.stripe_customer_id,
          v.stripe_subscription_id,
        ]),
      );
      filename = `resneo-venues-${stamp}.csv`;
    } else {
      const { data: invoices, error } = await admin
        .from('platform_invoices')
        .select('stripe_invoice_id, venue_id, amount_paid_pence, currency, period_month, paid_at')
        .order('paid_at', { ascending: false })
        .limit(5000);

      if (error) throw new Error(error.message);

      const rows = (invoices ?? []) as Array<{
        stripe_invoice_id: string;
        venue_id: string | null;
        amount_paid_pence: number;
        currency: string;
        period_month: string;
        paid_at: string | null;
      }>;
      const venueIds = [...new Set(rows.map((r) => r.venue_id).filter((v): v is string => Boolean(v)))];
      const nameById = new Map<string, string>();
      if (venueIds.length) {
        const { data: venues } = await admin.from('venues').select('id, name').in('id', venueIds);
        for (const v of (venues ?? []) as Array<{ id: string; name: string }>) {
          nameById.set(v.id, v.name);
        }
      }

      csv = toCsv(
        ['Invoice', 'Venue', 'Amount (GBP)', 'Currency', 'Period month', 'Paid at'],
        rows.map((r) => [
          r.stripe_invoice_id,
          r.venue_id ? nameById.get(r.venue_id) ?? r.venue_id : '',
          (r.amount_paid_pence / 100).toFixed(2),
          r.currency,
          r.period_month,
          r.paid_at,
        ]),
      );
      filename = `resneo-invoices-${stamp}.csv`;
    }

    await recordPlatformAuditEvent(admin, {
      superuser: auth.user,
      action: 'data.export',
      targetType: 'export',
      targetId: type,
      summary: `Exported ${type} CSV`,
    });

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    console.error('[platform/export]', e instanceof Error ? e.message : e, { type });
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
}
