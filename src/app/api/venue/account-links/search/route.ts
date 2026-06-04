import { NextRequest, NextResponse } from 'next/server';
import { resolveLinkAdmin } from '@/lib/linked-accounts/route-helpers';
import { evaluateLinkEligibility } from '@/lib/linked-accounts/eligibility';
import { findLiveLinkBetween } from '@/lib/linked-accounts/queries';

const MAX_RESULTS = 8;

/**
 * GET /api/venue/account-links/search?q=... — Admin-only "search by name" for
 * the send-link form (§20). Matches the fragment against venue `name` or `slug`
 * and returns a short pick-list with per-venue eligibility. Only ever returns a
 * venue's public display name + slug (the same data its public booking page
 * reveals) — never PII. Typing a full slug still works since slug is matched too.
 */
export async function GET(request: NextRequest) {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;

  if (!ctx.eligibility.feature) {
    return NextResponse.json({ error: 'Linked Accounts is not available.' }, { status: 403 });
  }

  const raw = (request.nextUrl.searchParams.get('q') ?? '').trim();
  // Restrict to characters that appear in venue names/slugs. This neutralises
  // ILIKE wildcards (% _) and PostgREST `.or()` separators (, ()) in one step.
  const term = raw.replace(/[^a-zA-Z0-9 &'\-.]/g, ' ').trim();
  if (term.length < 2) {
    return NextResponse.json({ results: [] });
  }

  try {
    const pattern = `%${term}%`;
    const { data: rows, error } = await ctx.admin
      .from('venues')
      .select('id, name, slug, pricing_tier, plan_status, booking_model')
      .or(`name.ilike.${pattern},slug.ilike.${pattern}`)
      .order('name', { ascending: true })
      .limit(MAX_RESULTS + 1); // +1 so we can flag truncation

    if (error) throw error;

    const candidates = (rows ?? []).filter((v) => (v.id as string) !== ctx.venueId);
    const truncated = candidates.length > MAX_RESULTS;
    const slice = candidates.slice(0, MAX_RESULTS);

    const results = await Promise.all(
      slice.map(async (v) => {
        const venueId = v.id as string;
        const eligibility = evaluateLinkEligibility({
          pricing_tier: v.pricing_tier as string | null,
          plan_status: v.plan_status as string | null,
          booking_model: v.booking_model as string | null,
        });
        let eligible = true;
        let reason: string | null = null;
        if (!eligibility.feature) {
          eligible = false;
          reason = 'This venue cannot use linked accounts.';
        } else if (!eligibility.canCreate) {
          eligible = false;
          reason = 'Not available to link right now.';
        } else {
          const existing = await findLiveLinkBetween(ctx.admin, ctx.venueId, venueId);
          if (existing) {
            eligible = false;
            reason =
              existing.status === 'pending'
                ? 'A request with this venue is already pending.'
                : 'You are already linked with this venue.';
          }
        }
        return {
          name: v.name as string,
          slug: v.slug as string,
          eligible,
          reason,
        };
      }),
    );

    return NextResponse.json({ results, truncated });
  } catch (err) {
    console.error('GET /api/venue/account-links/search failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
