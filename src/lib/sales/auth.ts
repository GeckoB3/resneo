import type { User } from '@supabase/supabase-js';
import type { AuthIdentity } from '@/lib/auth/resolve-auth-identity';
import {
  SALES_AGENT_KEY,
  SALES_AGENT_REGISTERED_KEY,
  SALES_AGENT_VALUE,
} from '@/lib/sales/constants';

function hasRegisteredSalesAgentFlag(appMetadata: Record<string, unknown> | undefined): boolean {
  return appMetadata?.[SALES_AGENT_REGISTERED_KEY] === true;
}

export function hasSalesAgentJwtRole(user: User | null | undefined): boolean {
  if (!user) return false;
  const meta = user.app_metadata ?? {};
  return meta[SALES_AGENT_KEY] === SALES_AGENT_VALUE;
}

export function isSalesAgentFromIdentity(identity: AuthIdentity | null | undefined): boolean {
  if (!identity) return false;
  if (identity.appMetadata[SALES_AGENT_KEY] !== SALES_AGENT_VALUE) return false;
  return hasRegisteredSalesAgentFlag(identity.appMetadata);
}

export function isSalesAgent(user: User | null | undefined): boolean {
  if (!user) return false;
  return isSalesAgentFromIdentity({
    id: user.id,
    email: user.email ?? null,
    appMetadata: (user.app_metadata ?? {}) as Record<string, unknown>,
    userMetadata: (user.user_metadata ?? {}) as Record<string, unknown>,
  });
}

export function isSalesAgentRoleInJwt(
  appMetadata: Record<string, unknown> | undefined,
): boolean {
  if (!appMetadata || appMetadata[SALES_AGENT_KEY] !== SALES_AGENT_VALUE) return false;
  return hasRegisteredSalesAgentFlag(appMetadata);
}
