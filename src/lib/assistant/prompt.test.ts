import { describe, expect, it } from 'vitest';
import { buildAssistantCorpus } from '@/lib/help/assistant-corpus';
import { ASSISTANT_COPY } from './copy';
import {
  FALLBACK_SENTENCE,
  MAX_HISTORY_MESSAGES,
  STATIC_INSTRUCTIONS,
  buildArticlesBlock,
  buildAssistantMessages,
  buildContextBlock,
  buildStaticSystemPrompt,
} from './prompt';
import type { AssistantVenueContext } from './venue-context';

const EM_DASH = /—/;

const CTX: AssistantVenueContext = {
  planLabel: 'Appointments Plus',
  planStatus: 'active',
  role: 'admin',
  activeBookingModels: ['unified_scheduling', 'class_session'],
  stripeConnected: true,
  featureFlagsOn: ['appointment waitlist', 'any available practitioner'],
  complianceEnabled: true,
  sms: 'included',
  calendars: { used: 4, limit: 5 },
  terminology: { client: 'Clients', booking: 'Appointments', staff: 'Stylists' },
  timezone: 'Europe/London',
  client: 'web',
  page: '/dashboard/calendar',
  today: '2026-09-06',
};

/** Docs/help-assistant-plan.md, 5.1. */
describe('the static prompt', () => {
  it('is byte-identical for every venue and every question (the prompt caching invariant)', () => {
    const corpus = buildAssistantCorpus();
    const a = corpus.articles.slice(0, 2);
    const b = corpus.articles.slice(5, 7);
    expect(buildStaticSystemPrompt()).toBe(buildStaticSystemPrompt());
    expect(buildAssistantMessages(CTX, [{ role: 'user', content: 'a' }], a)[0]).toEqual(
      buildAssistantMessages({ ...CTX, page: '/dashboard/contacts' }, [{ role: 'user', content: 'b' }], b)[0],
    );
  });

  it('is the instructions alone, so the cached prefix never carries an article', () => {
    expect(buildStaticSystemPrompt()).toBe(STATIC_INSTRUCTIONS);
  });

  it('sends only the chosen articles, in full, and says so when none was chosen', () => {
    const corpus = buildAssistantCorpus();
    const chosen = corpus.articles.slice(0, 2);
    const block = buildArticlesBlock(chosen);
    for (const a of chosen) {
      expect(block).toContain(`Path: ${a.href}`);
      expect(block).toContain(a.markdown);
    }
    const omitted = corpus.articles[10]!;
    expect(block).not.toContain(`Path: ${omitted.href}`);
    // A whole-corpus prompt is what Mode B exists to avoid.
    expect(Math.round(block.length / 4)).toBeLessThan(30_000);
    expect(buildArticlesBlock([])).toContain('No help article covers this question.');
  });

  it('contains no em-dash, and neither does the user-facing copy', () => {
    expect(STATIC_INSTRUCTIONS).not.toMatch(EM_DASH);
    expect(FALLBACK_SENTENCE).not.toMatch(EM_DASH);
    for (const [key, value] of Object.entries(ASSISTANT_COPY)) {
      expect(value, key).not.toMatch(EM_DASH);
    }
  });

  it('quotes the fallback sentence verbatim so the route can detect it', () => {
    expect(STATIC_INSTRUCTIONS).toContain(`"${FALLBACK_SENTENCE}"`);
  });
});

describe('buildContextBlock', () => {
  it('renders every field of the venue context', () => {
    const block = buildContextBlock(CTX);
    expect(block).toContain('# This venue');
    expect(block).toContain('- Plan: Appointments Plus (status: active)');
    expect(block).toContain("- The person's role: admin");
    expect(block).toContain('- Booking types switched on: appointments, classes');
    expect(block).toContain('- Stripe payments: connected');
    expect(block).toContain('- Optional features switched on: appointment waitlist, any available practitioner');
    expect(block).toContain('- Compliance records: switched on');
    expect(block).toContain('- Calendars: 4 of 5 used');
    expect(block).toContain('- SMS messages: included in this plan');
    expect(block).toContain('- Words this venue uses: "Clients" for guests, "Appointments" for bookings, "Stylists" for staff');
    expect(block).toContain('- Using: the web dashboard');
    expect(block).toContain('- Screen the question was asked from: /dashboard/calendar');
    expect(block).toContain('- Today: 2026-09-06 (Europe/London)');
  });

  it('omits unknown lines and words the Light plan differently', () => {
    const block = buildContextBlock({
      ...CTX,
      planLabel: 'Appointments Light',
      role: 'staff',
      featureFlagsOn: [],
      complianceEnabled: false,
      sms: 'pay_as_you_go_no_card',
      calendars: { used: 1, limit: 1 },
      terminology: null,
      client: 'app',
      page: null,
    });
    expect(block).toContain('staff (can only see their own calendars and cannot open venue Settings)');
    expect(block).toContain('- Optional features switched on: none');
    expect(block).toContain('- Compliance records: switched off');
    expect(block).toContain('- Calendars: 1 of 1 used');
    expect(block).toContain('- SMS messages: pay as you go, no card on file yet');
    expect(block).not.toContain('Words this venue uses');
    expect(block).not.toContain('Screen the question was asked from');
    expect(block).toContain('- Using: the ResNeo app');
    expect(buildContextBlock({ ...CTX, calendars: { used: 9, limit: null } })).toContain('- Calendars: 9 (no limit on this plan)');
  });
});

describe('buildAssistantMessages', () => {
  it('orders instructions, articles, context, then at most the last eleven turns', () => {
    const corpus = buildAssistantCorpus();
    const history = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 === 0 ? ('user' as const) : ('assistant' as const), content: `m${i}` }));
    const messages = buildAssistantMessages(CTX, history, corpus.articles.slice(0, 2));
    expect(messages[0]!.content).toBe(STATIC_INSTRUCTIONS);
    expect(messages[1]!.content.startsWith('# Help centre articles')).toBe(true);
    expect(messages[2]!.content.startsWith('# This venue')).toBe(true);
    expect(messages.slice(0, 3).every((m) => m.role === 'system')).toBe(true);
    expect(messages.length).toBe(3 + MAX_HISTORY_MESSAGES);
    expect(messages[messages.length - 1]).toEqual({ role: 'assistant', content: 'm29' });
  });
});
