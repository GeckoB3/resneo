/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it } from 'vitest';
import { ASSISTANT_CONVERSATION_KEY } from './handoff';
import { parseSseFrames, readStoredConversation } from './useAssistantChat';

describe('parseSseFrames', () => {
  it('splits complete frames and keeps the unfinished tail', () => {
    const { frames, rest } = parseSseFrames('event: meta\ndata: {"a":1}\n\nevent: token\ndata: {"t":"hi"}\n\nevent: tok');
    expect(frames).toEqual([
      { event: 'meta', data: '{"a":1}' },
      { event: 'token', data: '{"t":"hi"}' },
    ]);
    expect(rest).toBe('event: tok');
  });

  it('defaults the event name and joins multi-line data', () => {
    const { frames } = parseSseFrames('data: a\ndata: b\n\n');
    expect(frames).toEqual([{ event: 'message', data: 'a\nb' }]);
  });
});

describe('readStoredConversation', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('returns an empty conversation when nothing is stored or the payload is malformed', () => {
    expect(readStoredConversation()).toEqual({ conversationId: null, messages: [] });
    window.sessionStorage.setItem(ASSISTANT_CONVERSATION_KEY, '{not json');
    expect(readStoredConversation()).toEqual({ conversationId: null, messages: [] });
    window.sessionStorage.setItem(ASSISTANT_CONVERSATION_KEY, JSON.stringify({ v: 2, messages: [] }));
    expect(readStoredConversation()).toEqual({ conversationId: null, messages: [] });
  });

  it('restores finished turns and drops pending ones', () => {
    window.sessionStorage.setItem(
      ASSISTANT_CONVERSATION_KEY,
      JSON.stringify({
        v: 1,
        conversationId: 'conv-1',
        messages: [
          { id: 'a', role: 'user', content: 'hi' },
          { id: 'b', role: 'assistant', content: 'hello', serverId: 'm1' },
          { id: 'c', role: 'assistant', content: '', pending: true },
        ],
      }),
    );
    const stored = readStoredConversation();
    expect(stored.conversationId).toBe('conv-1');
    expect(stored.messages.map((m) => m.id)).toEqual(['a', 'b']);
  });
});
