import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { normaliseGuestTagsInput } from '@/lib/guests/tags';
import { insertContactAuditEvent } from '@/lib/guests/contact-audit';
import { sendMarketingContactMessage } from '@/lib/communications/send-marketing-contact-message';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { eraseGuestVenuePii } from '@/lib/guests/gdpr-erase-guest';

const bulkSchema = z.union([
  z.object({
    action: z.literal('preview'),
    guest_ids: z.array(z.string().uuid()).min(1).max(500),
  }),
  z.object({
    action: z.literal('add_tag'),
    guest_ids: z.array(z.string().uuid()).min(1).max(500),
    tag: z.string().min(1).max(60),
    dry_run: z.boolean().optional(),
  }),
  z.object({
    action: z.literal('remove_tag'),
    guest_ids: z.array(z.string().uuid()).min(1).max(500),
    tag: z.string().min(1).max(60),
    dry_run: z.boolean().optional(),
  }),
  z.object({
    action: z.literal('marketing_message'),
    guest_ids: z.array(z.string().uuid()).min(1).max(200),
    subject: z.string().min(1).max(200),
    body: z.string().min(1).max(4000),
    channel: z.enum(['email', 'sms', 'both']),
    dry_run: z.boolean().optional(),
  }),
  z.object({
    action: z.literal('anonymise'),
    guest_ids: z.array(z.string().uuid()).min(1).max(100),
    dry_run: z.boolean().optional(),
  }),
]);

/**
 * POST /api/venue/contacts/bulk — dry-run previews and bulk mutations.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const parsed = bulkSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const body = parsed.data;

    const { data: guests, error: gErr } = await staff.db
      .from('guests')
      .select(
        'id, first_name, last_name, email, phone, tags, marketing_opt_out, marketing_consent',
      )
      .eq('venue_id', staff.venue_id)
      .in('id', body.guest_ids);

    if (gErr) {
      console.error('bulk: guest load failed', gErr);
      return NextResponse.json({ error: 'Failed to load guests' }, { status: 500 });
    }

    const rows = guests ?? [];
    const foundIds = new Set(rows.map((r) => (r as { id: string }).id));
    const missing = body.guest_ids.filter((id) => !foundIds.has(id));

    if (body.action === 'preview') {
      return NextResponse.json({
        matched: rows.length,
        missing_ids: missing,
        sample: rows.slice(0, 10),
      });
    }

    if (body.action === 'add_tag') {
      const tag = body.tag.trim();
      const tagNorm = normaliseGuestTagsInput([tag])[0];
      if (!tagNorm) {
        return NextResponse.json({ error: 'Invalid tag' }, { status: 400 });
      }
      const updates: { id: string; skipped: boolean; reason?: string }[] = [];
      for (const row of rows) {
        const r = row as { id: string; tags: string[] | null };
        const tags = Array.isArray(r.tags) ? [...r.tags] : [];
        if (tags.includes(tagNorm)) {
          updates.push({ id: r.id, skipped: true, reason: 'already_has_tag' });
          continue;
        }
        if (body.dry_run) {
          updates.push({ id: r.id, skipped: false });
          continue;
        }
        tags.push(tagNorm);
        const { error } = await staff.db.from('guests').update({ tags, updated_at: new Date().toISOString() }).eq('id', r.id);
        updates.push({ id: r.id, skipped: Boolean(error), reason: error?.message });
      }
      if (!body.dry_run) {
        await insertContactAuditEvent(staff.db, {
          venue_id: staff.venue_id,
          guest_id: null,
          actor_staff_id: staff.id,
          event_type: 'bulk_add_tag',
          metadata: { tag: tagNorm, guest_count: rows.length },
        });
      }
      return NextResponse.json({ results: updates, missing_ids: missing });
    }

    if (body.action === 'remove_tag') {
      const tagNorm = normaliseGuestTagsInput([body.tag.trim()])[0];
      if (!tagNorm) {
        return NextResponse.json({ error: 'Invalid tag' }, { status: 400 });
      }
      const updates: { id: string; skipped: boolean }[] = [];
      for (const row of rows) {
        const r = row as { id: string; tags: string[] | null };
        const tags = (Array.isArray(r.tags) ? r.tags : []).filter((t) => t !== tagNorm);
        if (body.dry_run) {
          updates.push({ id: r.id, skipped: false });
          continue;
        }
        await staff.db.from('guests').update({ tags, updated_at: new Date().toISOString() }).eq('id', r.id);
        updates.push({ id: r.id, skipped: false });
      }
      if (!body.dry_run) {
        await insertContactAuditEvent(staff.db, {
          venue_id: staff.venue_id,
          guest_id: null,
          actor_staff_id: staff.id,
          event_type: 'bulk_remove_tag',
          metadata: { tag: tagNorm, guest_count: rows.length },
        });
      }
      return NextResponse.json({ results: updates, missing_ids: missing });
    }

    if (body.action === 'marketing_message') {
      const results: { guest_id: string; sent?: boolean; skipped_reason?: string; error?: string }[] = [];
      for (const row of rows) {
        const r = row as { id: string; marketing_opt_out: boolean; marketing_consent: boolean };
        if (body.dry_run) {
          if (r.marketing_opt_out) results.push({ guest_id: r.id, skipped_reason: 'opt_out' });
          else if (!r.marketing_consent) results.push({ guest_id: r.id, skipped_reason: 'no_consent' });
          else results.push({ guest_id: r.id, sent: true });
          continue;
        }
        const out = await sendMarketingContactMessage({
          venueId: staff.venue_id,
          guestId: r.id,
          subject: body.subject,
          bodyText: body.body,
          channel: body.channel,
        });
        if (out.skippedReason) {
          results.push({ guest_id: r.id, skipped_reason: out.skippedReason });
        } else if (out.error) {
          results.push({ guest_id: r.id, error: out.error });
        } else {
          results.push({ guest_id: r.id, sent: true });
        }
      }
      await insertContactAuditEvent(staff.db, {
        venue_id: staff.venue_id,
        guest_id: null,
        actor_staff_id: staff.id,
        event_type: 'bulk_marketing_message',
        metadata: { count: rows.length, channel: body.channel, dry_run: Boolean(body.dry_run) },
      });
      return NextResponse.json({ results, missing_ids: missing });
    }

    if (body.action === 'anonymise') {
      if (!requireAdmin(staff)) {
        return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });
      }
      const admin = getSupabaseAdminClient();
      const results: { guest_id: string; ok: boolean; error?: string }[] = [];
      for (const row of rows) {
        const r = row as { id: string };
        if (body.dry_run) {
          results.push({ guest_id: r.id, ok: true });
          continue;
        }
        try {
          await eraseGuestVenuePii(admin, staff.venue_id, r.id);
          await insertContactAuditEvent(staff.db, {
            venue_id: staff.venue_id,
            guest_id: r.id,
            actor_staff_id: staff.id,
            event_type: 'bulk_anonymise_guest',
            metadata: {},
          });
          results.push({ guest_id: r.id, ok: true });
        } catch (e) {
          results.push({
            guest_id: r.id,
            ok: false,
            error: e instanceof Error ? e.message : 'failed',
          });
        }
      }
      return NextResponse.json({ results, missing_ids: missing });
    }

    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
  } catch (err) {
    console.error('POST /api/venue/contacts/bulk failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
