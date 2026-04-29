import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createRouteHandlerClient(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const { error } = await supabase.rpc('cancel_account_deletion');
    if (error) {
      console.error('[account/delete-request/cancel]', error.message);
      return NextResponse.json({ error: 'Failed to cancel deletion request' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[account/delete-request/cancel]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
