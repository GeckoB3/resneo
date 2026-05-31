import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';

const BUCKET = 'venue-gallery';
const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** POST /api/venue/gallery - upload a booking-page gallery photo (admin only). Returns public URL. */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
    if (!requireAdmin(staff)) {
      return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'File too large (max 5MB)' }, { status: 400 });
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'Invalid type; use JPEG, PNG or WebP' }, { status: 400 });
    }

    const ext = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'webp';
    const path = `${staff.venue_id}/${crypto.randomUUID()}.${ext}`;

    const admin = getSupabaseAdminClient();
    const arrayBuffer = await file.arrayBuffer();
    const { data, error } = await admin.storage
      .from(BUCKET)
      .upload(path, arrayBuffer, { contentType: file.type, upsert: false });

    if (error) {
      console.error('Gallery upload failed:', error);
      return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
    }

    const { data: urlData } = admin.storage.from(BUCKET).getPublicUrl(data.path);
    return NextResponse.json({ url: urlData.publicUrl });
  } catch (err) {
    console.error('POST /api/venue/gallery failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
