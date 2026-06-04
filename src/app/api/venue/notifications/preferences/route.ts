import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import {
  resolveLinkedNotificationPrefs,
  type LinkedNotificationPrefs,
} from '@/lib/linked-accounts/notification-prefs';

const prefsSchema = z
  .object({
    cancel: z.boolean().optional(),
    reschedule: z.boolean().optional(),
    create: z.boolean().optional(),
    notes: z.boolean().optional(),
  })
  .strict();

async function loadPrefs(
  staff: NonNullable<Awaited<ReturnType<typeof getVenueStaff>>>,
): Promise<LinkedNotificationPrefs> {
  const { data } = await staff.db
    .from('venues')
    .select('linked_notification_prefs')
    .eq('id', staff.venue_id)
    .maybeSingle();
  return resolveLinkedNotificationPrefs(data?.linked_notification_prefs);
}

/** GET /api/venue/notifications/preferences — the venue's email prefs (§17.4). */
export async function GET() {
  const supabase = await createClient();
  const staff = await getVenueStaff(supabase);
  if (!staff) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }
  try {
    return NextResponse.json({ prefs: await loadPrefs(staff) });
  } catch (err) {
    console.error('GET /api/venue/notifications/preferences failed:', err);
    return NextResponse.json({ error: 'Could not load preferences' }, { status: 500 });
  }
}

/**
 * PATCH /api/venue/notifications/preferences — update which cross-venue write
 * events email this venue (§17.4). Admin only; in-app notifications are
 * unaffected. Accepts any subset of { cancel, reschedule, create, notes }.
 */
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const staff = await getVenueStaff(supabase);
  if (!staff) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }
  if (staff.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can change notification preferences.' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const parsed = prefsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const current = await loadPrefs(staff);
    const next: LinkedNotificationPrefs = { ...current, ...parsed.data };
    const { error } = await staff.db
      .from('venues')
      .update({ linked_notification_prefs: next })
      .eq('id', staff.venue_id);
    if (error) {
      console.error('PATCH /api/venue/notifications/preferences failed:', error.message);
      return NextResponse.json({ error: 'Could not save preferences' }, { status: 500 });
    }
    return NextResponse.json({ prefs: next });
  } catch (err) {
    console.error('PATCH /api/venue/notifications/preferences threw:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
