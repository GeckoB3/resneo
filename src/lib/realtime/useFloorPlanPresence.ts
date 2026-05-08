'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/browser';

interface FloorPlanPresenceState {
  /** Other staff keys currently tracked on the channel (best-effort). */
  peerKeys: string[];
  channelStatus: 'idle' | 'connecting' | 'subscribed' | 'error';
}

/**
 * Lightweight Supabase Realtime presence for the live floor channel.
 * Requires an authenticated browser session; fails closed if subscribe errors.
 */
export function useFloorPlanPresence(opts: {
  venueId: string;
  date: string;
  areaId: string | null;
  enabled: boolean;
}): FloorPlanPresenceState {
  const [peerKeys, setPeerKeys] = useState<string[]>([]);
  const [channelStatus, setChannelStatus] = useState<FloorPlanPresenceState['channelStatus']>('idle');

  useEffect(() => {
    if (!opts.enabled || !opts.venueId) return;

    const supabase = createClient();
    const topic = `floor_plan:${opts.venueId}:${opts.date}:${opts.areaId ?? 'all'}`;
    const channel = supabase.channel(topic, {
      config: {
        presence: { key: `${opts.venueId}:${Math.random().toString(36).slice(2, 8)}` },
      },
    });

    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState() as Record<string, { presence_ref?: string }[]>;
      const keys = Object.keys(state);
      setPeerKeys(keys);
    });

    let cancelled = false;
    void channel.subscribe(async (status) => {
      if (cancelled) return;
      if (status === 'SUBSCRIBED') {
        setChannelStatus('subscribed');
        try {
          await channel.track({ at: new Date().toISOString(), surface: 'floor_plan' });
        } catch (e) {
          console.error('[useFloorPlanPresence] track failed:', e);
        }
        return;
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        setChannelStatus('error');
        return;
      }
      setChannelStatus('connecting');
    });

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
      setPeerKeys([]);
      setChannelStatus('idle');
    };
  }, [opts.venueId, opts.date, opts.areaId, opts.enabled]);

  return { peerKeys, channelStatus };
}
