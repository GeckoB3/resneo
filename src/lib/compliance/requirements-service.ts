import type { SupabaseClient } from '@supabase/supabase-js';
import { venueUsesUnifiedAppointmentServiceData } from '@/lib/booking/uses-unified-appointment-data';
import { writeComplianceAuditEvent } from '@/lib/compliance/audit';
import type { ComplianceEnforcement, ComplianceOnlineCollection } from '@/lib/compliance/constants';
import type { ServiceResult } from '@/lib/compliance/types-service';

/**
 * Service layer for `service_compliance_requirements`. Carries the polymorphic
 * service-FK logic (spec §4.5): the column to write/filter is decided by
 * `venueUsesUnifiedAppointmentServiceData` — `service_item_id` for unified
 * scheduling, `appointment_service_id` for legacy practitioner appointments.
 */

export type ServiceFkColumn = 'appointment_service_id' | 'service_item_id';

export async function resolveServiceFkColumn(
  admin: SupabaseClient,
  venueId: string,
): Promise<ServiceFkColumn> {
  const unified = await venueUsesUnifiedAppointmentServiceData(admin, venueId);
  return unified ? 'service_item_id' : 'appointment_service_id';
}

/** Confirm a service row exists in the right table for this venue. */
async function serviceBelongsToVenue(
  admin: SupabaseClient,
  venueId: string,
  column: ServiceFkColumn,
  serviceId: string,
): Promise<boolean> {
  const table = column === 'service_item_id' ? 'service_items' : 'appointment_services';
  const { data } = await admin
    .from(table)
    .select('id')
    .eq('id', serviceId)
    .eq('venue_id', venueId)
    .maybeSingle();
  return Boolean(data);
}

export interface RequirementRow {
  id: string;
  compliance_type_id: string;
  enforcement: ComplianceEnforcement;
  lock_period_hours: number | null;
  online_collection: ComplianceOnlineCollection;
  appointment_service_id: string | null;
  service_item_id: string | null;
  compliance_type_name: string;
  compliance_type_category: string;
  compliance_type_is_active: boolean;
}

function mapRequirementRow(row: Record<string, unknown>): RequirementRow {
  const typeJoin = row.compliance_types as
    | { name?: string; category?: string; is_active?: boolean }
    | { name?: string; category?: string; is_active?: boolean }[]
    | null;
  const t = Array.isArray(typeJoin) ? typeJoin[0] : typeJoin;
  return {
    id: row.id as string,
    compliance_type_id: row.compliance_type_id as string,
    enforcement: row.enforcement as ComplianceEnforcement,
    lock_period_hours: (row.lock_period_hours as number | null) ?? null,
    online_collection: (row.online_collection as ComplianceOnlineCollection | null) ?? 'confirmation_link',
    appointment_service_id: (row.appointment_service_id as string | null) ?? null,
    service_item_id: (row.service_item_id as string | null) ?? null,
    compliance_type_name: t?.name ?? 'Compliance record',
    compliance_type_category: t?.category ?? 'test',
    compliance_type_is_active: t?.is_active ?? true,
  };
}

/** List requirements for one service (resolving the polymorphic column by venue). */
export async function listRequirementsForService(
  admin: SupabaseClient,
  venueId: string,
  serviceId: string,
): Promise<RequirementRow[]> {
  const column = await resolveServiceFkColumn(admin, venueId);
  const { data, error } = await admin
    .from('service_compliance_requirements')
    .select(
      'id, compliance_type_id, enforcement, lock_period_hours, online_collection, appointment_service_id, service_item_id, compliance_types!inner(name, category, is_active)',
    )
    .eq('venue_id', venueId)
    .eq(column, serviceId);
  if (error) {
    console.error('[listRequirementsForService] failed:', error.message);
    return [];
  }
  return (data ?? []).map((r) => mapRequirementRow(r as Record<string, unknown>));
}

