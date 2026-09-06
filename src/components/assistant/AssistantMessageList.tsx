'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, Textarea } from '@/components/ui/primitives';
import { ASSISTANT_COPY } from '@/lib/assistant/copy';
import { AssistantMarkdown } from './AssistantMarkdown';
import type { AssistantChatMessage } from './useAssistantChat';

export interface AssistantMessageListProps {
  messages: AssistantChatMessage[];
  streaming: boolean;
  onRate: (id: string, rating: 1 | -1, comment?: string) => void;
  onSendToSupport: (upToMessageId: string) => void;
  onNavigateWithin: (pathname: string) => void;
}

export function AssistantMessageList({ messages, streaming, onRate, onSendToSupport, onNavigateWithin }: AssistantMessageListProps) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const lastContent = messages[messages.length - 1]?.content ?? '';

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, lastContent]);

  return (
    <div className="flex flex-col gap-4" data-testid="assistant-messages">
      {messages.map((m) =>
        m.role === 'user' ? (
          <div key={m.id} className="flex justify-end">
            <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-brand-600 px-4 py-2.5 text-sm text-white shadow-sm">{m.content}</div>
          </div>
        ) : (
          <AssistantTurn key={m.id} message={m} streaming={streaming && Boolean(m.pending)} onRate={onRate} onSendToSupport={onSendToSupport} onNavigateWithin={onNavigateWithin} />
        ),
      )}
      <div ref={endRef} />
    </div>
  );
}

function AssistantTurn({
  message,
  streaming,
  onRate,
  onSendToSupport,
  onNavigateWithin,
}: {
  message: AssistantChatMessage;
  streaming: boolean;
  onRate: AssistantMessageListProps['onRate'];
  onSendToSupport: AssistantMessageListProps['onSendToSupport'];
  onNavigateWithin: AssistantMessageListProps['onNavigateWithin'];
}) {
  const [commentOpen, setCommentOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [commentSent, setCommentSent] = useState(false);
  const finished = !message.pending && !message.error;

  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-3 shadow-sm">
        {message.content ? (
          <div aria-live={streaming ? 'polite' : undefined} aria-busy={streaming || undefined}>
            <AssistantMarkdown markdown={message.content} onNavigateWithin={onNavigateWithin} />
          </div>
        ) : streaming ? (
          <p className="flex items-center gap-2 text-sm text-slate-500" aria-live="polite">
            <span className="inline-flex gap-1" aria-hidden>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400 [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400 [animation-delay:300ms]" />
            </span>
            {ASSISTANT_COPY.thinking}
          </p>
        ) : null}

        {message.error ? <p className="mt-2 text-sm text-rose-700">{message.error}</p> : null}
        {message.stopped && message.content ? <p className="mt-2 text-xs text-slate-500">Stopped before the answer finished.</p> : null}

        {finished && message.content ? (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-slate-100 pt-2 text-xs text-slate-500">
            {message.serverId ? (
              message.rating ? (
                <span>{ASSISTANT_COPY.feedbackThanks}</span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <span>{ASSISTANT_COPY.feedbackPrompt}</span>
                  <button
                    type="button"
                    className="rounded-md px-1.5 py-0.5 font-medium text-slate-700 hover:bg-slate-100"
                    onClick={() => onRate(message.id, 1)}
                    aria-label="Yes, this was helpful"
                  >
                    {ASSISTANT_COPY.feedbackYes}
                  </button>
                  <button
                    type="button"
                    className="rounded-md px-1.5 py-0.5 font-medium text-slate-700 hover:bg-slate-100"
                    onClick={() => setCommentOpen(true)}
                    aria-label="No, this was not helpful"
                  >
                    {ASSISTANT_COPY.feedbackNo}
                  </button>
                </span>
              )
            ) : null}
            <button type="button" className="ml-auto font-medium text-brand-700 hover:underline" onClick={() => onSendToSupport(message.id)}>
              {ASSISTANT_COPY.sendToSupport}
            </button>
          </div>
        ) : null}

        {commentOpen && !message.rating && !commentSent ? (
          <form
            className="mt-2 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              onRate(message.id, -1, comment);
              setCommentSent(true);
              setCommentOpen(false);
            }}
          >
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} maxLength={500} placeholder={ASSISTANT_COPY.feedbackCommentPlaceholder} aria-label="Feedback comment" />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => { onRate(message.id, -1); setCommentOpen(false); }}>
                Skip
              </Button>
              <Button type="submit" size="sm">
                {ASSISTANT_COPY.feedbackCommentSend}
              </Button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}
