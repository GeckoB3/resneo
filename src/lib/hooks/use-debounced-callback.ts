'use client';

import { useEffect, useMemo, useRef } from 'react';

/**
 * Returns a stable debounced wrapper around `callback`. The latest callback is always used
 * when the debounced function fires. Cancel pending invocations on unmount.
 */
export function useDebouncedCallback<T extends (...args: never[]) => void>(
  callback: T,
  delayMs: number,
): T {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debounced = useMemo(() => {
    const fn = (...args: Parameters<T>) => {
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        callbackRef.current(...args);
      }, delayMs);
    };
    (fn as T & { cancel: () => void }).cancel = () => {
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    };
    return fn as T & { cancel: () => void };
  }, [delayMs]);

  useEffect(() => () => debounced.cancel(), [debounced]);

  return debounced as T;
}
