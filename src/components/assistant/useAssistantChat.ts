'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ASSISTANT_COPY } from '@/lib/assistant/copy';
import { ASSISTANT_CONVERSATION_KEY } from './handoff';

/**
 * Client state for one Ask ResNeo conversation (Docs/help-assistant-plan.md, 3.3).
 * Sends to POST /api/venue/assistant, reads the server-sent events off the response body
 * (EventSource cannot POST), and mirrors the conversation into sessionStorage so it survives
 * closing the drawer and navigating within the tab.
 */

export type AssistantBlockedReason = 'rate_limited' | 'daily_cap' | 'unavailable' | null;

export interface AssistantChatMessage {
  /** Local id, stable for React keys. */
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Row id in assistant_messages once the server has stored it; null when logging was off. */
  serverId?: string | null;
  citations?: string[];
  answered?: boolean;
  rating?: 1 | -1 | null;
  /** Set on an assistant turn that failed. */
  error?: string | null;
  /** The person pressed Stop before the answer finished. */
  stopped?: boolean;
  /** Still streaming. */
  pending?: boolean;
}

export interface AssistantChatState {
  conversationId: string | null;
  messages: AssistantChatMessage[];
  status: 'idle' | 'streaming';
  blocked: AssistantBlockedReason;
  notice: string | null;
}

interface StoredConversation {
  v: 1;
  conversationId: string | null;
  messages: AssistantChatMessage[];
}

const EMPTY: AssistantChatState = { conversationId: null, messages: [], status: 'idle', blocked: null, notice: null };

/** The server keeps the last eleven messages; sending more is wasted bytes. */
const HISTORY_LIMIT = 11;

