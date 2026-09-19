import { NextRequest, NextResponse } from 'next/server';
import { resolveLinkAdmin, enforceLinkRateLimit } from '@/lib/linked-accounts/route-helpers';
import { linkSetupSchema } from '@/lib/linked-accounts/validation';
import { runLinkSetup } from '@/lib/linked-accounts/link-setup';

/**
 * POST /api/venue/account-links/setup: a link request and, at full access both ways, a collective with
 * it, in one call with one notice to the other venue (Docs/link-and-collective-setup-wizard-plan.md
 * §3.1). Body: `{ targetSlug, requestMessage?, grants: { mine, theirs }, collective?: { name, slug } }`.
 * Refusals carry `field` so the wizard can show them on the step they belong to.
 */
export async function POST(request: NextRequest) {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
  const limited = enforceLinkRateLimit(ctx.venueId, 'mutate', 30, 60_000);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const parsed = linkSetupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Please check the venue, the level of link, and the collective name and address.',
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  try {
    return await runLinkSetup(ctx, parsed.data);
  } catch (err) {
    console.error('POST /api/venue/account-links/setup failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
