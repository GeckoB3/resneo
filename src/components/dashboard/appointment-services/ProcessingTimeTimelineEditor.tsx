'use client';

import type { ProcessingTimeBlock } from '@/types/booking-models';
import {
  PROCESSING_BLOCK_MIN_MINUTES,
  placeNewProcessingBlock,
  processingActiveEndMinutes,
  processingTailMinutes,
  resizeProcessingBlock,
  serviceSpanMinutes,
  validateProcessingTimeBlocks,
} from '@/lib/appointments/processing-time';
import { HelpTooltip } from '@/components/dashboard/HelpTooltip';
import { Button } from '@/components/ui/primitives/Button';

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

/** A cleared number input reads as '', which `Number` turns into NaN-free 0. */
function numberOrZero(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export function ProcessingTimeTimelineEditor({
  durationMinutes,
  bufferMinutes,
  blocks,
  onChange,
  compact,
}: ProcessingTimeTimelineEditorProps) {
  const validation = validateProcessingTimeBlocks(blocks, durationMinutes);
  const err = validation.ok ? null : validation.error;
  const tail = processingTailMinutes(blocks, durationMinutes);
  const activeEnd = processingActiveEndMinutes(blocks, durationMinutes);
  // The bar spans the service, any processing that runs past it, then the buffer.
  const total = Math.max(
    5,
    serviceSpanMinutes({ durationMinutes, bufferMinutes, processingBlocks: blocks }),
  );
  const pct = (mins: number) => `${(Math.max(0, mins) / total) * 100}%`;

  const activeTotalMins = blocks.reduce((sum, b) => sum + b.duration_minutes, 0);
  const procLabel = `${activeTotalMins} min processing`;

  const updateRow = (id: string, patch: Partial<Pick<ProcessingTimeBlock, 'start_minute' | 'duration_minutes'>>) => {
    onChange(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };

  const removeRow = (id: string) => {
    onChange(blocks.filter((b) => b.id !== id));
  };

  const addRow = () => {
    // The first period goes after the service (the common case: the client
    // waits while colour develops and the chair is free); further ones fill
    // backwards inside it. Nothing fits: fall back to a block at the start so
    // the validator's message explains why rather than the button silently
    // doing nothing.
    const placed = placeNewProcessingBlock(blocks, durationMinutes) ?? {
      start_minute: 0,
      duration_minutes: PROCESSING_BLOCK_MIN_MINUTES,
    };
    onChange([...blocks, { id: randomId(), ...placed }]);
  };

  const updateLength = (id: string, raw: string) => {
    const next = Math.max(PROCESSING_BLOCK_MIN_MINUTES, numberOrZero(raw));
    onChange(blocks.map((b) => (b.id === id ? resizeProcessingBlock(b, next, durationMinutes) : b)));
  };

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <label className="text-sm font-semibold text-slate-900">Processing time</label>
          <HelpTooltip content="During processing time you are free to take another booking that fits inside the gap. A period that starts at the end of the service runs on after it: it is not part of the service length, and the next service in the same visit waits until it has finished." />
        </div>
        <Button type="button" onClick={addRow}>
          + Add processing period
        </Button>
      </div>
      {blocks.length > 0 && (
        <>
          <p className="text-xs text-slate-500">
            Time the client waits (colour developing, a mask setting) while you are free to see someone else. A
            period can sit inside the service, or start at its end and run on afterwards. Buffer time comes after
            all of it.
          </p>

          <div
            className="relative h-10 w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100 shadow-inner"
            aria-hidden
          >
            {/* Active time with the client: up to where the trailing processing begins. */}
            <div className="absolute inset-y-0 left-0 bg-blue-500/85" style={{ width: pct(activeEnd) }} />
            {/* The service's remaining length, when a period runs to its end: paler, the chair is free. */}
            {activeEnd < durationMinutes ? (
              <div
                className="absolute inset-y-0 bg-blue-500/20"
                style={{ left: pct(activeEnd), width: pct(durationMinutes - activeEnd) }}
              />
            ) : null}
            <div
              className="absolute inset-y-0 border-l border-r border-white/30 bg-slate-300/90"
              style={{
                left: pct(durationMinutes + tail),
                width: pct(bufferMinutes),
              }}
            />
            {blocks.map((b) => (
              <div
                key={b.id}
                className="absolute inset-y-0 bg-amber-300/80 bg-[repeating-linear-gradient(120deg,transparent,transparent_3px,rgba(0,0,0,0.07)_3px,rgba(0,0,0,0.07)_6px)]"
                style={{ left: pct(b.start_minute), width: pct(b.duration_minutes) }}
                title={`${b.start_minute}–${b.start_minute + b.duration_minutes} min`}
              />
            ))}
            {/* Where the service itself ends. */}
            {tail > 0 ? (
              <div
                className="absolute inset-y-0 w-px bg-slate-900/40"
                style={{ left: pct(durationMinutes) }}
                title={`Service ends at ${durationMinutes} min`}
              />
            ) : null}
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
            <span className="font-medium text-slate-800">Service: {durationMinutes} min</span>
            {tail > 0 ? <span className="font-medium text-slate-800">After the service: {tail} min</span> : null}
            <span className="font-medium text-slate-800">Total span: {total} min</span>
            <span className="font-medium text-slate-800">{procLabel}</span>
          </div>

          {err ? <p className="text-xs text-red-600">{err}</p> : null}

          <div className="space-y-2">
            {blocks.map((b) => {
              const runsPastEnd = b.start_minute + b.duration_minutes > durationMinutes;
              const startsAtEnd = b.start_minute >= durationMinutes;
              return (
                <div key={b.id} className="flex flex-wrap items-end gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                  <div>
                    <label className="mb-0.5 block text-[11px] font-medium text-slate-600">Start (min)</label>
                    <input
                      type="number"
                      min={0}
                      max={durationMinutes}
                      value={b.start_minute}
                      // Clearing a number input yields '', and Number('') is 0.
                      // Left raw, an emptied Length field stored 0, which fails the
                      // schema's min(1) BEFORE the friendly range message can be
                      // produced, so the owner saw a generic invalid-request error.
                      onChange={(e) => updateRow(b.id, { start_minute: numberOrZero(e.target.value) })}
                      className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-[11px] font-medium text-slate-600">Length (min)</label>
                    <input
                      type="number"
                      min={PROCESSING_BLOCK_MIN_MINUTES}
                      value={b.duration_minutes}
                      // A block that runs to the end stays there: a longer length
                      // moves its start earlier. One that starts at the end grows
                      // on past it instead.
                      onChange={(e) => updateLength(b.id, e.target.value)}
                      className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
                    />
                  </div>
                  <span className="pb-1.5 text-[11px] text-slate-500">
                    {startsAtEnd
                      ? `After the service, ${b.duration_minutes} min`
                      : runsPastEnd
                        ? `Runs ${b.start_minute + b.duration_minutes - durationMinutes} min past the end of the service`
                        : `${b.start_minute} to ${b.start_minute + b.duration_minutes} min into the service`}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeRow(b.id)}
                    className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-white hover:text-red-700"
                  >
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
