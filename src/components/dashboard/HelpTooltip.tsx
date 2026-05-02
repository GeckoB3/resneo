'use client';

import { useState, useRef, useCallback, useLayoutEffect, useEffect, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useDismissibleLayer } from '@/lib/ui/use-dismissible-layer';

interface HelpTooltipProps {
  content: string;
  maxWidth?: number;
  icon?: 'i' | '?';
}

interface PanelCoords {
  top: number;
  left: number;
  width: number;
}

function subscribeToNothing() {
  return () => {};
}

export function HelpTooltip({ content, maxWidth = 280, icon = 'i' }: HelpTooltipProps) {
  const [open, setOpen] = useState(false);
  const mounted = useSyncExternalStore(subscribeToNothing, () => true, () => false);
  const [coords, setCoords] = useState<PanelCoords | null>(null);

  const rootRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const computePanelPosition = useCallback(() => {
    const btn = rootRef.current?.querySelector('button');
    const panel = panelRef.current;
    if (!btn || !panel) return;

    const margin = 12;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const btnRect = btn.getBoundingClientRect();

    const panelWidth = Math.min(maxWidth, vw - margin * 2);
    panel.style.width = `${panelWidth}px`;

    const ph = panel.getBoundingClientRect().height;

    let left = btnRect.left + btnRect.width / 2 - panelWidth / 2;
    left = Math.max(margin, Math.min(left, vw - panelWidth - margin));

    let top = btnRect.top - ph - 8;
    if (top < margin) {
      top = btnRect.bottom + 8;
    }
    if (top + ph > vh - margin) {
      top = Math.max(margin, vh - ph - margin);
    }

    setCoords({ top, left, width: panelWidth });
  }, [maxWidth]);

  useLayoutEffect(() => {
    if (!open) return;
    const raf1 = requestAnimationFrame(() => {
      computePanelPosition();
      requestAnimationFrame(() => computePanelPosition());
    });
    return () => cancelAnimationFrame(raf1);
  }, [open, content, maxWidth, computePanelPosition]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => computePanelPosition();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [open, computePanelPosition]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  useDismissibleLayer({
    open,
    refs: [rootRef, panelRef],
    onDismiss: () => setOpen(false),
  });

  const fallbackWidth =
    typeof window !== 'undefined' ? Math.min(maxWidth, window.innerWidth - 24) : maxWidth;

  const panel =
    open &&
    mounted &&
    createPortal(
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Help"
        className="z-[1001] box-border rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs leading-relaxed text-slate-600 shadow-lg"
        style={{
          position: 'fixed',
          top: coords?.top ?? -9999,
          left: coords?.left ?? 0,
          width: coords?.width ?? fallbackWidth,
          visibility: coords ? 'visible' : 'hidden',
          pointerEvents: coords ? 'auto' : 'none',
        }}
      >
        {content}
      </div>,
      document.body,
    );

  return (
    <span
      ref={rootRef}
      className="relative inline-flex align-middle"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-[44px] min-w-[44px] shrink-0 touch-manipulation items-center justify-center rounded-full border-0 bg-transparent p-0 text-slate-500"
        aria-expanded={open}
        aria-label="Help"
      >
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-500 transition-colors hover:bg-brand-100 hover:text-brand-600">
          {icon}
        </span>
      </button>
      {panel}
    </span>
  );
}
