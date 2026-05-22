'use client';

import { useCallback, useSyncExternalStore } from 'react';
import {
  isDocumentFullscreen,
  isFullscreenApiSupported,
  toggleDocumentFullscreen,
} from '@/lib/ui/fullscreen';

const FULLSCREEN_CHANGE_EVENTS = ['fullscreenchange', 'webkitfullscreenchange'] as const;

function subscribeFullscreen(callback: () => void): () => void {
  for (const eventName of FULLSCREEN_CHANGE_EVENTS) {
    document.addEventListener(eventName, callback);
  }
  return () => {
    for (const eventName of FULLSCREEN_CHANGE_EVENTS) {
      document.removeEventListener(eventName, callback);
    }
  };
}

/**
 * Tracks and toggles browser fullscreen for the dashboard (document element).
 * Listens for vendor-prefixed fullscreen change events where needed.
 */
export function useFullscreen() {
  const supported = useSyncExternalStore(
    () => () => {},
    isFullscreenApiSupported,
    () => false,
  );
  const isFullscreen = useSyncExternalStore(
    subscribeFullscreen,
    isDocumentFullscreen,
    () => false,
  );

  const toggle = useCallback(async () => {
    if (!isFullscreenApiSupported()) return;
    try {
      await toggleDocumentFullscreen();
    } catch (err) {
      console.error('[useFullscreen] Failed to toggle fullscreen', err);
    }
  }, []);

  return { isFullscreen, supported, toggle };
}
