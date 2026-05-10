import { useCallback, useEffect, useRef } from 'react';

/**
 * Returns a stable callback that invokes `callback` after `delayMs` of inactivity.
 * Each call resets the timer. Cleanup clears pending runs on unmount.
 */
export function useDebouncedCallback<A extends unknown[]>(
  callback: (...args: A) => void | Promise<void>,
  delayMs: number,
): (...args: A) => void {
  const cbRef = useRef(callback);

  useEffect(() => {
    cbRef.current = callback;
  }, [callback]);

  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  return useCallback(
    (...args: A) => {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        void cbRef.current(...args);
      }, delayMs);
    },
    [delayMs],
  );
}
