import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { sendCustomBookingMessage, summariseChannelResult } from '@/lib/communications/send-custom-booking-message';
import type { GuestMessageChannel } from '@/lib/booking/guest-message-channel';
import {
  linkedGrantAllowsMutation,
  loadStaffAccessibleBooking,
} from '@/lib/booking/staff-booking-access';

const schema = z.object({
  message: z.string().min(1).max(2000),
  channel: z.enum(['email', 'sms', 'both']).optional().default('both'),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createVenueRouteClient(request);
  const staff = await getVenueStaff(supabase);
  if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Message is required' }, { status: 400 });

  const loaded = await loadStaffAccessibleBooking(staff, id);
  if (!loaded.ok) {
    return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  }
  if (!linkedGrantAllowsMutation(loaded.ctx.linkedGrant, loaded.ctx.isOwnVenue)) {
    return NextResponse.json(
      { error: 'This link does not allow messaging guests on the other venue’s bookings.' },
      { status: 403 },
    );
  }

  const channel = parsed.data.channel as GuestMessageChannel;

  const result = await sendCustomBookingMessage({
    venueId: loaded.ctx.ownerVenueId,
    bookingId: id,
    message: parsed.data.message,
    channel,
  });

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  const anySent = Boolean(result.email?.sent || result.sms?.sent);

  // If the user requested a specific channel and nothing was attempted
  // (e.g. guest has no email for 'email' request), report that as a 400 so
  // the dashboard can surface a clear message instead of a silent success.
  if (!anySent && result.attempted.length === 0) {
    const reason =
      channel === 'email'
        ? 'Guest has no email on file'
        : channel === 'sms'
          ? 'Guest has no phone on file'
          : 'Guest has no email or phone on file';
    return NextResponse.json({ error: reason }, { status: 400 });
  }

  const emailSummary = summariseChannelResult(result.email);
  const smsSummary = summariseChannelResult(result.sms);

  return NextResponse.json(
    {
      success: anySent,
      channels: {
        email: result.email ?? null,
        sms: result.sms ?? null,
      },
      errors: [
        result.email && !result.email.sent && emailSummary ? `Email: ${emailSummary}` : null,
        result.sms && !result.sms.sent && smsSummary ? `SMS: ${smsSummary}` : null,
      ].filter((entry): entry is string => entry !== null),
    },
    { status: anySent ? 200 : 502 },
  );
}