export async function addRequirement(
  admin: SupabaseClient,
  params: {
    venueId: string;
    staffId: string;
    serviceId: string;
    complianceTypeId: string;
    enforcement: ComplianceEnforcement;
    lockPeriodHours: number | null;
    onlineCollection?: ComplianceOnlineCollection;
  },
): Promise<ServiceResult<RequirementRow>> {
  const column = await resolveServiceFkColumn(admin, params.venueId);

  if (!(await serviceBelongsToVenue(admin, params.venueId, column, params.serviceId))) {
    return { ok: false, error: 'Service not found for this venue.', status: 404 };
  }

  const { data: typeRow } = await admin
    .from('compliance_types')
    .select('id, is_active')
    .eq('id', params.complianceTypeId)
    .eq('venue_id', params.venueId)
    .maybeSingle();
  if (!typeRow) return { ok: false, error: 'Compliance type not found.', status: 404 };
  if ((typeRow as { is_active?: boolean }).is_active === false) {
    return { ok: false, error: 'Cannot add a requirement for an archived type.', status: 400 };
  }

  const { data: inserted, error } = await admin
    .from('service_compliance_requirements')
    .insert({
      venue_id: params.venueId,
      [column]: params.serviceId,
      compliance_type_id: params.complianceTypeId,
      enforcement: params.enforcement,
      lock_period_hours: params.lockPeriodHours,
      ...(params.onlineCollection !== undefined ? { online_collection: params.onlineCollection } : {}),
    })
    .select(
      'id, compliance_type_id, enforcement, lock_period_hours, online_collection, appointment_service_id, service_item_id, compliance_types!inner(name, category, is_active)',
    )
    .single();

  if (error) {
    if (error.code === '23505') {
      return { ok: false, error: 'This service already requires that compliance type.', status: 409 };
    }
    console.error('[addRequirement] insert failed:', error.message);
    return { ok: false, error: 'Failed to add requirement.', status: 500 };
  }

  await writeComplianceAuditEvent(admin, {
    venueId: params.venueId,
    eventType: 'requirement.added',
    actorType: 'staff',
    actorStaffId: params.staffId,
    complianceTypeId: params.complianceTypeId,
    metadata: { service_id: params.serviceId, enforcement: params.enforcement },
  });

  return { ok: true, value: mapRequirementRow(inserted as Record<string, unknown>) };
}

export async function updateRequirement(
  admin: SupabaseClient,
  params: {
    venueId: string;
    staffId: string;
    requirementId: string;
    enforcement?: ComplianceEnforcement;
    lockPeriodHours?: number | null;
    onlineCollection?: ComplianceOnlineCollection;
  },
): Promise<ServiceResult<RequirementRow>> {
  const { data: existing } = await admin
    .from('service_compliance_requirements')
    .select('id, compliance_type_id')
    .eq('id', params.requirementId)
    .eq('venue_id', params.venueId)
    .maybeSingle();
  if (!existing) return { ok: false, error: 'Requirement not found.', status: 404 };

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (params.enforcement !== undefined) update.enforcement = params.enforcement;
  if (params.lockPeriodHours !== undefined) update.lock_period_hours = params.lockPeriodHours;
  if (params.onlineCollection !== undefined) update.online_collection = params.onlineCollection;

  const { data: updated, error } = await admin
    .from('service_compliance_requirements')
    .update(update)
    .eq('id', params.requirementId)
    .eq('venue_id', params.venueId)
    .select(
      'id, compliance_type_id, enforcement, lock_period_hours, online_collection, appointment_service_id, service_item_id, compliance_types!inner(name, category, is_active)',
    )
    .single();
  if (error) {
    console.error('[updateRequirement] failed:', error.message);
    return { ok: false, error: 'Failed to update requirement.', status: 500 };
  }

  await writeComplianceAuditEvent(admin, {
    venueId: params.venueId,
    eventType: 'requirement.updated',
    actorType: 'staff',
    actorStaffId: params.staffId,
    complianceTypeId: (existing as { compliance_type_id: string }).compliance_type_id,
    metadata: { requirement_id: params.requirementId },
  });

  return { ok: true, value: mapRequirementRow(updated as Record<string, unknown>) };
}

export async function removeRequirement(
  admin: SupabaseClient,
  params: { venueId: string; staffId: string; requirementId: string },
): Promise<ServiceResult<{ id: string }>> {
  const { data: existing } = await admin
    .from('service_compliance_requirements')
    .select('id, compliance_type_id')
    .eq('id', params.requirementId)
    .eq('venue_id', params.venueId)
    .maybeSingle();
  if (!existing) return { ok: false, error: 'Requirement not found.', status: 404 };

  const { error } = await admin
    .from('service_compliance_requirements')
    .delete()
    .eq('id', params.requirementId)
    .eq('venue_id', params.venueId);
  if (error) {
    console.error('[removeRequirement] failed:', error.message);
    return { ok: false, error: 'Failed to remove requirement.', status: 500 };
  }

  await writeComplianceAuditEvent(admin, {
    venueId: params.venueId,
    eventType: 'requirement.removed',
    actorType: 'staff',
    actorStaffId: params.staffId,
    complianceTypeId: (existing as { compliance_type_id: string }).compliance_type_id,
    metadata: { requirement_id: params.requirementId },
  });

  return { ok: true, value: { id: params.requirementId } };
}
