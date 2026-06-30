/**
 * Load practitioner / calendar + service names for appointment booking emails (cron + payment webhooks).
 * Supports legacy Model B (`practitioner_id` + `appointment_service_id`) and USE (`calendar_id` + `service_item_id`).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  BookingEmailData,
  BookingTicketPriceLine,
  GroupAppointmentLine,
} from '@/lib/emails/types';
import { formatDepositAmount } from '@/lib/emails/templates/base-template';
import { getResourceBookingEmailLabels } from '@/lib/booking/resource-booking-email-labels';

function priceDisplayFromPence(pricePence: number | null | undefined): string | null {
  if (pricePence == null) return null;
  return `£${formatDepositAmount(pricePence)}`;
}

type AddonSnapshotRow = {
  addon_name_snapshot: string;
  addon_group_name_snapshot: string | null;
  price_pence_at_booking: number;
  duration_minutes_at_booking: number;
};

/** One human-readable add-on line, e.g. "Finishing touches: Olaplex treatment (+£10.00, +15 min)". */
function formatAddonLine(row: AddonSnapshotRow): string {
  const namePart = row.addon_group_name_snapshot
    ? `${row.addon_group_name_snapshot}: ${row.addon_name_snapshot}`
    : row.addon_name_snapshot;
  const parts: string[] = [];
  if (row.price_pence_at_booking > 0) parts.push(`+£${formatDepositAmount(row.price_pence_at_booking)}`);
  if (row.duration_minutes_at_booking > 0) parts.push(`+${row.duration_minutes_at_booking} min`);
  return parts.length > 0 ? `${namePart} (${parts.join(', ')})` : namePart;
}

/** Summarise a set of add-on rows into display lines plus price/duration totals. */
function summariseAddonRows(rows: AddonSnapshotRow[]): {
  lines: string[];
  totalPrice: number;
  totalDuration: number;
} {
  const lines: string[] = [];
  let totalPrice = 0;
  let totalDuration = 0;
  for (const row of rows) {
    lines.push(formatAddonLine(row));
    totalPrice += row.price_pence_at_booking;
    totalDuration += row.duration_minutes_at_booking;
  }
  return { lines, totalPrice, totalDuration };
}

export type BookingAnchorRow = {
  booking_model: string | null;
  practitioner_id: string | null;
  appointment_service_id: string | null;
  calendar_id: string | null;
  service_item_id: string | null;
  service_variant_id: string | null;
  group_booking_id: string | null;
  guest_id: string | null;
  person_label: string | null;
  location_type: string | null;
  client_address_line1: string | null;
  client_address_line2: string | null;
  client_address_city: string | null;
  client_address_postcode: string | null;
};

/**
 * Service delivery location for emails, from the booking snapshot. The online join
 * link/info are read live from the service so a corrected link reaches reminders.
 */
export async function resolveBookingLocationForEmail(
  supabase: SupabaseClient,
  row: BookingAnchorRow,
): Promise<BookingEmailData['booking_location']> {
  if (row.location_type === 'client_address') {
    const parts = [
      row.client_address_line1,
      row.client_address_line2,
      row.client_address_city,
      row.client_address_postcode,
    ]
      .map((p) => (p ?? '').trim())
      .filter(Boolean);
    return {
      kind: 'client_address',
      client_address: parts.length > 0 ? parts.join(', ') : null,
    };
  }

  if (row.location_type === 'online') {
    let url: string | null = null;
    let info: string | null = null;
    if (row.service_item_id) {
      const { data } = await supabase
        .from('service_items')
        .select('online_meeting_url, online_meeting_info')
        .eq('id', row.service_item_id)
        .maybeSingle();
      url = (data as { online_meeting_url?: string | null } | null)?.online_meeting_url ?? null;
      info = (data as { online_meeting_info?: string | null } | null)?.online_meeting_info ?? null;
    } else if (row.appointment_service_id) {
      const { data } = await supabase
        .from('appointment_services')
        .select('online_meeting_url, online_meeting_info')
        .eq('id', row.appointment_service_id)
        .maybeSingle();
      url = (data as { online_meeting_url?: string | null } | null)?.online_meeting_url ?? null;
      info = (data as { online_meeting_info?: string | null } | null)?.online_meeting_info ?? null;
    }
    return { kind: 'online', online_url: url, online_info: info };
  }

  if (row.location_type === 'business_venue') {
    return { kind: 'business_venue' };
  }

  return undefined;
}

