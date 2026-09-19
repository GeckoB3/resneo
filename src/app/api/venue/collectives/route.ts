import { NextRequest, NextResponse } from 'next/server';
import { resolveLinkAdmin } from '@/lib/linked-accounts/route-helpers';
import { createCollectiveSchema } from '@/lib/linked-accounts/validation';
import { loadCollectiveViewsForVenue } from '@/lib/linked-accounts/collectives';
import { createCollectiveWithInvites } from '@/lib/linked-accounts/collective-create';

/** GET /api/venue/collectives — collectives this venue hosts or belongs to. */
export async function GET() {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
  if (!ctx.eligibility.feature) {
    return NextResponse.json({ collectives: [] });
  }
  try {
    const collectives = await loadCollectiveViewsForVenue(ctx.admin, ctx.venueId);
    return NextResponse.json({ collectives });
  } catch (err) {
    console.error('GET /api/venue/collectives failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** POST /api/venue/collectives: create a collective and invite linked venues (`createCollectiveWithInvites`). */
export async function POST(request: NextRequest) {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const parsed = createCollectiveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Please check the name and address.', details: parsed.error.flatten(), field: 'name' },
      { status: 400 },
    );
  }

  try {
    const created = await createCollectiveWithInvites(ctx, {
      name: parsed.data.name,
      slug: parsed.data.slug,
      branding: parsed.data.branding,
      serviceGrouping: parsed.data.serviceGrouping,
      inviteVenueIds: parsed.data.inviteVenueIds,
    });
    if (!created.ok) return created.response;
    const collectives = await loadCollectiveViewsForVenue(ctx.admin, ctx.venueId);
    return NextResponse.json(
      { collective: collectives.find((c) => c.id === created.collectiveId) ?? null },
      { status: 201 },
    );
  } catch (err) {
    console.error('POST /api/venue/collectives failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
