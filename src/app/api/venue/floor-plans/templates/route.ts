import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';

/**
 * Placeholder for layout templates (Phase 4). Future: persist named templates per dining area
 * and resolve active layout by date / service period.
 */
export async function GET() {
  const supabase = await createClient();
  const staff = await getVenueStaff(supabase);
  if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  return NextResponse.json({ templates: [] as unknown[], active_template_id: null as string | null });
}

export async function POST() {
  const supabase = await createClient();
  const staff = await getVenueStaff(supabase);
  if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  return NextResponse.json(
    { error: 'Layout templates save API is not enabled yet. Use Dining Availability layout editor for the active floor.' },
    { status: 501 },
  );
}
