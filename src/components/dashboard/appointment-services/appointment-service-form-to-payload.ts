import { isServiceCustomScheduleEmpty } from '@/lib/service-custom-availability';
import type { AppointmentServiceFormValues } from '@/components/dashboard/appointment-services/appointment-service-form-values';

/** Parse a pounds string ("12.50") to integer pence, or null when empty/invalid. */
export function poundsToPence(pounds: string): number | null {
  const trimmed = pounds.trim();
  if (!trimmed) return null;
  const num = Number.parseFloat(trimmed);
  if (Number.isNaN(num) || num < 0) return null;
  return Math.round(num * 100);
}

export interface AppointmentServicePayloadOptions {
  isAdmin: boolean;
  /** Present when editing an existing service (PATCH); omit for create (POST). */
  editingId?: string | null;
}

export type AppointmentServicePayloadResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * Validates an appointment-service form and builds the request body for
 * `/api/venue/appointment-services` (POST when no `editingId`, PATCH otherwise).
 *
 * Extracted verbatim from `AppointmentServicesView.handleSave` so the dashboard
 * and the data-import "add service" modal produce identical, fully-configured
 * services. Validation failures are returned as `{ ok: false, error }` rather
 * than mutating any UI state, so each caller can surface them its own way.
 */
export function appointmentServiceFormToPayload(
  form: AppointmentServiceFormValues,
  opts: AppointmentServicePayloadOptions,
): AppointmentServicePayloadResult {
  const { isAdmin, editingId = null } = opts;

  const usesVariants = isAdmin && form.variants.length > 0;
  const activeVariants = usesVariants ? form.variants.filter((v) => v.is_active) : [];

  if (!form.name.trim()) {
    return { ok: false, error: 'Service name is required' };
  }
  if (!usesVariants && form.duration_minutes < 5) {
    return { ok: false, error: 'Duration must be at least 5 minutes' };
  }
  if (form.payment_requirement === 'deposit') {
    const d = poundsToPence(form.deposit);
    if (d == null || d <= 0) {
      return { ok: false, error: 'Enter a valid deposit amount' };
    }
  }
  if (form.payment_requirement === 'card_hold') {
    const d = poundsToPence(form.deposit);
    if (d == null || d < 100) {
      return { ok: false, error: 'Enter a no-show fee of at least £1' };
    }
    for (const v of form.variants) {
      if (v.deposit.trim()) {
        const vd = poundsToPence(v.deposit);
        if (vd == null || vd < 100) {
          return {
            ok: false,
            error: `Option "${v.name.trim()}": set a no-show fee of at least £1, or leave it blank to use the service fee.`,
          };
        }
      }
    }
  }
  if (form.payment_requirement === 'full_payment') {
    if (usesVariants) {
      if (activeVariants.length === 0) {
        return { ok: false, error: 'Turn on at least one bookable option, or switch back to a single offering.' };
      }
      for (const v of activeVariants) {
        const p = poundsToPence(v.price);
        if (p == null || p <= 0) {
          return {
            ok: false,
            error: `Option "${v.name.trim()}": set a price — full online payment applies to each option.`,
          };
        }
      }
    } else {
      const p = poundsToPence(form.price);
      if (p == null || p <= 0) {
        return { ok: false, error: 'Set a price when charging full payment online' };
      }
    }
  }

  if (isAdmin && form.custom_availability_enabled && isServiceCustomScheduleEmpty(form.custom_working_hours)) {
    return { ok: false, error: 'Add at least one custom schedule rule, or turn off custom availability.' };
  }

  if (isAdmin && form.location_type === 'online' && form.online_meeting_url.trim()) {
    const raw = form.online_meeting_url.trim();
    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    let valid = false;
    try {
      const u = new URL(candidate);
      valid = (u.protocol === 'http:' || u.protocol === 'https:') && Boolean(u.hostname);
    } catch {
      valid = false;
    }
    if (!valid) {
      return { ok: false, error: 'Enter a valid link for the online service (e.g. https://zoom.us/j/123).' };
    }
  }

  if (isAdmin && form.variants.length > 0) {
    if (activeVariants.length === 0) {
      return { ok: false, error: 'Turn on at least one bookable option, or switch back to a single offering.' };
    }
    for (let i = 0; i < form.variants.length; i++) {
      const v = form.variants[i]!;
      if (!v.name.trim()) {
        return { ok: false, error: `Option ${i + 1}: name is required` };
      }
      if (v.duration_minutes < 5 || v.duration_minutes > 480) {
        return { ok: false, error: `Option "${v.name.trim()}" duration must be between 5 and 480 minutes` };
      }
      if (v.price.trim() && poundsToPence(v.price) == null) {
        return { ok: false, error: `Option "${v.name.trim()}" has an invalid price` };
      }
      if (v.deposit.trim() && poundsToPence(v.deposit) == null) {
        return { ok: false, error: `Option "${v.name.trim()}" has an invalid deposit` };
      }
    }
  }

  if (!isAdmin && !editingId && form.practitioner_ids.length === 0) {
    return { ok: false, error: 'Select at least one calendar column to offer this service on.' };
  }

  const usesVariantsPayload = isAdmin && form.variants.length > 0;
  const primaryForParent =
    usesVariantsPayload && form.variants.length > 0
      ? form.variants.find((v) => v.is_active) ?? form.variants[0]
      : null;
  const durationMinutesPayload =
    usesVariantsPayload && primaryForParent ? primaryForParent.duration_minutes : form.duration_minutes;
  const bufferMinutesPayload =
    usesVariantsPayload && primaryForParent ? primaryForParent.buffer_minutes : form.buffer_minutes;
  const priceStrPayload = usesVariantsPayload && primaryForParent ? primaryForParent.price : form.price;

  // Card holds store the no-show fee in the same deposit_pence column as deposits.
  const depositPence =
    form.payment_requirement === 'deposit' || form.payment_requirement === 'card_hold'
      ? (poundsToPence(form.deposit) ?? 0)
      : 0;
  const payload: Record<string, unknown> = {
    ...(editingId ? { id: editingId } : {}),
    name: form.name.trim(),
    // Send null (not undefined) so a cleared description actually reaches the
    // server — JSON.stringify drops undefined, which silently kept the old value.
    description: form.description.trim() || null,
    duration_minutes: durationMinutesPayload,
    buffer_minutes: bufferMinutesPayload,
    price_pence: poundsToPence(priceStrPayload) ?? undefined,
    payment_requirement: form.payment_requirement,
    deposit_pence: depositPence,
    colour: form.colour,
    is_active: form.is_active,
    practitioner_ids: form.practitioner_ids,
    max_advance_booking_days: form.max_advance_booking_days,
    min_booking_notice_hours: form.min_booking_notice_hours,
    cancellation_notice_hours: form.cancellation_notice_hours,
    allow_same_day_booking: form.allow_same_day_booking,
    booking_interval_minutes: form.booking_interval_minutes,
    booking_minute_marks: form.booking_minute_marks,
  };
  if (isAdmin) {
    payload.staff_may_customize_name = form.staffMay.name;
    payload.staff_may_customize_description = form.staffMay.description;
    payload.staff_may_customize_duration = form.staffMay.duration;
    payload.staff_may_customize_buffer = form.staffMay.buffer;
    payload.staff_may_customize_price = form.staffMay.price;
    payload.staff_may_customize_deposit = form.staffMay.deposit;
    payload.staff_may_customize_colour = form.staffMay.colour;
    payload.custom_availability_enabled = form.custom_availability_enabled;
    payload.custom_working_hours = form.custom_availability_enabled ? form.custom_working_hours : null;
    payload.processing_time_blocks = usesVariantsPayload ? [] : form.processing_time_blocks;
    payload.variants = form.variants.map((v, idx) => ({
      ...(v.id ? { id: v.id } : {}),
      name: v.name.trim(),
      description: v.description.trim() || null,
      duration_minutes: v.duration_minutes,
      buffer_minutes: v.buffer_minutes,
      price_pence: poundsToPence(v.price),
      deposit_pence: poundsToPence(v.deposit),
      sort_order: idx,
      is_active: v.is_active,
      processing_time_blocks: v.processing_time_blocks,
    }));
    payload.addon_group_links = form.addon_group_links.map((link, idx) => ({
      addon_group_id: link.group.id,
      sort_order: idx,
    }));
    payload.location_type = form.location_type;
    const meetingUrlRaw = form.online_meeting_url.trim();
    payload.online_meeting_url =
      form.location_type === 'online' && meetingUrlRaw
        ? /^https?:\/\//i.test(meetingUrlRaw)
          ? meetingUrlRaw
          : `https://${meetingUrlRaw}`
        : null;
    payload.online_meeting_info =
      form.location_type === 'online' && form.online_meeting_info.trim()
        ? form.online_meeting_info.trim()
        : null;
  }

  return { ok: true, payload };
}
