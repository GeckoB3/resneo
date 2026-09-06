'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * Open state for Ask ResNeo, shared by the sidebar launcher, the Support page card and the
 * drawer itself (Docs/help-assistant-plan.md, 3.3). `enabled` comes from the server layout
 * (`assistantEnabledFor(venueId)`), so a switched-off assistant renders nothing anywhere.
 */
export interface AssistantContextValue {
  enabled: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
}

const AssistantContext = createContext<AssistantContextValue>({
  enabled: false,
  open: false,
  setOpen: () => {},
});

export function AssistantProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [open, setOpenState] = useState(false);
  const setOpen = useCallback((next: boolean) => setOpenState(next), []);
  const value = useMemo<AssistantContextValue>(() => ({ enabled, open: enabled && open, setOpen }), [enabled, open, setOpen]);
  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

export function useAssistant(): AssistantContextValue {
  return useContext(AssistantContext);
}
