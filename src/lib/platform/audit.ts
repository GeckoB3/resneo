import type { SupabaseClient, User } from '@supabase/supabase-js';

export interface PlatformAuditInput {
  superuser: Pick<User, 'id' | 'email'>;
  /** Machine-readable action key, e.g. `venue.mark_test`, `salesperson.create`. */
  action: string;
  targetType?: string;
  targetId?: string;
  /** Human-readable one-liner shown in the audit log UI. */
  summary: string;
  metadata?: Record<string, unknown>;
}

/**
 * Append a platform audit event (superuser actions outside venue support sessions).
 * Never throws — audit logging must not break the action being audited.
 */
export async function recordPlatformAuditEvent(
  admin: SupabaseClient,
  input: PlatformAuditInput,
): Promise<void> {
  try {
    const { error } = await admin.from('platform_audit_events').insert({
      superuser_id: input.superuser.id,
      superuser_email: input.superuser.email ?? 'unknown',
      action: input.action,
      target_type: input.targetType ?? null,
      target_id: input.targetId ?? null,
      summary: input.summary,
      metadata: input.metadata ?? {},
    });
    if (error) {
      console.error('[platform-audit] insert failed:', error.message, { action: input.action });
    }
  } catch (e) {
    console.error('[platform-audit] unexpected failure:', e, { action: input.action });
  }
}