/**
 * Combine parent service name with the chosen variant for confirmation/reminder emails.
 * Variant duration / price overrides win when present so guests see the actual numbers
 * for what they booked.
 */
function applyVariantOverrides(
  baseName: string | null,
  basePrice: number | null,
  variant: { name?: string | null; price_pence?: number | null } | null | undefined,
): { name: string | null; price: number | null } {
  if (!variant) return { name: baseName, price: basePrice };
  const name = baseName && variant.name ? `${baseName} - ${variant.name}` : baseName ?? variant.name ?? null;
  const price = variant.price_pence ?? basePrice;
  return { name, price };
}

async function resolveAppointmentLabels(
  supabase: SupabaseClient,
  row: BookingAnchorRow,
): Promise<{
  practitionerName: string | null;
  serviceName: string | null;
  appointmentPriceDisplay: string | null;
  servicePricePence: number | null;
} | null> {
  const legacyPr = row.practitioner_id;
  const legacySvc = row.appointment_service_id;
  const cal = row.calendar_id;
  const item = row.service_item_id;
  const variantId = row.service_variant_id;

  const variantPromise = variantId
    ? supabase
        .from('service_variants')
        .select('name, price_pence')
        .eq('id', variantId)
        .maybeSingle()
    : Promise.resolve({ data: null });

  if (legacyPr && legacySvc) {
    const [{ data: pr }, { data: svc }, { data: variant }, { data: link }] = await Promise.all([
      supabase.from('practitioners').select('name').eq('id', legacyPr).maybeSingle(),
      supabase.from('appointment_services').select('name, price_pence').eq('id', legacySvc).maybeSingle(),
      variantPromise,
      supabase
        .from('practitioner_services')
        .select('custom_price_pence')
        .eq('practitioner_id', legacyPr)
        .eq('service_id', legacySvc)
        .maybeSingle(),
    ]);
    // Match booking-time pricing: a per-practitioner price override replaces the base
    // service price, then a chosen variant replaces both. Without the override here,
    // reminders/re-sends show the base price while the original confirmation (which is
    // built from the booking-time price) shows the practitioner's price.
    const basePrice = (link as { custom_price_pence?: number | null } | null)?.custom_price_pence ?? svc?.price_pence ?? null;
    const merged = applyVariantOverrides(svc?.name ?? null, basePrice, variant);
    return {
      practitionerName: pr?.name ?? null,
      serviceName: merged.name,
      appointmentPriceDisplay: priceDisplayFromPence(merged.price),
      servicePricePence: merged.price,
    };
  }

  if (cal && item) {
    const [{ data: uc }, { data: si }, { data: variant }, { data: link }] = await Promise.all([
      supabase.from('unified_calendars').select('name').eq('id', cal).maybeSingle(),
      supabase.from('service_items').select('name, price_pence').eq('id', item).maybeSingle(),
      variantPromise,
      supabase
        .from('calendar_service_assignments')
        .select('custom_price_pence')
        .eq('calendar_id', cal)
        .eq('service_item_id', item)
        .maybeSingle(),
    ]);
    // Per-calendar price override replaces the base price, then the variant replaces both
    // (mirrors booking-time pricing so reminders match the original confirmation).
    const basePrice = (link as { custom_price_pence?: number | null } | null)?.custom_price_pence ?? si?.price_pence ?? null;
    const merged = applyVariantOverrides(si?.name ?? null, basePrice, variant);
    return {
      practitionerName: uc?.name ?? null,
      serviceName: merged.name,
      appointmentPriceDisplay: priceDisplayFromPence(merged.price),
      servicePricePence: merged.price,
    };
  }

  if (cal) {
    const { data: uc } = await supabase.from('unified_calendars').select('name').eq('id', cal).maybeSingle();
    return {
      practitionerName: uc?.name ?? null,
      serviceName: null,
      appointmentPriceDisplay: null,
      servicePricePence: null,
    };
  }

  return null;
}

/**
 * Fills `email_variant` and appointment fields when the booking row has either
 * legacy (`practitioner_id` + `appointment_service_id`) or USE (`calendar_id` + `service_item_id`) anchors.
 */
