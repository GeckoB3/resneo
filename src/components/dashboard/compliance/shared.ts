import type { PillVariant } from '@/components/ui/dashboard/Pill';
import type { ComplianceRequirementState } from '@/lib/compliance/constants';

/** Shared JSON fetcher for SWR; throws on non-2xx so SWR surfaces the error. */
export async function complianceJsonFetcher<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? 'Request failed');
  }
  return res.json() as Promise<T>;
}

export const ENFORCEMENT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'warn_staff', label: 'Warn staff' },
  { value: 'warn_client', label: 'Warn client' },
  { value: 'block_online', label: 'Block online booking' },
  { value: 'block_all', label: 'Block all bookings' },
];

export const ENFORCEMENT_LABELS: Record<string, string> = Object.fromEntries(
  ENFORCEMENT_OPTIONS.map((o) => [o.value, o.label]),
);

export const CATEGORY_LABELS: Record<string, string> = {
  test: 'Test',
  consent: 'Consent',
  intake: 'Intake',
  declaration: 'Declaration',
  certificate: 'Certificate',
};

export const RESULT_TYPE_LABELS: Record<string, string> = {
  pass_fail: 'Pass / fail',
  signed: 'Signed',
  completed: 'Completed',
  file_uploaded: 'File upload',
};

/** Human label for a validity period (days): null = lifetime, 0 = per visit. */
export function validityLabel(days: number | null | undefined): string {
  if (days == null) return 'No expiry';
  if (days === 0) return 'Per visit';
  if (days % 365 === 0) return `${days / 365} year${days / 365 > 1 ? 's' : ''}`;
  return `${days} days`;
}

/** Map a resolved requirement state to a Pill variant + label (spec §3.1 / §11.4). */
export function requirementStatePill(state: ComplianceRequirementState): {
  variant: PillVariant;
  label: string;
} {
  switch (state) {
    case 'satisfied':
      return { variant: 'compliance-current', label: 'Current' };
    case 'expiring_soon':
      return { variant: 'compliance-expiring', label: 'Expiring soon' };
    case 'expired':
      return { variant: 'compliance-expired', label: 'Expired' };
    case 'missing':
      return { variant: 'compliance-missing', label: 'Missing' };
    case 'not_applicable':
    default:
      return { variant: 'neutral', label: 'Not applicable' };
  }
}

export interface ComplianceTypeSummary {
  id: string;
  name: string;
  category: string;
  result_type: string;
  validity_period_days: number | null;
  is_active: boolean;
  current_version_number?: number | null;
  service_requirement_count?: number;
  record_count?: number;
}

export interface RequirementRowData {
  id: string;
  compliance_type_id: string;
  enforcement: string;
  lock_period_hours: number | null;
  compliance_type_name: string;
  compliance_type_category: string;
  compliance_type_is_active: boolean;
}

/** A `name`/`category` join that Supabase may return as object or single-element array. */
type JoinedType = { name?: string; category?: string } | { name?: string; category?: string }[] | null | undefined;

export function joinedTypeName(join: JoinedType): string {
  const t = Array.isArray(join) ? join[0] : join;
  return t?.name ?? 'Compliance record';
}

export function joinedTypeCategory(join: JoinedType): string {
  const t = Array.isArray(join) ? join[0] : join;
  return t?.category ?? 'test';
}

export interface ComplianceRecordRow {
  id: string;
  compliance_type_id: string;
  status: 'completed' | 'expired' | 'voided';
  result: string | null;
  captured_at: string;
  expires_at: string | null;
  voided_at: string | null;
  notes?: string | null;
  capture_channel: string;
  captured_by_staff_id: string | null;
  compliance_types?: JoinedType;
}

export interface ResolvedRequirementData {
  requirement: {
    id: string;
    compliance_type_id: string;
    compliance_type_name: string;
    enforcement: string;
    lock_period_hours: number | null;
    type_is_active: boolean;
  };
  state: ComplianceRequirementState;
  lock_blocked: boolean;
  matching_record: ComplianceRecordRef | null;
  latest_record: ComplianceRecordRef | null;
}

export interface ComplianceRecordRef {
  id: string;
  status: string;
  result: string | null;
  captured_at: string;
  expires_at: string | null;
  captured_by_staff_id: string | null;
}

export interface FormLinkRow {
  id: string;
  code: string;
  compliance_type_id: string;
  status: string;
  sent_via: string | null;
  sent_at: string | null;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
  compliance_types?: JoinedType;
}

export interface AuditEventRow {
  id: string;
  event_type: string;
  actor_type: string;
  actor_staff_id: string | null;
  compliance_type_id: string | null;
  compliance_record_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

/** Pill for a record's own status (current/expired/voided). */
export function recordStatusPill(record: { status: string; expires_at: string | null; voided_at: string | null }): {
  variant: PillVariant;
  label: string;
} {
  if (record.voided_at || record.status === 'voided') return { variant: 'compliance-voided', label: 'Voided' };
  if (record.status === 'expired') return { variant: 'compliance-expired', label: 'Expired' };
  if (record.expires_at && new Date(record.expires_at).getTime() <= Date.now()) {
    return { variant: 'compliance-expired', label: 'Expired' };
  }
  return { variant: 'compliance-current', label: 'Current' };
}

export function formatComplianceDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  // Bare calendar date (e.g. a form date field or booking_date) — format the parts
  // directly so DD/MM/YYYY is exact and never shifts a day across a timezone boundary.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const AUDIT_EVENT_LABELS: Record<string, string> = {
  'type.created': 'Type created',
  'type.updated': 'Type updated',
  'type.archived': 'Type archived',
  'type.restored': 'Type restored',
  'version.created': 'New form version',
  'requirement.added': 'Requirement added',
  'requirement.removed': 'Requirement removed',
  'requirement.updated': 'Requirement updated',
  'record.captured': 'Record captured',
  'record.updated': 'Record updated',
  'record.voided': 'Record voided',
  'record.viewed': 'Record viewed',
  'link.issued': 'Form link issued',
  'link.sent': 'Form link sent',
  'link.consumed': 'Form submitted',
  'link.expired': 'Form link expired',
  'link.revoked': 'Form link revoked',
};

export function auditEventLabel(eventType: string): string {
  return AUDIT_EVENT_LABELS[eventType] ?? eventType;
}
