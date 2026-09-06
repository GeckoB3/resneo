import { describe, expect, it, vi } from 'vitest';
import { countUserMessagesToday, createConversation, insertMessage, rateMessage, startOfTodayIso } from './log';

describe('startOfTodayIso', () => {
  it('returns local midnight in the venue timezone as a UTC instant', () => {
    // 22:30 UTC on 6 Sept is 23:30 BST; London midnight that day was 23:00 UTC on 5 Sept.
    expect(startOfTodayIso('Europe/London', new Date('2026-09-06T22:30:00Z'))).toBe('2026-09-05T23:00:00.000Z');
    // In Auckland (UTC+12) it is already 10:30 on 7 Sept; midnight was 12:00 UTC on 6 Sept.
    expect(startOfTodayIso('Pacific/Auckland', new Date('2026-09-06T22:30:00Z'))).toBe('2026-09-06T12:00:00.000Z');
  });

  it('falls back to UTC midnight for an unknown zone', () => {
    expect(startOfTodayIso('Not/AZone', new Date('2026-09-06T22:30:00Z'))).toBe('2026-09-06T00:00:00.000Z');
  });
});

const MISSING_TABLE = { data: null, error: { message: 'relation "assistant_conversations" does not exist' } };

/**
 * A PostgREST-shaped builder that rejects everything: each method chains, and the builder is
 * itself thenable, because the real client resolves on await without a terminal call
 * (`countUserMessagesToday` awaits `.gte(...)` directly).
 */
function failingAdmin() {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  Object.assign(builder, {
    insert: chain,
    select: chain,
    eq: chain,
    gte: chain,
    in: chain,
    update: chain,
    single: async () => MISSING_TABLE,
    maybeSingle: async () => MISSING_TABLE,
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(MISSING_TABLE).then(resolve),
  });
  return { from: () => builder } as never;
}

/** Every write is best effort: a missing table must never break an answer. */
describe('log helpers when the tables are missing', () => {
  it('return null or an error status and warn, without throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const admin = failingAdmin();
    expect(
      await createConversation(admin, { venueId: 'v', staffId: null, client: 'web', model: 'm', corpusVersion: 'c', context: {} as never }),
    ).toBeNull();
    expect(await insertMessage(admin, { conversationId: 'c', role: 'user', content: 'x' })).toBeNull();
    expect(await countUserMessagesToday(admin, 'v', 'Europe/London')).toBeNull();
    expect(await rateMessage(admin, { messageId: 'm', venueId: 'v', rating: 1, comment: null })).toBe('error');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
