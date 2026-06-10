import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { isSalesAuthFailure, requireSalesAgentAuth } from '@/lib/sales/sales-api-auth';
import { loadSalesDashboardForUser } from '@/lib/sales/load-dashboard';

export async function GET() {
  const auth = await requireSalesAgentAuth();
  if (isSalesAuthFailure(auth)) return auth;

  const data = await loadSalesDashboardForUser(auth.user.id, getSupabaseAdminClient());
  if (!data) {
    return NextResponse.json({ error: 'Salesperson profile not found' }, { status: 404 });
  }

  return NextResponse.json(data);
}
