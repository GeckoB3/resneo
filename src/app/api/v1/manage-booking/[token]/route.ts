import { NextResponse } from 'next/server';
import { resolveManageBookingToken } from '@/lib/manage-booking-token';

type Params = { params: Promise<{ token: string }> };

export async function GET(request: Request, { params }: Params) {
  const { token } = await params;
  const resolved = resolveManageBookingToken(token);
  if (!resolved) return NextResponse.json({ error: 'Invalid or expired token' }, { status: 400 });

  const url = new URL('/api/confirm', request.url);
  url.searchParams.set('booking_id', resolved.bookingId);
  url.searchParams.set('hmac', resolved.hmac);
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}

export async function DELETE(request: Request, { params }: Params) {
  const { token } = await params;
  const resolved = resolveManageBookingToken(token);
  if (!resolved) return NextResponse.json({ error: 'Invalid or expired token' }, { status: 400 });

  const res = await fetch(new URL('/api/confirm', request.url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ booking_id: resolved.bookingId, hmac: resolved.hmac, action: 'cancel' }),
  });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
