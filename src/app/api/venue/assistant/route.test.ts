import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/venue-route-client', () => ({
  createVenueRouteClient: vi.fn(async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) } })),
}));
vi.mock('@/lib/venue-auth', () => ({ getVenueStaff: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: vi.fn(() => ({ tag: 'admin' })) }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(() => ({ ok: true })), getClientIp: vi.fn(() => '203.0.113.9') }));
vi.mock('@/lib/assistant/venue-context', () => ({
  loadAssistantVenueContext: vi.fn(async (_staff: unknown, input: { client: string; page: string | null }) => ({
    planLabel: 'Appointments Plus',
    planStatus: 'active',
    role: 'admin',
    activeBookingModels: ['unified_scheduling'],
    stripeConnected: true,
    featureFlagsOn: [],
    complianceEnabled: false,
    sms: 'included',
    calendars: null,
    terminology: null,
    timezone: 'Europe/London',
    client: input.client,
    page: input.page,
    today: '2026-09-06',
  })),
}));
vi.mock('@/lib/assistant/select-articles', () => ({ selectAssistantArticles: vi.fn() }));
vi.mock('@/lib/assistant/openai-stream', () => ({
  streamAssistantCompletion: vi.fn(),
  describeOpenAiError: vi.fn(() => ({ status: null, message: 'x', body: null })),
}));
vi.mock('@/lib/assistant/log', () => ({
  createConversation: vi.fn(async () => 'conv-1'),
  conversationBelongsToVenue: vi.fn(async () => true),
  insertMessage: vi.fn(async () => 'msg-1'),
  countUserMessagesToday: vi.fn(async () => 0),
}));

import { getVenueStaff } from '@/lib/venue-auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { streamAssistantCompletion } from '@/lib/assistant/openai-stream';
import { selectAssistantArticles } from '@/lib/assistant/select-articles';
import { conversationBelongsToVenue, countUserMessagesToday, createConversation, insertMessage } from '@/lib/assistant/log';
import { GET, POST } from './route';

const VENUE = '22222222-2222-4222-8222-222222222222';
const CONVERSATION = '33333333-3333-4333-8333-333333333333';

function request(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest('https://resneo.test/api/venue/assistant', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function readSse(res: Response): Promise<Array<{ event: string; data: Record<string, unknown> }>> {
  const text = await res.text();
  return text
    .split('\n\n')
    .filter(Boolean)
    .map((frame) => {
      const event = frame.match(/^event: (.*)$/m)![1]!;
      const data = JSON.parse(frame.match(/^data: (.*)$/m)![1]!) as Record<string, unknown>;
      return { event, data };
    });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('ASSISTANT_ENABLED', 'true');
  vi.stubEnv('ASSISTANT_VENUE_ALLOWLIST', '');
  vi.stubEnv('ASSISTANT_DAILY_CAP', '');
  vi.mocked(getVenueStaff).mockResolvedValue({ id: 'staff-1', venue_id: VENUE, email: 'a@b.c', role: 'admin', db: {} } as never);
  vi.mocked(selectAssistantArticles).mockResolvedValue({
    articles: [
      {
        id: 'getting-started/stripe-payments',
        href: '/help/getting-started/stripe-payments',
        title: 'Connect Stripe to take payments',
        categoryTitle: 'Getting started',
        description: 'How to connect Stripe.',
        tags: ['stripe'],
        markdown: '# Connect Stripe\n\nOpen Settings then Payments.',
      },
    ],
    via: 'model',
    approxTokens: 12,
  });
  vi.mocked(streamAssistantCompletion).mockImplementation(async ({ onToken }) => {
    onToken('1. Go to ');
    onToken('**Settings → Payments**.\n\nRead more: [Connect Stripe](/help/getting-started/stripe-payments) and [Nope](/help/nope/nope)');
    return {
      text: '1. Go to **Settings → Payments**.\n\nRead more: [Connect Stripe](/help/getting-started/stripe-payments) and [Nope](/help/nope/nope)',
      usage: { inputTokens: 100, cachedInputTokens: 90, outputTokens: 20 },
      finishReason: 'stop',
    };
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** R27: a client asks whether to draw its Ask ResNeo entry point at all. */
describe('GET /api/venue/assistant', () => {
  function get(headers: Record<string, string> = {}) {
    return GET(new NextRequest('https://resneo.test/api/venue/assistant', { headers }));
  }

  it('says enabled for a venue the assistant is on for', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: true });
    expect(res.headers.get('Cache-Control')).toContain('no-store');
  });

  it('says disabled rather than 404 when the kill switch is off, so a client can hide its row', async () => {
    vi.stubEnv('ASSISTANT_ENABLED', 'false');
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: false });
  });

  it('says disabled for a venue outside the beta allowlist', async () => {
    vi.stubEnv('ASSISTANT_VENUE_ALLOWLIST', '99999999-9999-4999-8999-999999999999');
    expect(await (await get()).json()).toEqual({ enabled: false });
  });

  it('answers the bare 401 with no staff, like every other venue route', async () => {
    vi.mocked(getVenueStaff).mockResolvedValue(null as never);
    const res = await get();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorised' });
  });
});

