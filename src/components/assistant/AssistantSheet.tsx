'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Sheet } from '@/components/ui/primitives';
import { ASSISTANT_COPY } from '@/lib/assistant/copy';
import { useAssistant } from './AssistantProvider';
import { AssistantComposer } from './AssistantComposer';
import { AssistantMessageList } from './AssistantMessageList';
import { useAssistantChat } from './useAssistantChat';
import { writeHandoff } from './handoff';

/**
 * The Ask ResNeo drawer (Docs/help-assistant-plan.md, 3.3): the `Sheet` primitive on the
 * right, the conversation, and the composer. The conversation state lives inside the sheet
 * content, which Radix mounts only while open, so it hydrates from sessionStorage on open and
 * never runs on the server. No suggested questions (decision D3).
 */
export function AssistantSheet() {
  const { enabled, open, setOpen } = useAssistant();
  if (!enabled) return null;
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={ASSISTANT_COPY.title}
      description={ASSISTANT_COPY.description}
      side="right"
      contentClassName="sm:max-w-xl"
    >
      <AssistantConversation onClose={() => setOpen(false)} />
    </Sheet>
  );
}

export function AssistantConversation({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { state, send, stop, reset, rate } = useAssistantChat();
  const streaming = state.status === 'streaming';

  const navigateWithin = useCallback(
    (pathname: string) => {
      onClose();
      router.push(pathname);
    },
    [onClose, router],
  );

  const sendToSupport = useCallback(
    (upToMessageId: string) => {
      const index = state.messages.findIndex((m) => m.id === upToMessageId);
      const turns = (index >= 0 ? state.messages.slice(0, index + 1) : state.messages)
        .filter((m) => !m.pending && m.content.trim())
        .map((m) => ({ role: m.role, content: m.content }));
      writeHandoff(turns);
      onClose();
      router.push('/dashboard/support');
    },
    [onClose, router, state.messages],
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="assistant-conversation">
      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        {state.messages.length > 0 ? (
          <AssistantMessageList messages={state.messages} streaming={streaming} onRate={rate} onSendToSupport={sendToSupport} onNavigateWithin={navigateWithin} />
        ) : null}
      </div>

      {state.notice ? (
        <p role="status" className="mb-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {state.notice}
        </p>
      ) : null}

      <div className="shrink-0 border-t border-slate-100 pt-3">
        <AssistantComposer streaming={streaming} disabled={state.blocked === 'daily_cap' || state.blocked === 'unavailable'} onSend={send} onStop={stop} />
        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-500">
          <span>{ASSISTANT_COPY.disclaimer}</span>
          {state.messages.length > 0 ? (
            <Button type="button" variant="link" size="sm" className="shrink-0 text-[11px]" onClick={reset}>
              {ASSISTANT_COPY.newConversation}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