export async function enrichBookingEmailForAppointment(
  supabase: SupabaseClient,
  bookingId: string,
  base: BookingEmailData,
): Promise<BookingEmailData> {
  const { data: row, error } = await supabase
    .from('bookings')
    .select(
      'booking_model, practitioner_id, appointment_service_id, calendar_id, service_item_id, service_variant_id, group_booking_id, guest_id, person_label, location_type, client_address_line1, client_address_line2, client_address_city, client_address_postcode',
    )
    .eq('id', bookingId)
    .maybeSingle();

  if (error || !row) {
    return base;
  }

  const anchor = row as BookingAnchorRow;
  const bookingLocation = await resolveBookingLocationForEmail(supabase, anchor);
  const baseWithLocation: BookingEmailData = bookingLocation
    ? { ...base, booking_location: bookingLocation }
    : base;

  const resolved = await resolveAppointmentLabels(supabase, anchor);
  if (!resolved) {
    return baseWithLocation;
  }

  const { practitionerName, serviceName, appointmentPriceDisplay, servicePricePence } = resolved;

  let groupAppointments: GroupAppointmentLine[] | undefined;
  let groupTotalPricePence: number | null = null;

  if (anchor.group_booking_id && anchor.guest_id) {
    const { data: siblings } = await supabase
      .from('bookings')
      .select(
        'id, booking_date, booking_time, practitioner_id, appointment_service_id, calendar_id, service_item_id, service_variant_id, person_label',
      )
      .eq('group_booking_id', anchor.group_booking_id)
      .eq('guest_id', anchor.guest_id)
      .order('booking_date')
      .order('booking_time');

    if (siblings && siblings.length > 1) {
      const siblingIds = siblings.map((s) => s.id as string).filter(Boolean);
      const prIds = [...new Set(siblings.map((s) => s.practitioner_id).filter(Boolean))] as string[];
      const svcIds = [...new Set(siblings.map((s) => s.appointment_service_id).filter(Boolean))] as string[];
      const calIds = [...new Set(siblings.map((s) => s.calendar_id).filter(Boolean))] as string[];
      const itemIds = [...new Set(siblings.map((s) => s.service_item_id).filter(Boolean))] as string[];
      const variantIds = [...new Set(siblings.map((s) => s.service_variant_id).filter(Boolean))] as string[];

      const [{ data: pracs }, { data: svcs }, { data: cals }, { data: items }, { data: variants }, { data: addonRows }, { data: psLinks }, { data: csaLinks }] = await Promise.all([
        prIds.length ? supabase.from('practitioners').select('id, name').in('id', prIds) : { data: [] },
        svcIds.length ? supabase.from('appointment_services').select('id, name, price_pence').in('id', svcIds) : { data: [] },
        calIds.length ? supabase.from('unified_calendars').select('id, name').in('id', calIds) : { data: [] },
        itemIds.length ? supabase.from('service_items').select('id, name, price_pence').in('id', itemIds) : { data: [] },
        variantIds.length ? supabase.from('service_variants').select('id, name, price_pence').in('id', variantIds) : { data: [] },
        siblingIds.length
          ? supabase
              .from('booking_addons')
              .select('booking_id, addon_name_snapshot, addon_group_name_snapshot, price_pence_at_booking, duration_minutes_at_booking')
              .in('booking_id', siblingIds)
              .order('created_at', { ascending: true })
          : { data: [] },
        // Per-practitioner / per-calendar price overrides for the same (staff, service) pairs,
        // so each person's line matches what they were charged at booking time.
        prIds.length && svcIds.length
          ? supabase
              .from('practitioner_services')
              .select('practitioner_id, service_id, custom_price_pence')
              .in('practitioner_id', prIds)
              .in('service_id', svcIds)
          : { data: [] },
        calIds.length && itemIds.length
          ? supabase
              .from('calendar_service_assignments')
              .select('calendar_id, service_item_id, custom_price_pence')
              .in('calendar_id', calIds)
              .in('service_item_id', itemIds)
          : { data: [] },
      ]);

      // Group each person's add-on snapshots by their booking row.
      const addonsByBooking = new Map<string, AddonSnapshotRow[]>();
      for (const a of (addonRows ?? []) as Array<AddonSnapshotRow & { booking_id: string }>) {
        const list = addonsByBooking.get(a.booking_id) ?? [];
        list.push({
          addon_name_snapshot: a.addon_name_snapshot,
          addon_group_name_snapshot: a.addon_group_name_snapshot,
          price_pence_at_booking: a.price_pence_at_booking,
          duration_minutes_at_booking: a.duration_minutes_at_booking,
        });
        addonsByBooking.set(a.booking_id, list);
      }

      const prMap = new Map((pracs ?? []).map((p: { id: string; name: string }) => [p.id, p.name]));
      const calMap = new Map((cals ?? []).map((c: { id: string; name: string }) => [c.id, c.name]));
      const svMap = new Map(
        (svcs ?? []).map((s: { id: string; name: string; price_pence: number | null }) => [
          s.id,
          { name: s.name, price_pence: s.price_pence },
        ]),
      );
      const itemMap = new Map(
        (items ?? []).map((s: { id: string; name: string; price_pence: number | null }) => [
          s.id,
          { name: s.name, price_pence: s.price_pence },
        ]),
      );
      const variantMap = new Map(
        (variants ?? []).map((v: { id: string; name: string; price_pence: number | null }) => [
          v.id,
          { name: v.name, price_pence: v.price_pence },
        ]),
      );
      const psOverrideMap = new Map(
        (psLinks ?? []).map(
          (l: { practitioner_id: string; service_id: string; custom_price_pence: number | null }) => [
            `${l.practitioner_id}:${l.service_id}`,
            l.custom_price_pence,
          ],
        ),
      );
      const csaOverrideMap = new Map(
        (csaLinks ?? []).map(
          (l: { calendar_id: string; service_item_id: string; custom_price_pence: number | null }) => [
            `${l.calendar_id}:${l.service_item_id}`,
            l.custom_price_pence,
          ],
        ),
      );

      let sumPence = 0;
      let anyPrice = false;
      groupAppointments = siblings.map((s) => {
        const label = (s.person_label as string | null)?.trim() || 'Guest';
        const timeStr = typeof s.booking_time === 'string' ? s.booking_time.slice(0, 5) : '00:00';
        const pid = s.practitioner_id as string | null;
        const sid = s.appointment_service_id as string | null;
        const cid = s.calendar_id as string | null;
        const iid = s.service_item_id as string | null;
        const vid = s.service_variant_id as string | null;
        const variant = vid ? variantMap.get(vid) ?? null : null;

        // Per-person add-ons (service + variant + add-ons make this person's subtotal).
        const addonSummary = summariseAddonRows(addonsByBooking.get(s.id as string) ?? []);
        const addonLines = addonSummary.lines.length > 0 ? addonSummary.lines : undefined;
        const addonPence = addonSummary.totalPrice;

        let practitionerNameLine = 'Staff';
        let serviceNameLine = 'Treatment';
        let priceDisplay: string | null = null;
        let servicePence: number | null = null;

        if (pid && sid) {
          practitionerNameLine = prMap.get(pid) ?? 'Staff';
          const sv = svMap.get(sid);
          const overridePence = psOverrideMap.get(`${pid}:${sid}`) ?? null;
          const basePrice = overridePence ?? sv?.price_pence ?? null;
          const merged = applyVariantOverrides(sv?.name ?? null, basePrice, variant);
          serviceNameLine = merged.name ?? 'Treatment';
          priceDisplay = priceDisplayFromPence(merged.price);
          servicePence = merged.price;
        } else if (cid && iid) {
          practitionerNameLine = calMap.get(cid) ?? 'Staff';
          const it = itemMap.get(iid);
          const overridePence = csaOverrideMap.get(`${cid}:${iid}`) ?? null;
          const basePrice = overridePence ?? it?.price_pence ?? null;
          const merged = applyVariantOverrides(it?.name ?? null, basePrice, variant);
          serviceNameLine = merged.name ?? 'Treatment';
          priceDisplay = priceDisplayFromPence(merged.price);
          servicePence = merged.price;
        }

        // Person subtotal = service + variant + their add-ons. Shown only when add-ons
        // make it differ from the service line price.
        let subtotalDisplay: string | null = null;
        if (servicePence != null) {
          const personSubtotal = servicePence + addonPence;
          sumPence += personSubtotal;
          anyPrice = true;
          if (addonPence > 0) subtotalDisplay = priceDisplayFromPence(personSubtotal);
        }

        return {
          person_label: label,
          booking_date: s.booking_date as string,
          booking_time: timeStr,
          practitioner_name: practitionerNameLine,
          service_name: serviceNameLine,
          price_display: priceDisplay,
          ...(addonLines ? { addon_lines: addonLines } : {}),
          ...(subtotalDisplay ? { subtotal_display: subtotalDisplay } : {}),
        };
      });
      if (anyPrice) {
        groupTotalPricePence = sumPence;
      }
    }
  }

  const totalFromSingleOrGroup =
    groupTotalPricePence != null ? groupTotalPricePence : servicePricePence ?? null;

  return {
    ...baseWithLocation,
    booking_model: (anchor.booking_model as BookingEmailData['booking_model']) ?? base.booking_model,
    email_variant: 'appointment',
    practitioner_name: practitionerName,
    appointment_service_name: serviceName,
    appointment_price_display: base.appointment_price_display ?? appointmentPriceDisplay,
    booking_total_price_pence:
      base.booking_total_price_pence != null
        ? base.booking_total_price_pence
        : totalFromSingleOrGroup,
    ...(groupAppointments && groupAppointments.length > 0 ? { group_appointments: groupAppointments } : {}),
  };
}

