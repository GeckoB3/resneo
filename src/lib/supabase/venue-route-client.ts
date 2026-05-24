import type { NextRequest } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';

/**
 * Supabase client for /api/venue/* route handlers.
 * Reads the Authorization: Bearer header (mobile) and falls back to cookies (web dashboard).
 * Use this anywhere a venue route currently calls `await createClient()`.
 */
export async function createVenueRouteClient(request: NextRequest | Request) {
  return createRouteHandlerClient(request);
}
