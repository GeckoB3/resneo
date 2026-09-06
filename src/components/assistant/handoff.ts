/**
 * Carrying an Ask ResNeo conversation into the Support form (Docs/help-assistant-plan.md,
 * 3.3). The drawer writes the transcript to sessionStorage and navigates to
 * /dashboard/support; the Support page reads it once on mount and prefills its fields.
 * sessionStorage rather than localStorage: a handoff should not outlive the tab, and
 * sign-out wipes localStorage anyway.
 */
import { ASSISTANT_COPY } from '@/lib/assistant/copy';

export const ASSISTANT_HANDOFF_KEY = 'resneo.assistant.handoff';
export const ASSISTANT_CONVERSATION_KEY = 'resneo.assistant.conversation';

/** The Support route accepts at most this many characters in the message. */
export const SUPPORT_MESSAGE_MAX = 5000;

export interface AssistantHandoff {
  subject: string;
  message: string;
}

export interface TranscriptTurn {
  role: 'user' | 'assistant';
  content: string;
}

export function buildHandoffMessage(turns: TranscriptTurn[]): string {
  const lines: string[] = ['I asked Ask ResNeo and did not get what I needed. Here is the conversation:', ''];
  for (const t of turns) {
    lines.push(t.role === 'user' ? `Me: ${t.content.trim()}` : `Ask ResNeo: ${t.content.trim()}`);
    lines.push('');
  }
  lines.push('What I still need help with:');
  lines.push('');
  const text = lines.join('\n');
  if (text.length <= SUPPORT_MESSAGE_MAX) return text;
  const marker = '\n[conversation shortened]\n';
  return text.slice(0, SUPPORT_MESSAGE_MAX - marker.length) + marker;
}

export function writeHandoff(turns: TranscriptTurn[]): void {
  try {
    const payload: AssistantHandoff = { subject: ASSISTANT_COPY.handoffSubject, message: buildHandoffMessage(turns) };
    window.sessionStorage.setItem(ASSISTANT_HANDOFF_KEY, JSON.stringify(payload));
  } catch {
    /* storage unavailable: the Support page simply opens blank */
  }
}

let cachedHandoff: AssistantHandoff | null | undefined;

/**
 * Reads the handoff once per page lifetime and clears it from storage, returning the same
 * object on every later call so it can back `useSyncExternalStore` without re-renders.
 */
export function readHandoffOnce(): AssistantHandoff | null {
  if (cachedHandoff !== undefined) return cachedHandoff;
  try {
    const raw = window.sessionStorage.getItem(ASSISTANT_HANDOFF_KEY);
    window.sessionStorage.removeItem(ASSISTANT_HANDOFF_KEY);
    if (!raw) {
      cachedHandoff = null;
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<AssistantHandoff>;
    cachedHandoff =
      typeof parsed.message === 'string' && parsed.message.trim()
        ? { subject: typeof parsed.subject === 'string' ? parsed.subject : ASSISTANT_COPY.handoffSubject, message: parsed.message }
        : null;
  } catch {
    cachedHandoff = null;
  }
  return cachedHandoff;
}

/** Test hook: forget the cached read. */
export function resetHandoffCache(): void {
  cachedHandoff = undefined;
}

export const noHandoff = (): AssistantHandoff | null => null;
export const subscribeToNothing = (): (() => void) => () => {};
