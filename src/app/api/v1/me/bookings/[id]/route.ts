import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { loadAccountBookingById } from '@/lib/account/account-bookings';
import { createBookingHmac } from '@/lib/short-manage-link';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createRouteHandlerClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const booking = await loadAccountBookingById(supabase, getSupabaseAdminClient(), id);
  if (!booking) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ booking });
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createRouteHandlerClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const booking = await loadAccountBookingById(supabase, getSupabaseAdminClient(), id);
  if (!booking) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const hmac = createBookingHmac(id);
  const res = await fetch(new URL('/api/confirm', request.url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ booking_id: id, hmac, action: 'cancel' }),
  });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
