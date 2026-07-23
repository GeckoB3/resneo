import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Minimal row shape for resolving a guest-facing item name (service, class, event, resource, dining service).
 */
export interface BookingListRowForLabel {
  id: string;
  booking_model?: string | null;
  experience_event_id?: string | null;
  class_instance_id?: string | null;
  resource_id?: string | null;
  event_session_id?: string | null;
  calendar_id?: string | null;
  service_item_id?: string | null;
  practitioner_id?: string | null;
  appointment_service_id?: string | null;
  service_id?: string | null;
}

type Db = Pick<SupabaseClient, 'from'>;

/** Resolution order matches FK branch of {@link inferBookingRowModel}, with extra fallbacks for sparse rows. */
function labelFromForeignKeys(
  row: BookingListRowForLabel,
  maps: {
    experienceEvent: Map<string, string>;
    classInstance: Map<string, string>;
    resource: Map<string, string>;
    eventSession: Map<string, string>;
    serviceItem: Map<string, string>;
    appointmentService: Map<string, string>;
    venueService: Map<string, string>;
  },
): string | null {
  if (row.experience_event_id) return maps.experienceEvent.get(row.experience_event_id) ?? null;
  if (row.class_instance_id) return maps.classInstance.get(row.class_instance_id) ?? null;
  if (row.resource_id) return maps.resource.get(row.resource_id) ?? null;
  if (row.event_session_id) return maps.eventSession.get(row.event_session_id) ?? null;
  if (row.calendar_id && row.service_item_id) return maps.serviceItem.get(row.service_item_id) ?? null;
  if (row.practitioner_id && row.appointment_service_id) {
    return maps.appointmentService.get(row.appointment_service_id) ?? null;
  }
  if (row.service_item_id) return maps.serviceItem.get(row.service_item_id) ?? null;
  if (row.appointment_service_id) return maps.appointmentService.get(row.appointment_service_id) ?? null;
  if (row.service_id) return maps.venueService.get(row.service_id) ?? null;
  return null;
}

async function loadServiceItemNames(db: Db, ids: Set<string>): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.size === 0) return map;
  const { data } = await db.from('service_items').select('id, name').in('id', [...ids]);
  for (const row of data ?? []) {
    const id = (row as { id: string }).id;
    const name = (row as { name?: string }).name?.trim();
    if (name) map.set(id, name);
  }
  return map;
}

/**
 * Batch-load display names for booking list rows (dashboard booking bar).
 */
export async function resolveBookingListRowLabels(db: Db, rows: BookingListRowForLabel[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (rows.length === 0) return out;

  const evIds = new Set<string>();
  const ciIds = new Set<string>();
  const rIds = new Set<string>();
  const esIds = new Set<string>();
  const siIds = new Set<string>();
  const asIds = new Set<string>();
  const vsIds = new Set<string>();

  for (const r of rows) {
    if (r.experience_event_id) evIds.add(r.experience_event_id);
    if (r.class_instance_id) ciIds.add(r.class_instance_id);
    if (r.resource_id) rIds.add(r.resource_id);
    if (r.event_session_id) esIds.add(r.event_session_id);
    if (r.service_item_id) siIds.add(r.service_item_id);
    if (r.appointment_service_id) asIds.add(r.appointment_service_id);
    if (r.service_id) vsIds.add(r.service_id);
  }

  if (esIds.size > 0) {
    const { data: sess } = await db
      .from('event_sessions')
      .select('service_item_id')
      .in('id', [...esIds]);
    for (const s of sess ?? []) {
      const sid = (s as { service_item_id?: string | null }).service_item_id;
      if (sid) siIds.add(sid);
    }
  }

  const experienceEvent = new Map<string, string>();
  if (evIds.size > 0) {
    const { data } = await db.from('experience_events').select('id, name').in('id', [...evIds]);
    for (const row of data ?? []) {
      const id = (row as { id: string }).id;
      const name = (row as { name?: string }).name?.trim();
      if (name) experienceEvent.set(id, name);
    }
  }

  const classInstance = new Map<string, string>();
  if (ciIds.size > 0) {
    const { data: instRows } = await db.from('class_instances').select('id, class_type_id').in('id', [...ciIds]);
    const ctIds = new Set<string>();
    for (const row of instRows ?? []) {
      const ct = (row as { class_type_id?: string }).class_type_id;
      if (ct) ctIds.add(ct);
    }
    const classTypeName = new Map<string, string>();
    if (ctIds.size > 0) {
      const { data: ctRows } = await db.from('class_types').select('id, name').in('id', [...ctIds]);
      for (const row of ctRows ?? []) {
        const id = (row as { id: string }).id;
        const name = (row as { name?: string }).name?.trim();
        if (name) classTypeName.set(id, name);
      }
    }
    for (const row of instRows ?? []) {
      const id = (row as { id: string }).id;
      const ct = (row as { class_type_id?: string }).class_type_id;
      const title = ct ? classTypeName.get(ct) ?? null : null;
      if (title) classInstance.set(id, title);
    }
  }

  const resource = new Map<string, string>();
  if (rIds.size > 0) {
    const { data } = await db.from('unified_calendars').select('id, name').in('id', [...rIds]);
    for (const row of data ?? []) {
      const id = (row as { id: string }).id;
      const name = (row as { name?: string }).name?.trim();
      if (name) resource.set(id, name);
    }
  }

  const serviceItem = await loadServiceItemNames(db, siIds);

  const eventSession = new Map<string, string>();
  if (esIds.size > 0) {
    const { data: sess } = await db
      .from('event_sessions')
      .select('id, service_item_id, session_date, start_time')
      .in('id', [...esIds]);
    for (const s of sess ?? []) {
      const id = (s as { id: string }).id;
      const itemId = (s as { service_item_id?: string | null }).service_item_id;
      const d = (s as { session_date?: string }).session_date;
      const t = (s as { start_time?: string }).start_time;
      const fromItem = itemId ? serviceItem.get(itemId) : null;
      const fallback = d && t ? `${d} ${String(t).slice(0, 5)}` : 'Event';
      eventSession.set(id, fromItem ?? fallback);
    }
  }

  const appointmentService = new Map<string, string>();
  if (asIds.size > 0) {
    const { data } = await db.from('appointment_services').select('id, name').in('id', [...asIds]);
    for (const row of data ?? []) {
      const id = (row as { id: string }).id;
      const name = (row as { name?: string }).name?.trim();
      if (name) appointmentService.set(id, name);
    }
  }

  const venueService = new Map<string, string>();
  if (vsIds.size > 0) {
    const { data } = await db.from('venue_services').select('id, name').in('id', [...vsIds]);
    for (const row of data ?? []) {
      const id = (row as { id: string }).id;
      const name = (row as { name?: string }).name?.trim();
      if (name) venueService.set(id, name);
    }
  }

  const maps = {
    experienceEvent,
    classInstance,
    resource,
    eventSession,
    serviceItem,
    appointmentService,
    venueService,
  };

  for (const row of rows) {
    const label = labelFromForeignKeys(row, maps);
    if (label) out.set(row.id, label);
  }

  return out;
}
