import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveManageBookingToken } from '@/lib/manage-booking-token';

const schema = z.object({
  token: z.string().min(10),
});

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const resolved = resolveManageBookingToken(parsed.data.token);
  if (!resolved) return NextResponse.json({ error: 'Invalid or expired token' }, { status: 400 });

  return NextResponse.json({ booking_id: resolved.bookingId });
}