/**
 * Models C/D/E: event, class, resource - labels for confirmation/reminder templates from FK ids.
 * Run after `enrichBookingEmailForAppointment` so USE/Model B wins when both anchors exist.
 */
export async function enrichBookingEmailForSecondaryModels(
  supabase: SupabaseClient,
  bookingId: string,
  base: BookingEmailData,
): Promise<BookingEmailData> {
  const { data: row, error } = await supabase
    .from('bookings')
    .select(
      'experience_event_id, class_instance_id, resource_id, booking_end_time, booking_time, party_size',
    )
    .eq('id', bookingId)
    .maybeSingle();

  if (error || !row) return base;

  const r = row as {
    experience_event_id: string | null;
    class_instance_id: string | null;
    resource_id: string | null;
    booking_end_time: string | null;
    booking_time: string | null;
    party_size: number | null;
  };

  if (r.experience_event_id) {
    const { data: ev } = await supabase
      .from('experience_events')
      .select('name')
      .eq('id', r.experience_event_id)
      .maybeSingle();

    const { data: ticketLines } = await supabase
      .from('booking_ticket_lines')
      .select('quantity, unit_price_pence, label')
      .eq('booking_id', bookingId);

    let totalPence = 0;
    const ticketPriceLines: BookingTicketPriceLine[] = [];
    for (const line of ticketLines ?? []) {
      const q = (line as { quantity?: number }).quantity ?? 0;
      const unit = (line as { unit_price_pence?: number }).unit_price_pence ?? 0;
      totalPence += q * unit;
      ticketPriceLines.push({
        label: (line as { label?: string }).label ?? null,
        quantity: q,
        unit_price_pence: unit,
      });
    }

    return {
      ...base,
      email_variant: 'appointment',
      booking_model: 'event_ticket',
      appointment_service_name: ev?.name ?? base.appointment_service_name ?? null,
      appointment_price_display:
        base.appointment_price_display ??
        (totalPence > 0 ? priceDisplayFromPence(totalPence) : null),
      booking_total_price_pence:
        base.booking_total_price_pence != null
          ? base.booking_total_price_pence
          : totalPence > 0
            ? totalPence
            : null,
      ...(ticketPriceLines.length > 0 ? { booking_ticket_price_lines: ticketPriceLines } : {}),
    };
  }

  if (r.class_instance_id) {
    const { data: inst } = await supabase
      .from('class_instances')
      .select('class_type_id')
      .eq('id', r.class_instance_id)
      .maybeSingle();
    const ctId = inst?.class_type_id;
    if (ctId) {
      const { data: ct } = await supabase
        .from('class_types')
        .select('name, price_pence')
        .eq('id', ctId)
        .maybeSingle();
      const party = typeof r.party_size === 'number' && r.party_size > 0 ? r.party_size : 1;
      const unitP = ct?.price_pence ?? null;
      const totalPence = unitP != null ? unitP * party : null;
      const showUnitBreakdown =
        unitP != null && unitP > 0 && party > 1 && totalPence != null && totalPence > 0;
      return {
        ...base,
        email_variant: 'appointment',
        booking_model: 'class_session',
        appointment_service_name: ct?.name ?? base.appointment_service_name ?? null,
        appointment_price_display:
          base.appointment_price_display ??
          (totalPence != null && totalPence > 0 ? priceDisplayFromPence(totalPence) : null),
        booking_total_price_pence:
          base.booking_total_price_pence != null
            ? base.booking_total_price_pence
            : totalPence != null && totalPence > 0
              ? totalPence
              : null,
        ...(showUnitBreakdown
          ? { booking_unit_price_pence: unitP, booking_price_quantity: party }
          : {}),
      };
    }
  }

  if (r.resource_id) {
    const { resourceName, hostCalendarName } = await getResourceBookingEmailLabels(
      supabase,
      r.resource_id,
    );
    const { data: vr } = await supabase
      .from('venue_resources')
      .select('price_per_slot_pence, slot_interval_minutes')
      .eq('id', r.resource_id)
      .maybeSingle();

    const totalPence = resourceBookingTotalPence({
      bookingTime: r.booking_time,
      bookingEndTime: r.booking_end_time,
      pricePerSlotPence: vr?.price_per_slot_pence ?? null,
      slotIntervalMinutes: vr?.slot_interval_minutes ?? null,
    });

    return {
      ...base,
      email_variant: 'appointment',
      booking_model: 'resource_booking',
      appointment_service_name: resourceName ?? base.appointment_service_name ?? null,
      practitioner_name: hostCalendarName ?? base.practitioner_name ?? null,
      appointment_price_display:
        base.appointment_price_display ??
        (totalPence != null && totalPence > 0 ? priceDisplayFromPence(totalPence) : null),
      booking_total_price_pence:
        base.booking_total_price_pence != null
          ? base.booking_total_price_pence
          : totalPence != null && totalPence > 0
            ? totalPence
            : null,
    };
  }

  return base;
}

