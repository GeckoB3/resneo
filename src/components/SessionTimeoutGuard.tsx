'use client';

import { useEffect, useRef, useCallback } from 'react';
import { signOutCleanly } from '@/lib/auth/sign-out-cleanly';

interface Props {
  venueId: string;
}

export function SessionTimeoutGuard({ venueId }: Props) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutMinutesRef = useRef<number | null>(null);

  const signOut = useCallback(async () => {
    // Idle timeout exists for unattended/shared devices — exactly where a full
    // cache + storage teardown matters most.
    await signOutCleanly('/login?reason=session_expired');
  }, []);

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const minutes = timeoutMinutesRef.current;
    if (minutes && minutes > 0) {
      timerRef.current = setTimeout(() => {
        signOut();
      }, minutes * 60 * 1000);
    }
  }, [signOut]);

  useEffect(() => {
    let cancelled = false;

    async function fetchTimeout() {
      try {
        const res = await fetch('/api/venue/staff/session-settings');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const minutes = data.session_timeout_minutes;
        if (typeof minutes === 'number' && minutes > 0) {
          timeoutMinutesRef.current = minutes;
          resetTimer();
        }
      } catch { /* ignore */ }
    }

    fetchTimeout();

    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'] as const;
    const handler = () => resetTimer();
    events.forEach((e) => window.addEventListener(e, handler, { passive: true }));

    return () => {
      cancelled = true;
      events.forEach((e) => window.removeEventListener(e, handler));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [venueId, resetTimer]);

  return null;
}
