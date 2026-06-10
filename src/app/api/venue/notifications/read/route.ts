import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';

const markReadSchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1).max(200).optional(),
    all: z.literal(true).optional(),
  })
  .refine((v) => v.all === true || (v.ids && v.ids.length > 0), {
    message: 'Provide `ids` or `all: true`.',
  });

/**
 * POST /api/venue/notifications/read — mark the current venue's notifications as
 * read (spec §17.2). Body: `{ ids: string[] }` for specific items, or
 * `{ all: true }` to clear the unread badge. Only ever sets read_at; RLS pins
 * the rows to the caller's venue.
 */
export async function POST(request: NextRequest) {
  const supabase = await createVenueRouteClient(request);
  const staff = await getVenueStaff(supabase);
  if (!staff) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const parsed = markReadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    let query = staff.db
      .from('account_link_notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('venue_id', staff.venue_id)
      .is('read_at', null);

    if (parsed.data.all !== true && parsed.data.ids) {
      query = query.in('id', parsed.data.ids);
    }

    const { error } = await query;
    if (error) {
      console.error('POST /api/venue/notifications/read failed:', error.message);
      return NextResponse.json({ error: 'Could not update notifications' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('POST /api/venue/notifications/read threw:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
