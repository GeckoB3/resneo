'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Freehand signature capture on a plain HTML5 canvas (SSR-safe; no extra deps).
 * Emits a PNG data URL on change, or null when cleared. The submit endpoint
 * uploads the PNG to the compliance-files bucket and stores the path (§4.4.1).
 */
export function SignaturePad({
  value,
  onChange,
  disabled,
  height = 200,
}: {
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  disabled?: boolean;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [hasInk, setHasInk] = useState(Boolean(value));
  // Read the latest value during a re-measure without re-running the effect on every stroke.
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  // Size the canvas backing store to its rendered size for crisp lines, and RE-measure
  // whenever that size changes (orientation change, opening inside an animating dialog).
  // Sizing only once on mount left the backing store mismatched after any later resize,
  // so strokes landed offset on mobile. On each re-measure we redraw the saved signature.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function setup() {
      const c = canvasRef.current;
      if (!c) return;
      const ratio = window.devicePixelRatio || 1;
      const rect = c.getBoundingClientRect();
      c.width = Math.max(1, Math.floor(rect.width * ratio));
      c.height = Math.max(1, Math.floor(height * ratio));
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#0f172a';
      // Resizing the backing store clears it; redraw any existing signature to fit.
      const saved = valueRef.current;
      if (saved) {
        const img = new Image();
        img.onload = () => {
          const cc = canvasRef.current?.getContext('2d');
          if (cc) cc.drawImage(img, 0, 0, rect.width, height);
        };
        img.src = saved;
      }
    }

    setup();
    if (typeof ResizeObserver === 'undefined') return;
    // Re-measuring clears the canvas; skip it mid-stroke so a resize (e.g. a mobile URL bar
    // collapsing) doesn't wipe the line the user is currently drawing (review #4).
    const observer = new ResizeObserver(() => {
      if (!drawing.current) setup();
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [height]);

  function pointFromEvent(e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = pointFromEvent(e);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || disabled) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !last.current) return;
    const p = pointFromEvent(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (!hasInk) setHasInk(true);
  }

  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    const canvas = canvasRef.current;
    if (canvas && hasInk) onChange(canvas.toDataURL('image/png'));
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
    onChange(null);
  }

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Signature pad: draw your signature here"
        style={{ height, touchAction: 'none' }}
        className={`w-full rounded-lg border border-slate-300 bg-white ${disabled ? 'opacity-60' : 'cursor-crosshair'}`}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
      {!disabled && (
        <button
          type="button"
          onClick={clear}
          className="inline-flex min-h-9 items-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
        >
          Clear signature
        </button>
      )}
    </div>
  );
}
