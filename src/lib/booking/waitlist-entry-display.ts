import type { SupabaseClient } from '@supabase/supabase-js';

export interface WaitlistEntryDisplayFields {
  service_name: string | null;
  practitioner_name: string | null;
}

type WaitlistRowForDisplay = {
  id: string;
  service_item_id?: string | null;
  appointment_service_id?: string | null;
  practitioner_id?: string | null;
};

/**
 * Resolves human-readable service and practitioner labels for dashboard waitlist rows.
 */
export async function enrichWaitlistEntriesForDisplay(
  admin: SupabaseClient,
  entries: WaitlistRowForDisplay[],
): Promise<Map<string, WaitlistEntryDisplayFields>> {
  const out = new Map<string, WaitlistEntryDisplayFields>();
  if (entries.length === 0) return out;

  const serviceItemIds = new Set<string>();
  const appointmentServiceIds = new Set<string>();
  const practitionerIds = new Set<string>();

  for (const row of entries) {
    if (row.service_item_id) serviceItemIds.add(row.service_item_id);
    if (row.appointment_service_id) appointmentServiceIds.add(row.appointment_service_id);
    if (row.practitioner_id) practitionerIds.add(row.practitioner_id);
  }

  const serviceNames = new Map<string, string>();
  if (serviceItemIds.size > 0) {
    const { data } = await admin
      .from('service_items')
      .select('id, name')
      .in('id', [...serviceItemIds]);
    for (const row of data ?? []) {
      if (row.name) serviceNames.set(row.id as string, String(row.name));
    }
  }
  if (appointmentServiceIds.size > 0) {
    const { data } = await admin
      .from('appointment_services')
      .select('id, name')
      .in('id', [...appointmentServiceIds]);
    for (const row of data ?? []) {
      if (row.name) serviceNames.set(row.id as string, String(row.name));
    }
  }

  const practitionerNames = new Map<string, string>();
  if (practitionerIds.size > 0) {
    const ids = [...practitionerIds];
    const { data: calendars } = await admin.from('unified_calendars').select('id, name').in('id', ids);
    for (const row of calendars ?? []) {
      if (row.name) practitionerNames.set(row.id as string, String(row.name));
    }
    const missing = ids.filter((id) => !practitionerNames.has(id));
    if (missing.length > 0) {
      const { data: practitioners } = await admin.from('practitioners').select('id, name').in('id', missing);
      for (const row of practitioners ?? []) {
        if (row.name) practitionerNames.set(row.id as string, String(row.name));
      }
    }
  }

  for (const row of entries) {
    const serviceId = row.service_item_id ?? row.appointment_service_id;
    out.set(row.id, {
      service_name: serviceId ? (serviceNames.get(serviceId) ?? null) : null,
      practitioner_name: row.practitioner_id
        ? (practitionerNames.get(row.practitioner_id) ?? null)
        : null,
    });
  }

  return out;
}
