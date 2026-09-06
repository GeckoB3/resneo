import type { SupabaseClient } from '@supabase/supabase-js';
import type { AssistantVenueContext } from './venue-context';

/**
 * The Ask ResNeo conversation log (Docs/help-assistant-plan.md, 4.1). Two service-role
 * tables, `assistant_conversations` and `assistant_messages`, written with the admin client.
 * Every write here is best effort: a logging failure (including the tables not yet existing
 * on an environment) is logged and swallowed, and the answer still reaches the person. The
 * log is what the weekly gap review runs on, not what the answer depends on.
 */

export interface NewConversation {
  venueId: string;
  staffId: string | null;
  client: 'web' | 'app';
  model: string;
  corpusVersion: string;
  context: AssistantVenueContext;
}

export interface NewMessage {
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  replyTo?: string | null;
  citedArticleIds?: string[];
  answered?: boolean | null;
  inputTokens?: number | null;
  cachedInputTokens?: number | null;
  outputTokens?: number | null;
  latencyMs?: number | null;
}

function warn(where: string, error: unknown): void {
  const message = error instanceof Error ? error.message : (error as { message?: string })?.message ?? String(error);
  console.warn(`[assistant log] ${where} failed: ${message}`);
}

export async function createConversation(admin: SupabaseClient, input: NewConversation): Promise<string | null> {
  try {
    const { data, error } = await admin
      .from('assistant_conversations')
      .insert({
        venue_id: input.venueId,
        staff_id: input.staffId,
        client: input.client,
        model: input.model,
        corpus_version: input.corpusVersion,
        context: input.context,
      })
      .select('id')
      .single();
    if (error) throw error;
    return (data as { id: string }).id;
  } catch (e) {
    warn('createConversation', e);
    return null;
  }
}

/** True when the conversation exists and belongs to the venue. */
export async function conversationBelongsToVenue(admin: SupabaseClient, conversationId: string, venueId: string): Promise<boolean> {
  try {
    const { data, error } = await admin
      .from('assistant_conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('venue_id', venueId)
      .maybeSingle();
    if (error) throw error;
    return Boolean(data);
  } catch (e) {
    warn('conversationBelongsToVenue', e);
    return false;
  }
}

export async function insertMessage(admin: SupabaseClient, input: NewMessage): Promise<string | null> {
  try {
    const { data, error } = await admin
      .from('assistant_messages')
      .insert({
        conversation_id: input.conversationId,
        reply_to: input.replyTo ?? null,
        role: input.role,
        content: input.content,
        cited_article_ids: input.citedArticleIds ?? [],
        answered: input.answered ?? null,
        input_tokens: input.inputTokens ?? null,
        cached_input_tokens: input.cachedInputTokens ?? null,
        output_tokens: input.outputTokens ?? null,
        latency_ms: input.latencyMs ?? null,
      })
      .select('id')
      .single();
    if (error) throw error;
    return (data as { id: string }).id;
  } catch (e) {
    warn('insertMessage', e);
    return null;
  }
}

/**
 * User messages this venue has sent since local midnight in its timezone. Null when the count
 * cannot be read (for example before the migration lands), in which case the cap is not applied.
 */
export async function countUserMessagesToday(admin: SupabaseClient, venueId: string, timezone: string, now: Date = new Date()): Promise<number | null> {
  try {
    const sinceIso = startOfTodayIso(timezone, now);
    const { data: conversations, error: convError } = await admin
      .from('assistant_conversations')
      .select('id')
      .eq('venue_id', venueId)
      .gte('created_at', new Date(now.getTime() - 48 * 3600 * 1000).toISOString());
    if (convError) throw convError;
    const ids = ((conversations ?? []) as Array<{ id: string }>).map((c) => c.id);
    if (ids.length === 0) return 0;
    const { count, error } = await admin
      .from('assistant_messages')
      .select('id', { count: 'exact', head: true })
      .in('conversation_id', ids)
      .eq('role', 'user')
      .gte('created_at', sinceIso);
    if (error) throw error;
    return count ?? 0;
  } catch (e) {
    warn('countUserMessagesToday', e);
    return null;
  }
}

/** The UTC instant of local midnight today in the given timezone. */
export function startOfTodayIso(timezone: string, now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
    // Elapsed time since local midnight, in the venue's clock, subtracted from now.
    const elapsedMs = ((get('hour') % 24) * 3600 + get('minute') * 60 + get('second')) * 1000;
    return new Date(now.getTime() - elapsedMs).toISOString();
  } catch {
    const d = new Date(now);
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString();
  }
}

export async function rateMessage(
  admin: SupabaseClient,
  input: { messageId: string; venueId: string; rating: 1 | -1; comment: string | null },
): Promise<'ok' | 'not_found' | 'error'> {
  try {
    const { data: message, error: readError } = await admin
      .from('assistant_messages')
      .select('id, conversation_id, role')
      .eq('id', input.messageId)
      .maybeSingle();
    if (readError) throw readError;
    const row = message as { id: string; conversation_id: string; role: string } | null;
    if (!row || row.role !== 'assistant') return 'not_found';
    const owned = await conversationBelongsToVenue(admin, row.conversation_id, input.venueId);
    if (!owned) return 'not_found';
    const { error } = await admin
      .from('assistant_messages')
      .update({ rating: input.rating, rating_comment: input.comment })
      .eq('id', input.messageId);
    if (error) throw error;
    return 'ok';
  } catch (e) {
    warn('rateMessage', e);
    return 'error';
  }
}
