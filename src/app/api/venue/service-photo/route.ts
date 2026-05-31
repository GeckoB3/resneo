import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { parseImageUploadFromFormData } from '@/lib/venue/parse-image-upload';
import { deleteVenueStorageImageByPublicUrl } from '@/lib/venue/delete-venue-storage-image';
import { uploadVenueStorageImage } from '@/lib/venue/upload-venue-storage-image';
import { z } from 'zod';

const BUCKET = 'venue-service-photos';
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

const deleteBodySchema = z.object({
  url: z.string().url().max(2000),
});

/** POST /api/venue/service-photo - upload a per-service booking-page photo (admin only). Returns public URL. */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
    if (!requireAdmin(staff)) {
      return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const formData = await request.formData();
    const parsed = await parseImageUploadFromFormData(formData, MAX_SIZE);
    if ('error' in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const admin = getSupabaseAdminClient();
    const uploaded = await uploadVenueStorageImage(admin, BUCKET, staff.venue_id, parsed);
    if ('error' in uploaded) {
      return NextResponse.json({ error: uploaded.error }, { status: 500 });
    }

    return NextResponse.json({ url: uploaded.publicUrl });
  } catch (err) {
    console.error('POST /api/venue/service-photo failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE /api/venue/service-photo - remove a service photo object from storage (admin only). */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
    if (!requireAdmin(staff)) {
      return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const body = await request.json();
    const parsed = deleteBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();
    const result = await deleteVenueStorageImageByPublicUrl(
      admin,
      BUCKET,
      staff.venue_id,
      parsed.data.url,
    );
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/venue/service-photo failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
