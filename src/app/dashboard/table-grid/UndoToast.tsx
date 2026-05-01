'use client';

import { useEffect } from 'react';
import type { UndoAction } from '@/types/table-management';

interface Props {
  action: UndoAction;
  onUndo: () => void;
  onDismiss: () => void;
}

export function UndoToast({ action, onUndo, onDismiss }: Props) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 10_000);
    return () => clearTimeout(timer);
  }, [action.id, onDismiss]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        onUndo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onUndo]);

  return (
    <div className="fixed left-1/2 z-50 max-w-[calc(100vw-1rem)] -translate-x-1/2 px-2 bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] sm:bottom-20">
      <div className="flex flex-wrap items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-xl sm:flex-nowrap sm:gap-2">
        <p className="min-w-0 flex-1 text-center text-xs text-slate-700 sm:text-left">{action.description}</p>
        <button
          type="button"
          onClick={onUndo}
          className="min-h-8 shrink-0 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
        >
          Undo
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="flex min-h-8 min-w-8 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          aria-label="Dismiss"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
