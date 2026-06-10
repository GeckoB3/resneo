import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { isPlatformAuthFailure, requirePlatformSuperuserAuth } from '@/lib/platform-api-auth';
import { recordPlatformAuditEvent } from '@/lib/platform/audit';
import { APPOINTMENTS_FEATURE_FLAG_KEYS } from '@/lib/feature-flags';
import { planDisplayName } from '@/lib/pricing-constants';

const patchSchema = z.object({
  venue_id: z.string().uuid(),
  key: z.enum(APPOINTMENTS_FEATURE_FLAG_KEYS),
  value: z.boolean(),
});

/** GET /api/platform/feature-flags — per-venue flag matrix + adoption counts (live venues). */
export async function GET() {
  const auth = await requirePlatformSuperuserAuth();
  if (isPlatformAuthFailure(auth)) return auth;

  const admin = getSupabaseAdminClient();
  const { data: venues, error } = await admin
    .from('venues')
    .select('id, name, slug, pricing_tier, plan_status, feature_flags')
    .eq('is_test', false)
    .order('name', { ascending: true });

  if (error) {
    console.error('[platform/feature-flags GET]', error.message);
    return NextResponse.json({ error: 'Failed to load venues' }, { status: 500 });
  }

  const rows = ((venues ?? []) as Array<{
    id: string;
    name: string;
    slug: string;
    pricing_tier: string | null;
    plan_status: string | null;
    feature_flags: Record<string, unknown> | null;
  }>).map((v) => {
    const flags: Record<string, boolean> = {};
    for (const key of APPOINTMENTS_FEATURE_FLAG_KEYS) {
      flags[key] = (v.feature_flags ?? {})[key] === true;
    }
    return {
      id: v.id,
      name: v.name,
      slug: v.slug,
      plan: planDisplayName(v.pricing_tier),
      plan_status: v.plan_status ?? '',
      flags,
    };
  });

  const adoption = APPOINTMENTS_FEATURE_FLAG_KEYS.map((key) => ({
    key,
    enabled_count: rows.filter((r) => r.flags[key]).length,
  }));

  return NextResponse.json({
    flag_keys: APPOINTMENTS_FEATURE_FLAG_KEYS,
    adoption,
    venues: rows,
  });
}

/** PATCH /api/platform/feature-flags — toggle one flag for one venue (jsonb merge, audited). */
export async function PATCH(request: Request) {
  const auth = await requirePlatformSuperuserAuth();
  if (isPlatformAuthFailure(auth)) return auth;

  const json = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { venue_id, key, value } = parsed.data;

  const admin = getSupabaseAdminClient();

  // Read–merge–write to preserve config sub-objects stored alongside boolean flags.
  const { data: venue, error: loadErr } = await admin
    .from('venues')
    .select('id, name, feature_flags')
    .eq('id', venue_id)
    .maybeSingle();

  if (loadErr) {
    console.error('[platform/feature-flags PATCH] load:', loadErr.message, { venue_id });
    return NextResponse.json({ error: 'Failed to load venue' }, { status: 500 });
  }
  if (!venue) {
    return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  }

  const current = ((venue as { feature_flags: Record<string, unknown> | null }).feature_flags ?? {});
  const next = { ...current, [key]: value };

  const { error: updateErr } = await admin
    .from('venues')
    .update({ feature_flags: next })
    .eq('id', venue_id);

  if (updateErr) {
    console.error('[platform/feature-flags PATCH] update:', updateErr.message, { venue_id, key });
    return NextResponse.json({ error: 'Failed to update flag' }, { status: 500 });
  }

  await recordPlatformAuditEvent(admin, {
    superuser: auth.user,
    action: 'venue.feature_flag',
    targetType: 'venue',
    targetId: venue_id,
    summary: `${value ? 'Enabled' : 'Disabled'} flag "${key}" for ${(venue as { name: string }).name}`,
    metadata: { key, value },
  });

  return NextResponse.json({ ok: true });
}