/**
 * Load addon snapshots for a booking and render summary lines for the email template.
 * Returns an empty array (and zero totals) when no add-ons were chosen.
 */
async function enrichBookingEmailWithAddons(
  supabase: SupabaseClient,
  bookingId: string,
  base: BookingEmailData,
): Promise<BookingEmailData> {
  // Group bookings itemise add-ons per person in `enrichBookingEmailForAppointment`
  // (and already roll every sibling's add-ons into the group total), so skip the
  // flat single-booking handling here to avoid double-counting.
  if (base.group_appointments && base.group_appointments.length > 0) return base;

  const { data: rows, error } = await supabase
    .from('booking_addons')
    .select(
      'addon_name_snapshot, addon_group_name_snapshot, price_pence_at_booking, duration_minutes_at_booking',
    )
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: true });

  if (error || !rows || rows.length === 0) return base;

  const { lines, totalPrice, totalDuration } = summariseAddonRows(rows as AddonSnapshotRow[]);

  // Roll add-ons into the headline total when the venue uses full-payment-style pricing.
  const newTotal =
    base.booking_total_price_pence != null
      ? base.booking_total_price_pence + totalPrice
      : totalPrice > 0
        ? totalPrice
        : null;

  return {
    ...base,
    addon_lines: lines,
    addons_total_price_pence: totalPrice,
    addons_total_duration_minutes: totalDuration,
    booking_total_price_pence: newTotal,
  };
}

