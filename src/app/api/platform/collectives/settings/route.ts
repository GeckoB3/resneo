import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { isPlatformAuthFailure, requirePlatformSuperuserAuth } from '@/lib/platform-api-auth';
import { recordPlatformAuditEvent } from '@/lib/platform/audit';
import {
  NEW_COLLECTIVE_SERVICE_MODELS,
  newCollectiveServiceModel,
  setNewCollectiveServiceModel,
} from '@/lib/platform/platform-settings';

const patchSchema = z.object({ new_collective_service_model: z.enum(NEW_COLLECTIVE_SERVICE_MODELS) });

/** GET /api/platform/collectives/settings: the model new collectives start on (D37). */
export async function GET() {
  const auth = await requirePlatformSuperuserAuth();
  if (isPlatformAuthFailure(auth)) return auth;
  return NextResponse.json({ new_collective_service_model: await newCollectiveServiceModel(getSupabaseAdminClient()) });
}

/** PATCH /api/platform/collectives/settings: change it, audited. Existing collectives are not touched. */
export async function PATCH(request: Request) {
  const auth = await requirePlatformSuperuserAuth();
  if (isPlatformAuthFailure(auth)) return auth;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Choose legacy_copies or replicas.' }, { status: 400 });
  }
  const admin = getSupabaseAdminClient();
  const value = parsed.data.new_collective_service_model;
  const result = await setNewCollectiveServiceModel(admin, value, auth.user.id);
  if (!result.ok) {
    console.error('[platform/collectives/settings PATCH]', result.error);
    return NextResponse.json({ error: 'The setting could not be saved.' }, { status: 500 });
  }
  if (result.previous !== value) {
    await recordPlatformAuditEvent(admin, {
      superuser: auth.user,
      action: 'collectives.new_service_model',
      targetType: 'platform_setting',
      targetId: 'new_collective_service_model',
      summary: `New collectives now start on ${value === 'replicas' ? 'shared services' : 'service copies'}`,
      metadata: { from: result.previous, to: value },
    });
  }
  return NextResponse.json({ new_collective_service_model: value });
}
