import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { loadAccountUpcomingBookingsByModel } from '@/lib/account/account-bookings';
import { NO_STORE_HEADERS } from '@/lib/api/error-codes';

/**
 * GET /api/account/bookings/by-model?model=event_ticket|resource_booking (P5-1).
 *
 * The events and resources hubs had no route at all: the pages called
 * `loadAccountUpcomingBookingsByModel` directly, so a native client could not
 * reach the same answer without somebody re-implementing the query. This is
 * the loader the pages already use, behind a URL.
 */
const MODELS = ['event_ticket', 'resource_booking'] as const;
type SupportedModel = (typeof MODELS)[number];

function parseModel(raw: string | null): SupportedModel | null {
  return MODELS.includes(raw as SupportedModel) ? (raw as SupportedModel) : null;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createRouteHandlerClient(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorised', code: 'UNAUTHENTICATED' },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    const model = parseModel(request.nextUrl.searchParams.get('model'));
    if (!model) {
      // Named rather than defaulted: guessing which hub the caller meant would
      // answer a different question from the one asked.
      return NextResponse.json(
        {
          error: `Provide model as one of: ${MODELS.join(', ')}.`,
          code: 'VALIDATION_FAILED',
        },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const limitRaw = Number(request.nextUrl.searchParams.get('limit'));
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 50;

    const bookings = await loadAccountUpcomingBookingsByModel(
      supabase,
      undefined,
      model,
      Date.now(),
      limit,
    );
    return NextResponse.json({ bookings }, { headers: NO_STORE_HEADERS });
  } catch (e) {
    console.error('[account/bookings/by-model]', e);
    return NextResponse.json(
      { error: 'Internal error', code: 'INTERNAL_ERROR' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