/** Docs/help-assistant-plan.md, 5.2. */
describe('POST /api/venue/assistant', () => {
  it('answers the bare 401 when the request resolves to no staff', async () => {
    vi.mocked(getVenueStaff).mockResolvedValue(null as never);
    const res = await POST(request({ messages: [{ role: 'user', content: 'hi' }] }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorised' });
  });

  it('does not exist while the kill switch is off', async () => {
    vi.stubEnv('ASSISTANT_ENABLED', 'false');
    const res = await POST(request({ messages: [{ role: 'user', content: 'hi' }] }));
    expect(res.status).toBe(404);
  });

  it('does not exist for a venue outside the beta allowlist', async () => {
    vi.stubEnv('ASSISTANT_VENUE_ALLOWLIST', '99999999-9999-4999-8999-999999999999');
    const res = await POST(request({ messages: [{ role: 'user', content: 'hi' }] }));
    expect(res.status).toBe(404);
  });

  it('rejects a bad body with 400', async () => {
    expect((await POST(request('{not json'))).status).toBe(400);
    expect((await POST(request({ messages: [] }))).status).toBe(400);
    expect((await POST(request({ messages: [{ role: 'assistant', content: 'x' }] }))).status).toBe(400);
  });

  it('returns 429 with Retry-After when the venue is rate limited', async () => {
    vi.mocked(checkRateLimit).mockReturnValueOnce({ ok: false, retryAfterSec: 42 });
    const res = await POST(request({ messages: [{ role: 'user', content: 'hi' }] }));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('42');
    expect((await res.json()).code).toBe('rate_limited');
  });

  it('returns 429 daily_cap once the venue has used its day', async () => {
    vi.stubEnv('ASSISTANT_DAILY_CAP', '5');
    vi.mocked(countUserMessagesToday).mockResolvedValueOnce(5);
    const res = await POST(request({ messages: [{ role: 'user', content: 'hi' }] }));
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe('daily_cap');
    expect(vi.mocked(streamAssistantCompletion)).not.toHaveBeenCalled();
  });

  it("refuses another venue's conversation id with 404", async () => {
    vi.mocked(conversationBelongsToVenue).mockResolvedValueOnce(false);
    const res = await POST(request({ conversationId: CONVERSATION, messages: [{ role: 'user', content: 'hi' }] }));
    expect(res.status).toBe(404);
  });

  it('streams meta, tokens and done, logs both turns, and strips an invented link', async () => {
    const res = await POST(request({ messages: [{ role: 'user', content: 'How do I connect Stripe?' }], page: '/dashboard/settings' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    expect(res.headers.get('Cache-Control')).toContain('no-store');

    const frames = await readSse(res);
    expect(frames[0]!.event).toBe('meta');
    expect(frames[0]!.data).toMatchObject({
      conversationId: 'conv-1',
      userMessageId: 'msg-1',
      articles: ['getting-started/stripe-payments'],
      selectedVia: 'model',
    });
    expect(frames.filter((f) => f.event === 'token').map((f) => f.data.t).join('')).toContain('Settings → Payments');
    const done = frames[frames.length - 1]!;
    expect(done.event).toBe('done');
    expect(done.data.text).toContain('[Connect Stripe](/help/getting-started/stripe-payments)');
    expect(done.data.text).toContain(' and Nope');
    expect(done.data.text).not.toContain('/help/nope/nope');
    expect(done.data.citations).toEqual(['getting-started/stripe-payments']);
    expect(done.data.answered).toBe(true);

    // Instructions, then ONLY the chosen article, then the venue context, then the question.
    const call = vi.mocked(streamAssistantCompletion).mock.calls[0]![0];
    expect(call.messages[0]!.role).toBe('system');
    expect(call.messages[1]!.content).toContain('# Help centre articles');
    expect(call.messages[1]!.content).toContain('Path: /help/getting-started/stripe-payments');
    expect(call.messages[2]!.content).toContain('Screen the question was asked from: /dashboard/settings');
    expect(call.messages[call.messages.length - 1]).toEqual({ role: 'user', content: 'How do I connect Stripe?' });
    // The selector saw the venue context too, so plan questions route correctly.
    expect(vi.mocked(selectAssistantArticles).mock.calls[0]![0].contextBlock).toContain('# This venue');

    expect(vi.mocked(createConversation)).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ venueId: VENUE, client: 'web' }));
    expect(vi.mocked(insertMessage)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(insertMessage).mock.calls[1]![1]).toMatchObject({
      role: 'assistant',
      replyTo: 'msg-1',
      citedArticleIds: ['getting-started/stripe-payments'],
      answered: true,
      inputTokens: 100,
      cachedInputTokens: 90,
      outputTokens: 20,
    });
  });

  it('marks a Bearer caller as the app', async () => {
    const res = await POST(request({ messages: [{ role: 'user', content: 'hi' }] }, { authorization: 'Bearer token-1' }));
    await res.text();
    expect(vi.mocked(createConversation)).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ client: 'app' }));
    const call = vi.mocked(streamAssistantCompletion).mock.calls[0]![0];
    expect(call.messages[2]!.content).toContain('Using: the ResNeo app');
  });

  it('still answers when logging is unavailable', async () => {
    vi.mocked(createConversation).mockResolvedValueOnce(null);
    const res = await POST(request({ messages: [{ role: 'user', content: 'hi' }] }));
    const frames = await readSse(res);
    expect(frames[0]!.data).toMatchObject({ conversationId: null, userMessageId: null });
    expect(frames[frames.length - 1]!.event).toBe('done');
    expect(vi.mocked(insertMessage)).not.toHaveBeenCalled();
  });

  it('emits an error event when the model call fails', async () => {
    vi.mocked(streamAssistantCompletion).mockRejectedValueOnce(new Error('boom'));
    const res = await POST(request({ messages: [{ role: 'user', content: 'hi' }] }));
    const frames = await readSse(res);
    expect(frames[frames.length - 1]!.event).toBe('error');
    expect(typeof frames[frames.length - 1]!.data.message).toBe('string');
  });
});
