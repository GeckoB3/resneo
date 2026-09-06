import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { buildAssistantCorpus } from '@/lib/help/assistant-corpus';
import { assistantDailyCap, assistantEnabledFor } from '@/lib/assistant/enabled';
import { assistantModel } from '@/lib/assistant/model';
import { ASSISTANT_COPY } from '@/lib/assistant/copy';
import { assistantRequestSchema } from '@/lib/assistant/request-schema';
import { loadAssistantVenueContext, type AssistantClient } from '@/lib/assistant/venue-context';
import { buildAssistantMessages, buildContextBlock } from '@/lib/assistant/prompt';
import { selectAssistantArticles } from '@/lib/assistant/select-articles';
import { postprocessAnswer } from '@/lib/assistant/postprocess';
import { describeOpenAiError, streamAssistantCompletion } from '@/lib/assistant/openai-stream';
import { conversationBelongsToVenue, countUserMessagesToday, createConversation, insertMessage } from '@/lib/assistant/log';

/**
 * POST /api/venue/assistant — Ask ResNeo (Docs/help-assistant-plan.md, 3.2).
 *
 * Answers a how-to question from the help centre articles, made specific with the venue's
 * plan, settings and the caller's role, and streams the answer back as server-sent events:
 *
 *   event: meta   data: { conversationId, userMessageId }
 *   event: token  data: { t }                                   (many)
 *   event: done   data: { assistantMessageId, text, citations, answered }
 *   event: error  data: { message }
 *
 * Takes the dashboard's cookie session or the app's Bearer token (`createVenueRouteClient`,
 * the pair the Support route uses). `EventSource` cannot POST, so clients read the body with
 * `fetch` and a stream reader. Read only: the assistant has no tools and no write path beyond
 * its own log, so a bad answer is the whole blast radius.
 */
export const runtime = 'nodejs';
export const maxDuration = 60;

const RATE_WINDOW_MS = 10 * 60_000;
const VENUE_LIMIT_PER_WINDOW = 30;
const IP_LIMIT_PER_WINDOW = 60;

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: NextRequest): Promise<Response> {
  const supabase = await createVenueRouteClient(request);
  const staff = await getVenueStaff(supabase);
  if (!staff) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }
  if (!assistantEnabledFor(staff.venue_id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const venueLimit = checkRateLimit(staff.venue_id, 'assistant-venue', VENUE_LIMIT_PER_WINDOW, RATE_WINDOW_MS);
  const ipLimit = checkRateLimit(getClientIp(request), 'assistant-ip', IP_LIMIT_PER_WINDOW, RATE_WINDOW_MS);
  const limited = !venueLimit.ok ? venueLimit : !ipLimit.ok ? ipLimit : null;
  if (limited && !limited.ok) {
    return NextResponse.json(
      { error: ASSISTANT_COPY.rateLimited, code: 'rate_limited', retryAfterSec: limited.retryAfterSec },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = assistantRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }
  const { conversationId: requestedConversationId, messages, page } = parsed.data;

  const bearer = /^bearer\s+/i.test(request.headers.get('authorization') ?? '');
  const client: AssistantClient = bearer ? 'app' : (parsed.data.client ?? 'web');

  const admin = getSupabaseAdminClient();
  const ctx = await loadAssistantVenueContext(staff, { client, page: page ?? null });

  const used = await countUserMessagesToday(admin, staff.venue_id, ctx.timezone);
  if (used !== null && used >= assistantDailyCap()) {
    return NextResponse.json({ error: ASSISTANT_COPY.dailyCap, code: 'daily_cap' }, { status: 429 });
  }

  if (requestedConversationId && !(await conversationBelongsToVenue(admin, requestedConversationId, staff.venue_id))) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
  }

  const corpus = buildAssistantCorpus();
  const model = assistantModel();
  const question = messages[messages.length - 1]!.content;

  const conversationId =
    requestedConversationId ??
    (await createConversation(admin, {
      venueId: staff.venue_id,
      staffId: staff.id,
      client,
      model,
      corpusVersion: corpus.version,
      context: ctx,
    }));
  const userMessageId = conversationId
    ? await insertMessage(admin, { conversationId, role: 'user', content: question })
    : null;

  // Two calls (Docs/help-assistant-plan.md 2.2, Mode B): choose the few articles this
  // question needs, then answer from just those. The whole help centre outgrew one prompt.
  const selection = await selectAssistantArticles({
    corpus,
    history: messages,
    contextBlock: buildContextBlock(ctx),
    model,
    signal: request.signal,
  });
  const chatMessages = buildAssistantMessages(ctx, messages, selection.articles);
  const encoder = new TextEncoder();
  const startedAt = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(sse(event, data)));
      send('meta', {
        conversationId,
        userMessageId,
        model,
        articles: selection.articles.map((a) => a.id),
        selectedVia: selection.via,
      });
      try {
        const result = await streamAssistantCompletion({
          model,
          messages: chatMessages,
          signal: request.signal,
          onToken: (t) => send('token', { t }),
        });
        const processed = postprocessAnswer(result.text, corpus);
        if (processed.droppedLinks > 0) {
          console.warn('[assistant] dropped links the model invented', { count: processed.droppedLinks, model });
        }
        const assistantMessageId = conversationId
          ? await insertMessage(admin, {
              conversationId,
              role: 'assistant',
              content: processed.text,
              replyTo: userMessageId,
              citedArticleIds: processed.citations,
              answered: processed.answered,
              inputTokens: result.usage?.inputTokens ?? null,
              cachedInputTokens: result.usage?.cachedInputTokens ?? null,
              outputTokens: result.usage?.outputTokens ?? null,
              latencyMs: Date.now() - startedAt,
            })
          : null;
        send('done', {
          assistantMessageId,
          text: processed.text,
          citations: processed.citations,
          answered: processed.answered,
          finishReason: result.finishReason,
        });
      } catch (e) {
        if (request.signal.aborted) {
          controller.close();
          return;
        }
        console.error('[assistant] OpenAI error', { model, ...describeOpenAiError(e) });
        send('error', { message: ASSISTANT_COPY.error });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    },
  });
}
