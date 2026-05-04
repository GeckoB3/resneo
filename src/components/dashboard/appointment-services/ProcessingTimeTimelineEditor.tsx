'use client';

import type { ProcessingTimeBlock } from '@/types/booking-models';
import {
  PROCESSING_BLOCK_MIN_MINUTES,
  customerOccupyMinutes,
  validateProcessingTimeBlocks,
} from '@/lib/appointments/processing-time';
import { HelpTooltip } from '@/components/dashboard/HelpTooltip';

interface ProcessingTimeTimelineEditorProps {
  durationMinutes: number;
  bufferMinutes: number;
  blocks: ProcessingTimeBlock[];
  onChange: (next: ProcessingTimeBlock[]) => void;
  /** Slightly tighter layout when embedded in variant rows */
  compact?: boolean;
}

function randomId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `pt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function ProcessingTimeTimelineEditor({
  durationMinutes,
  bufferMinutes,
  blocks,
  onChange,
  compact,
}: ProcessingTimeTimelineEditorProps) {
  const total = Math.max(5, customerOccupyMinutes(durationMinutes, bufferMinutes));
  const validation = validateProcessingTimeBlocks(blocks, durationMinutes);
  const err = validation.ok ? null : validation.error;

  const activeTotalMins = blocks.reduce((sum, b) => sum + b.duration_minutes, 0);
  const procLabel = `${activeTotalMins} min processing${activeTotalMins === 1 ? '' : ''}`;

  const updateRow = (id: string, patch: Partial<Pick<ProcessingTimeBlock, 'start_minute' | 'duration_minutes'>>) => {
    onChange(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };

  const removeRow = (id: string) => {
    onChange(blocks.filter((b) => b.id !== id));
  };

  const addRow = () => {
    const last = [...blocks].sort((a, b) => a.start_minute - b.start_minute).pop();
    const nextStart = last ? Math.min(durationMinutes - 5, last.start_minute + last.duration_minutes) : 0;
    onChange([
      ...blocks,
      {
        id: randomId(),
        start_minute: Math.max(0, Math.min(nextStart, durationMinutes - PROCESSING_BLOCK_MIN_MINUTES)),
        duration_minutes: Math.min(
          PROCESSING_BLOCK_MIN_MINUTES * 2,
          Math.max(PROCESSING_BLOCK_MIN_MINUTES, durationMinutes - nextStart),
        ),
      },
    ]);
  };

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm font-medium text-slate-700">Processing time</label>
        <HelpTooltip content="During processing time you are free to take another booking that fits entirely inside the gap." />
      </div>
      <p className="text-xs text-slate-500">
        Gaps inside the appointment duration where the client stays but you can book someone else. Buffer time after
        the service cannot be used as processing time.
      </p>

      <div
        className="relative h-10 w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100 shadow-inner"
        aria-hidden
      >
        <div className="absolute inset-y-0 left-0 bg-blue-500/85" style={{ width: `${(durationMinutes / total) * 100}%` }} />
        <div
          className="absolute inset-y-0 border-l border-r border-white/30 bg-slate-300/90"
          style={{
            left: `${(durationMinutes / total) * 100}%`,
            width: `${(bufferMinutes / total) * 100}%`,
          }}
        />
        {blocks.map((b) => {
          const w = durationMinutes > 0 ? (b.duration_minutes / total) * 100 : 0;
          const left = durationMinutes > 0 ? (b.start_minute / total) * 100 : 0;
          return (
            <div
              key={b.id}
              className="absolute inset-y-0 bg-amber-300/80 bg-[repeating-linear-gradient(120deg,transparent,transparent_3px,rgba(0,0,0,0.07)_3px,rgba(0,0,0,0.07)_6px)]"
              style={{ left: `${left}%`, width: `${w}%` }}
              title={`${b.start_minute}–${b.start_minute + b.duration_minutes} min`}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-4 rounded-sm bg-blue-500/85" /> Active with client
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-4 rounded-sm bg-amber-300/80" /> Processing (you are free)
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-4 rounded-sm bg-slate-300/90" /> Buffer / turnover
        </span>
        <span className="font-medium text-slate-800">Total span: {total} min</span>
        <span className="font-medium text-slate-800">{procLabel}</span>
      </div>

      {err ? <p className="text-xs text-red-600">{err}</p> : null}

      <div className="space-y-2">
        {blocks.length === 0 ? (
          <p className="text-xs text-slate-500">No processing periods — one continuous active block for the full duration.</p>
        ) : (
          blocks.map((b) => (
            <div key={b.id} className="flex flex-wrap items-end gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
              <div>
                <label className="mb-0.5 block text-[11px] font-medium text-slate-600">Start (min)</label>
                <input
                  type="number"
                  min={0}
                  max={durationMinutes}
                  value={b.start_minute}
                  onChange={(e) => updateRow(b.id, { start_minute: Number(e.target.value) })}
                  className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
                />
              </div>
              <div>
                <label className="mb-0.5 block text-[11px] font-medium text-slate-600">Length (min)</label>
                <input
                  type="number"
                  min={PROCESSING_BLOCK_MIN_MINUTES}
                  max={durationMinutes}
                  value={b.duration_minutes}
                  onChange={(e) => updateRow(b.id, { duration_minutes: Number(e.target.value) })}
                  className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
                />
              </div>
              <button
                type="button"
                onClick={() => removeRow(b.id)}
                className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-white hover:text-red-700"
              >
                Remove
              </button>
            </div>
          ))
        )}
      </div>

      <button
        type="button"
        onClick={addRow}
        className="rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-blue-400 hover:bg-blue-50/50"
      >
        + Add processing period
      </button>
    </div>
  );
}
