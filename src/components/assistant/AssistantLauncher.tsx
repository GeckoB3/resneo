'use client';

import { ASSISTANT_COPY } from '@/lib/assistant/copy';
import { useAssistant } from './AssistantProvider';

/**
 * The sidebar entry for Ask ResNeo (Docs/help-assistant-plan.md, 3.3), styled like the
 * sidebar's other footer links. Renders nothing while the assistant is switched off.
 */
export function AssistantLauncher({ onNavigate, className }: { onNavigate?: () => void; className?: string }) {
  const { enabled, open, setOpen } = useAssistant();
  if (!enabled) return null;
  return (
    <button
      type="button"
      onClick={() => {
        onNavigate?.();
        setOpen(true);
      }}
      aria-haspopup="dialog"
      aria-expanded={open}
      data-testid="assistant-launcher"
      className={`group flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors ${
        open ? 'bg-white text-brand-800 shadow-sm ring-1 ring-slate-100' : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
      } ${className ?? ''}`}
    >
      <SparkIcon className={`h-5 w-5 flex-shrink-0 ${open ? 'text-brand-600' : 'text-slate-400 group-hover:text-brand-600'}`} />
      <span className="min-w-0 flex-1 leading-snug">{ASSISTANT_COPY.launcher}</span>
    </button>
  );
}

function SparkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z"
      />
    </svg>
  );
}
