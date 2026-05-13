'use client';

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

interface UseDismissibleLayerOptions {
  open: boolean;
  refs: Array<RefObject<Node | null>>;
  onDismiss: () => void;
  /** When true, dismissed pointer/click handlers no-op (nested floating UI anchored to portal). */
  ignoreDismissIf?: (target: EventTarget | null) => boolean;
}

function eventTargetInsideRefs(target: EventTarget | null, refs: Array<RefObject<Node | null>>): boolean {
  if (!(target instanceof Node)) return false;
  return refs.some((ref) => ref.current?.contains(target));
}

function consumeEvent(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

function installOneShotGestureBlocker(): void {
  let removed = false;

  const cleanup = () => {
    if (removed) return;
    removed = true;
    document.removeEventListener('mousedown', block, true);
    document.removeEventListener('click', block, true);
    window.clearTimeout(timeoutId);
  };

  const block = (event: MouseEvent) => {
    consumeEvent(event);
    cleanup();
  };

  document.addEventListener('mousedown', block, true);
  document.addEventListener('click', block, true);
  const timeoutId = window.setTimeout(cleanup, 750);
}

/**
 * Dismisses a floating layer from outside interaction while consuming the gesture,
 * so the click does not also activate whatever sits underneath the popover.
 */
export function useDismissibleLayer({
  open,
  refs,
  onDismiss,
  ignoreDismissIf,
}: UseDismissibleLayerOptions): void {
  const refsRef = useRef(refs);
  const onDismissRef = useRef(onDismiss);
  const ignoreDismissIfRef = useRef(ignoreDismissIf);

  useLayoutEffect(() => {
    refsRef.current = refs;
    onDismissRef.current = onDismiss;
    ignoreDismissIfRef.current = ignoreDismissIf;
  });

  useEffect(() => {
    if (!open) return;

    const onPointerDownCapture = (event: PointerEvent) => {
      if (ignoreDismissIfRef.current?.(event.target)) return;
      if (eventTargetInsideRefs(event.target, refsRef.current)) return;
      consumeEvent(event);
      installOneShotGestureBlocker();
      onDismissRef.current();
    };

    const onClickCapture = (event: MouseEvent) => {
      if (ignoreDismissIfRef.current?.(event.target)) return;
      if (eventTargetInsideRefs(event.target, refsRef.current)) return;
      consumeEvent(event);
      onDismissRef.current();
    };

    const onKeyDownCapture = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismissRef.current();
    };

    document.addEventListener('pointerdown', onPointerDownCapture, true);
    document.addEventListener('click', onClickCapture, true);
    document.addEventListener('keydown', onKeyDownCapture, true);

    return () => {
      document.removeEventListener('pointerdown', onPointerDownCapture, true);
      document.removeEventListener('click', onClickCapture, true);
      document.removeEventListener('keydown', onKeyDownCapture, true);
    };
  }, [open]);
}
