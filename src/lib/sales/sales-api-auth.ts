import { NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { isSalesAgent } from '@/lib/sales/auth';

export type SalesAgentAuthResult =
  | { user: User; supabase: Awaited<ReturnType<typeof createClient>> }
  | NextResponse;

export function isSalesAuthFailure(result: SalesAgentAuthResult): result is NextResponse {
  return result instanceof NextResponse;
}

export async function requireSalesAgentAuth(): Promise<SalesAgentAuthResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }
  if (!isSalesAgent(user)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return { user, supabase };
}
