import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { validateSalesCode } from '@/lib/sales/lookup';
import { salesProgrammeEnabled } from '@/lib/sales/constants';

export async function GET(request: Request) {
  if (!salesProgrammeEnabled()) {
    return NextResponse.json({ ok: false, reason: 'disabled' });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const admin = getSupabaseAdminClient();
  const result = await validateSalesCode(admin, code);

  if (!result.ok) {
    return NextResponse.json({ ok: false, reason: result.reason });
  }

  return NextResponse.json({
    ok: true,
    code: result.value.code,
    salesperson_name: result.value.salesperson_name,
  });
}
