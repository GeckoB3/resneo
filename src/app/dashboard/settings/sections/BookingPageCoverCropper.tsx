'use client';

import { useCallback, useRef, useState } from 'react';
import { Dialog } from '@/components/ui/primitives/Dialog';
import {
  sanitizeBookingPageCoverCropBox,
  type BookingPageCoverCropBox,
} from '@/lib/booking/booking-page-cover';

interface BookingPageCoverCropperProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  coverUrl: string;
  /** Existing crop to start from; null starts from the whole photo. */
  initialCrop: BookingPageCoverCropBox | null;
  onApply: (box: BookingPageCoverCropBox | null) => void;
}

/** Normalised crop edges (fractions of the image): left/top/right/bottom in 0–1. */
interface Edges {
  l: number;
  t: number;
  r: number;
  b: number;
}

type DragMode = 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const MIN = 0.05;
const FULL: Edges = { l: 0, t: 0, r: 1, b: 1 };

function clampRange(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function edgesFromCrop(crop: BookingPageCoverCropBox | null): Edges {
  if (!crop) return FULL;
  return { l: crop.x, t: crop.y, r: Math.min(1, crop.x + crop.w), b: Math.min(1, crop.y + crop.h) };
}

const HANDLES: ReadonlyArray<{ mode: DragMode; style: React.CSSProperties; cursor: string }> = [
  { mode: 'nw', style: { left: 0, top: 0 }, cursor: 'nwse-resize' },
  { mode: 'n', style: { left: '50%', top: 0 }, cursor: 'ns-resize' },
  { mode: 'ne', style: { left: '100%', top: 0 }, cursor: 'nesw-resize' },
  { mode: 'e', style: { left: '100%', top: '50%' }, cursor: 'ew-resize' },
  { mode: 'se', style: { left: '100%', top: '100%' }, cursor: 'nwse-resize' },
  { mode: 's', style: { left: '50%', top: '100%' }, cursor: 'ns-resize' },
  { mode: 'sw', style: { left: 0, top: '100%' }, cursor: 'nesw-resize' },
  { mode: 'w', style: { left: 0, top: '50%' }, cursor: 'ew-resize' },
];

/** Modal free-form cropper: drag the box to move, drag a handle to resize. Any shape. */
export function BookingPageCoverCropper({
  open,
  onOpenChange,
  coverUrl,
  initialCrop,
  onApply,
}: BookingPageCoverCropperProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<Edges>(() => edgesFromCrop(initialCrop));
  const [imgAspect, setImgAspect] = useState<number | null>(initialCrop?.ar ?? null);
  const dragRef = useRef<{ mode: DragMode; startX: number; startY: number; start: Edges } | null>(null);
  const [dragging, setDragging] = useState(false);

  // The component is mounted fresh each time the dialog opens, so state seeds from props here.

  const onImgLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      setImgAspect(img.naturalWidth / img.naturalHeight);
    }
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const handle = (e.target as HTMLElement).dataset.cropHandle as DragMode | undefined;
      const isBody = (e.target as HTMLElement).dataset.cropBody === '';
      const mode = handle ?? (isBody ? 'move' : null);
      if (!mode) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = { mode, startX: e.clientX, startY: e.clientY, start: edges };
      setDragging(true);
    },
    [edges],
  );

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!drag || !rect || rect.width === 0 || rect.height === 0) return;
    const ddx = (e.clientX - drag.startX) / rect.width;
    const ddy = (e.clientY - drag.startY) / rect.height;
    const { l, t, r, b } = drag.start;

    if (drag.mode === 'move') {
      let nl = l + ddx;
      let nr = r + ddx;
      let nt = t + ddy;
      let nb = b + ddy;
      if (nl < 0) {
        nr -= nl;
        nl = 0;
      }
      if (nr > 1) {
        nl -= nr - 1;
        nr = 1;
      }
      if (nt < 0) {
        nb -= nt;
        nt = 0;
      }
      if (nb > 1) {
        nt -= nb - 1;
        nb = 1;
      }
      setEdges({ l: nl, t: nt, r: nr, b: nb });
      return;
    }

    const m = drag.mode;
    const next: Edges = { l, t, r, b };
    if (m.includes('w')) next.l = clampRange(l + ddx, 0, r - MIN);
    if (m.includes('e')) next.r = clampRange(r + ddx, l + MIN, 1);
    if (m.includes('n')) next.t = clampRange(t + ddy, 0, b - MIN);
    if (m.includes('s')) next.b = clampRange(b + ddy, t + MIN, 1);
    setEdges(next);
  }, []);

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // capture may already be released
    }
  }, []);

  const apply = useCallback(() => {
    if (!imgAspect) return;
    const box = sanitizeBookingPageCoverCropBox({
      x: edges.l,
      y: edges.t,
      w: edges.r - edges.l,
      h: edges.b - edges.t,
      ar: imgAspect,
    });
    onApply(box);
    onOpenChange(false);
  }, [edges, imgAspect, onApply, onOpenChange]);

  const rectStyle: React.CSSProperties = {
    left: `${edges.l * 100}%`,
    top: `${edges.t * 100}%`,
    width: `${(edges.r - edges.l) * 100}%`,
    height: `${(edges.b - edges.t) * 100}%`,
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Crop cover photo"
      description="Drag the box to move it, or drag a corner or edge to resize. The booking page shows exactly this area."
      size="lg"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setEdges(FULL)}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50"
          >
            Reset to full photo
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={apply}
              disabled={!imgAspect}
              className="inline-flex items-center gap-2 rounded-xl border border-brand-600 bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:pointer-events-none disabled:opacity-50"
            >
              Apply crop
            </button>
          </div>
        </div>
      }
    >
      <div className="mx-auto w-full max-w-xl">
        <div
          ref={stageRef}
          role="presentation"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="relative select-none overflow-hidden rounded-xl bg-slate-100 touch-none"
        >
          <img
            src={coverUrl}
            alt="Cover to crop"
            onLoad={onImgLoad}
            className="pointer-events-none block h-auto w-full select-none"
            draggable={false}
          />
          <div
            data-crop-body=""
            style={rectStyle}
            className={`absolute border-2 border-white shadow-[0_0_0_9999px_rgba(15,23,42,0.55)] ${
              dragging ? 'cursor-grabbing' : 'cursor-grab'
            }`}
          >
            <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="border border-white/30" />
              ))}
            </div>
            {HANDLES.map((h) => (
              <span
                key={h.mode}
                data-crop-handle={h.mode}
                style={{ ...h.style, cursor: h.cursor }}
                className="absolute -ml-2 -mt-2 h-4 w-4 rounded-full border-2 border-brand-600 bg-white shadow-sm"
              />
            ))}
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Tip: the area inside the box is exactly what appears on your booking page. Drag a corner
          to change its shape — there are no fixed dimensions.
        </p>
      </div>
    </Dialog>
  );
}