function localId(): string {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function readStoredConversation(): Pick<AssistantChatState, 'conversationId' | 'messages'> {
  try {
    const raw = window.sessionStorage.getItem(ASSISTANT_CONVERSATION_KEY);
    if (!raw) return { conversationId: null, messages: [] };
    const parsed = JSON.parse(raw) as Partial<StoredConversation>;
    if (parsed.v !== 1 || !Array.isArray(parsed.messages)) return { conversationId: null, messages: [] };
    return {
      conversationId: typeof parsed.conversationId === 'string' ? parsed.conversationId : null,
      messages: parsed.messages.filter(
        (m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && !m.pending,
      ),
    };
  } catch {
    return { conversationId: null, messages: [] };
  }
}

function storeConversation(conversationId: string | null, messages: AssistantChatMessage[]): void {
  try {
    if (messages.length === 0) {
      window.sessionStorage.removeItem(ASSISTANT_CONVERSATION_KEY);
      return;
    }
    const payload: StoredConversation = { v: 1, conversationId, messages: messages.filter((m) => !m.pending) };
    window.sessionStorage.setItem(ASSISTANT_CONVERSATION_KEY, JSON.stringify(payload));
  } catch {
    /* storage unavailable */
  }
}

/** Splits an SSE text buffer into (event, data) pairs, returning the unfinished tail. */
export function parseSseFrames(buffer: string): { frames: Array<{ event: string; data: string }>; rest: string } {
  const frames: Array<{ event: string; data: string }> = [];
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  for (const part of parts) {
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of part.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length) frames.push({ event, data: dataLines.join('\n') });
  }
  return { frames, rest };
}

/** Turns that are sent back to the server as conversation history. */
function historyOf(messages: AssistantChatMessage[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  return messages
    .filter((m) => !m.pending && !m.error && m.content.trim().length > 0)
    .slice(-HISTORY_LIMIT)
    .map((m) => ({ role: m.role, content: m.content }));
}

export function useAssistantChat() {
  const [state, setState] = useState<AssistantChatState>(() => {
    if (typeof window === 'undefined') return EMPTY;
    return { ...EMPTY, ...readStoredConversation() };
  });
  const stateRef = useRef(state);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Mirror the conversation into sessionStorage between answers (never mid-stream).
  useEffect(() => {
    if (state.status === 'idle') storeConversation(state.conversationId, state.messages);
  }, [state]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const patchMessage = useCallback(
    (id: string, patch: Partial<AssistantChatMessage> | ((m: AssistantChatMessage) => Partial<AssistantChatMessage>)) => {
      setState((prev) => ({
        ...prev,
        messages: prev.messages.map((m) => (m.id === id ? { ...m, ...(typeof patch === 'function' ? patch(m) : patch) } : m)),
      }));
    },
    [],
  );

  const send = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || abortRef.current) return;

      const current = stateRef.current;
      const userMessage: AssistantChatMessage = { id: localId(), role: 'user', content: question };
      const assistantMessage: AssistantChatMessage = { id: localId(), role: 'assistant', content: '', pending: true };
      const history = [...historyOf(current.messages), { role: 'user' as const, content: question }].slice(-HISTORY_LIMIT);
      const conversationId = current.conversationId;

      setState((prev) => ({
        ...prev,
        status: 'streaming',
        blocked: null,
        notice: null,
        messages: [...prev.messages.filter((m) => !m.pending), userMessage, assistantMessage],
      }));

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch('/api/venue/assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          signal: controller.signal,
          body: JSON.stringify({
            conversationId: conversationId ?? undefined,
            messages: history,
            client: 'web',
            page: typeof window !== 'undefined' ? window.location.pathname : undefined,
          }),
        });

        if (!res.ok || !res.body) {
          const j = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
          const blocked: AssistantBlockedReason =
            res.status === 429 ? (j.code === 'daily_cap' ? 'daily_cap' : 'rate_limited') : res.status === 404 ? 'unavailable' : null;
          const notice =
            blocked === 'daily_cap'
              ? ASSISTANT_COPY.dailyCap
              : blocked === 'rate_limited'
                ? ASSISTANT_COPY.rateLimited
                : blocked === 'unavailable'
                  ? ASSISTANT_COPY.unavailable
                  : (j.error ?? ASSISTANT_COPY.error);
          setState((prev) => ({
            ...prev,
            blocked,
            notice,
            messages: prev.messages.filter((m) => m.id !== assistantMessage.id),
          }));
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finished = false;
        while (!finished) {
          const chunk = await reader.read();
          finished = chunk.done;
          if (chunk.value) buffer += decoder.decode(chunk.value, { stream: true });
          const parsed = parseSseFrames(buffer);
          buffer = parsed.rest;
          for (const frame of parsed.frames) {
            let data: Record<string, unknown> = {};
            try {
              data = JSON.parse(frame.data) as Record<string, unknown>;
            } catch {
              continue;
            }
            if (frame.event === 'meta') {
              const id = typeof data.conversationId === 'string' ? data.conversationId : null;
              if (id) setState((prev) => ({ ...prev, conversationId: id }));
            } else if (frame.event === 'token') {
              const t = typeof data.t === 'string' ? data.t : '';
              if (t) patchMessage(assistantMessage.id, (m) => ({ content: m.content + t }));
            } else if (frame.event === 'done') {
              patchMessage(assistantMessage.id, (m) => ({
                content: typeof data.text === 'string' ? data.text : m.content,
                serverId: typeof data.assistantMessageId === 'string' ? data.assistantMessageId : null,
                citations: Array.isArray(data.citations) ? (data.citations as string[]) : [],
                answered: data.answered !== false,
                pending: false,
              }));
            } else if (frame.event === 'error') {
              patchMessage(assistantMessage.id, {
                error: typeof data.message === 'string' ? data.message : ASSISTANT_COPY.error,
                pending: false,
              });
            }
          }
        }
      } catch {
        if (controller.signal.aborted) {
          patchMessage(assistantMessage.id, (m) => ({ pending: false, stopped: true, error: m.content ? null : 'Stopped before an answer arrived.' }));
        } else {
          patchMessage(assistantMessage.id, { error: ASSISTANT_COPY.error, pending: false });
        }
      } finally {
        abortRef.current = null;
        setState((prev) => ({
          ...prev,
          status: 'idle',
          messages: prev.messages.map((m) => (m.id === assistantMessage.id && m.pending ? { ...m, pending: false } : m)),
        }));
      }
    },
    [patchMessage],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState(EMPTY);
  }, []);

  const rate = useCallback(async (id: string, rating: 1 | -1, comment?: string) => {
    const serverId = stateRef.current.messages.find((m) => m.id === id)?.serverId;
    setState((prev) => ({ ...prev, messages: prev.messages.map((m) => (m.id === id ? { ...m, rating } : m)) }));
    if (!serverId) return;
    try {
      await fetch('/api/venue/assistant/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ messageId: serverId, rating, comment: comment?.trim() || undefined }),
      });
    } catch {
      /* feedback is best effort */
    }
  }, []);

  return { state, send, stop, reset, rate };
}
