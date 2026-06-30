import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { requireCompliancePlan } from '@/lib/compliance/auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { uploadComplianceFile } from '@/lib/compliance/files';

/**
 * POST /api/venue/compliance/records/upload — staff upload of a `file`-field document while
 * capturing a compliance record in venue (audit H3; multipart `file`). Authenticated venue
 * staff only; stored under venues/{venueId}/uploads/staff/{nonce}/. Returns the FileResponse
 * shape the form renderer's file field expects.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    const gate = await requireCompliancePlan(staff);
    if (!gate.ok) return gate.response;

    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();
    const uploaded = await uploadComplianceFile(admin, {
      storagePrefix: `venues/${staff.venue_id}/uploads/staff/${crypto.randomUUID()}`,
      file,
    });
    if (!uploaded.ok) return NextResponse.json({ error: uploaded.error }, { status: uploaded.status });
    return NextResponse.json(uploaded.value);
  } catch (err) {
    console.error('POST /api/venue/compliance/records/upload failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
