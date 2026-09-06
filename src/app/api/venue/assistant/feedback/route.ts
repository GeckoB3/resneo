import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { assistantEnabledFor } from '@/lib/assistant/enabled';
import { assistantFeedbackSchema } from '@/lib/assistant/request-schema';
import { rateMessage } from '@/lib/assistant/log';

/**
 * POST /api/venue/assistant/feedback — thumbs up or down on one Ask ResNeo answer
 * (Docs/help-assistant-plan.md, 3.4). The message must belong to a conversation of the
 * caller's venue. 204 on success.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const supabase = await createVenueRouteClient(request);
  const staff = await getVenueStaff(supabase);
  if (!staff) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }
  if (!assistantEnabledFor(staff.venue_id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = assistantFeedbackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  const outcome = await rateMessage(getSupabaseAdminClient(), {
    messageId: parsed.data.messageId,
    venueId: staff.venue_id,
    rating: parsed.data.rating,
    comment: parsed.data.comment?.trim() || null,
  });
  if (outcome === 'not_found') {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 });
  }
  if (outcome === 'error') {
    return NextResponse.json({ error: 'Could not save feedback' }, { status: 500 });
  }
  return new NextResponse(null, { status: 204 });
}
