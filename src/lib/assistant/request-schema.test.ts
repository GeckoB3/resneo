import { describe, expect, it } from 'vitest';
import { assistantFeedbackSchema, assistantRequestSchema, MAX_MESSAGE_CHARS } from './request-schema';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('assistantRequestSchema', () => {
  it('accepts a minimal first question', () => {
    const r = assistantRequestSchema.safeParse({ messages: [{ role: 'user', content: 'How do I set my hours?' }] });
    expect(r.success).toBe(true);
  });

  it('accepts a follow-up with a conversation id, client and page', () => {
    const r = assistantRequestSchema.safeParse({
      conversationId: UUID,
      client: 'app',
      page: '/dashboard/calendar',
      messages: [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
        { role: 'user', content: 'c' },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('rejects a history that does not end with the user', () => {
    const r = assistantRequestSchema.safeParse({ messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] });
    expect(r.success).toBe(false);
  });

  it('rejects empty, oversized and too many messages', () => {
    expect(assistantRequestSchema.safeParse({ messages: [] }).success).toBe(false);
    expect(assistantRequestSchema.safeParse({ messages: [{ role: 'user', content: '   ' }] }).success).toBe(false);
    expect(assistantRequestSchema.safeParse({ messages: [{ role: 'user', content: 'x'.repeat(MAX_MESSAGE_CHARS + 1) }] }).success).toBe(false);
    const many = Array.from({ length: 21 }, () => ({ role: 'user' as const, content: 'x' }));
    expect(assistantRequestSchema.safeParse({ messages: many }).success).toBe(false);
  });

  it('rejects a bad conversation id, client or page', () => {
    const base = { messages: [{ role: 'user', content: 'a' }] };
    expect(assistantRequestSchema.safeParse({ ...base, conversationId: 'nope' }).success).toBe(false);
    expect(assistantRequestSchema.safeParse({ ...base, client: 'desktop' }).success).toBe(false);
    expect(assistantRequestSchema.safeParse({ ...base, page: 'https://evil.example/x' }).success).toBe(false);
    expect(assistantRequestSchema.safeParse({ ...base, page: '/dashboard?tab=x' }).success).toBe(false);
  });
});

describe('assistantFeedbackSchema', () => {
  it('accepts a rating with an optional comment', () => {
    expect(assistantFeedbackSchema.safeParse({ messageId: UUID, rating: 1 }).success).toBe(true);
    expect(assistantFeedbackSchema.safeParse({ messageId: UUID, rating: -1, comment: 'Wrong tab' }).success).toBe(true);
  });

  it('rejects other ratings and long comments', () => {
    expect(assistantFeedbackSchema.safeParse({ messageId: UUID, rating: 0 }).success).toBe(false);
    expect(assistantFeedbackSchema.safeParse({ messageId: UUID, rating: 1, comment: 'x'.repeat(501) }).success).toBe(false);
  });
});