/** Appointment/USE enrichment then C/D/E labels for transactional and scheduled comms. */
export async function enrichBookingEmailForComms(
  supabase: SupabaseClient,
  bookingId: string,
  base: BookingEmailData,
): Promise<BookingEmailData> {
  const appt = await enrichBookingEmailForAppointment(supabase, bookingId, base);
  const withSecondary = await enrichBookingEmailForSecondaryModels(supabase, bookingId, appt);
  return enrichBookingEmailWithAddons(supabase, bookingId, withSecondary);
}

function resourceBookingTotalPence(params: {
  bookingTime: string | null | undefined;
  bookingEndTime: string | null | undefined;
  pricePerSlotPence: number | null | undefined;
  slotIntervalMinutes: number | null | undefined;
}): number | null {
  const { bookingTime, bookingEndTime, pricePerSlotPence, slotIntervalMinutes } = params;
  if (pricePerSlotPence == null || pricePerSlotPence <= 0) return null;
  const start = (bookingTime ?? '').slice(0, 5);
  const end = (bookingEndTime ?? '').slice(0, 5);
  if (!start || !end) return null;
  const durationMinutes =
    (parseInt(end.slice(0, 2), 10) * 60 + parseInt(end.slice(3, 5), 10)) -
    (parseInt(start.slice(0, 2), 10) * 60 + parseInt(start.slice(3, 5), 10));
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return null;
  const interval = slotIntervalMinutes ?? 15;
  const numSlots = Math.ceil(durationMinutes / interval);
  return pricePerSlotPence * numSlots;
}
