import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { verifyMarketingUnsubscribeSignature } from '@/lib/marketing-unsubscribe';

export async function GET(request: NextRequest) {
  const guestId = request.nextUrl.searchParams.get('guest_id');
  const sig = request.nextUrl.searchParams.get('sig');
  if (!guestId || !sig || !verifyMarketingUnsubscribeSignature(guestId, sig)) {
    return new NextResponse('Invalid unsubscribe link', { status: 400 });
  }

  const admin = getSupabaseAdminClient();
  const { error } = await admin
    .from('guests')
    .update({
      marketing_consent: false,
      marketing_consent_at: null,
      marketing_opt_out: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', guestId);

  if (error) {
    console.error('[marketing/unsubscribe]', error.message);
    return new NextResponse('Could not update preference', { status: 500 });
  }

  return new NextResponse('You have been unsubscribed from venue marketing emails.', {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
