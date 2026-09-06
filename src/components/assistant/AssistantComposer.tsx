'use client';

import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { Button, Textarea } from '@/components/ui/primitives';
import { ASSISTANT_COPY } from '@/lib/assistant/copy';
import { MAX_MESSAGE_CHARS } from '@/lib/assistant/request-schema';

export interface AssistantComposerProps {
  streaming: boolean;
  disabled: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}

export function AssistantComposer({ streaming, disabled, onSend, onStop }: AssistantComposerProps) {
  const [text, setText] = useState('');
  const canSend = !streaming && !disabled && text.trim().length > 0;

  function submit() {
    if (!canSend) return;
    onSend(text);
    setText('');
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    submit();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, MAX_MESSAGE_CHARS))}
        onKeyDown={handleKeyDown}
        rows={2}
        maxLength={MAX_MESSAGE_CHARS}
        placeholder={ASSISTANT_COPY.placeholder}
        aria-label={ASSISTANT_COPY.placeholder}
        disabled={disabled}
        className="min-h-[3.25rem] flex-1 resize-none"
        autoFocus
      />
      {streaming ? (
        <Button type="button" variant="secondary" onClick={onStop} aria-label={ASSISTANT_COPY.stop}>
          {ASSISTANT_COPY.stop}
        </Button>
      ) : (
        <Button type="submit" disabled={!canSend} aria-label={ASSISTANT_COPY.send}>
          {ASSISTANT_COPY.send}
        </Button>
      )}
    </form>
  );
}
