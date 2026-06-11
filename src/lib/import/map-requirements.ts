/**
 * Per-file required-mapping checks for the Map step.
 *
 * Mirrors what the import pipeline can actually consume — deliberately no
 * stricter. In particular:
 *  - split parts count as mapped fields (a "Full Name" split into first/last
 *    satisfies the name requirement; a "Date/Time" split satisfies date+time);
 *  - a combined date+time column mapped to booking_date alone is fine, because
 *    apply-mappings recovers the time component from the value;
 *  - bookings only need SOME way to identify the client — email, phone,
 *    external id, or guest name(s) (the importer matches by exact name and
 *    creates import-only guests as a fallback).
 */

export type RequirementMapping = {
  file_id: string;
  source_column: string;
  target_field: string | null;
  action: string;
  split_config?: { separator?: string; parts?: Array<{ field: string }> } | null;
};

export type RequirementFile = {
  id: string;
  filename: string;
  file_type: string;
  sample_rows?: Record<string, string>[] | null;
};

export type RequirementItem = {
  key: string;
  label: string;
  satisfied: boolean;
  /** What the user should do when not satisfied (actionable, file-specific). */
  hint: string | null;
};

export type FileRequirements = {
  fileId: string;
  filename: string;
  fileType: string;
  satisfied: boolean;
  items: RequirementItem[];
};

const DATETIME_VALUE_RE =
  /^(\d{4}-\d{2}-\d{2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})[T ]\d{1,2}[:.]\d{2}/;

/** All field keys a file's mappings will produce, including split parts. */
export function effectiveMappedFields(
  fileId: string,
  mappings: RequirementMapping[],
): Set<string> {
  const out = new Set<string>();
  for (const m of mappings) {
    if (m.file_id !== fileId) continue;
    if (m.action === 'map' && m.target_field) out.add(m.target_field);
    if (m.action === 'split' && m.split_config?.parts) {
      for (const p of m.split_config.parts) {
        if (p.field) out.add(p.field);
      }
    }
  }
  return out;
}

/** True when the column mapped to `booking_date` holds combined date+time values. */
function bookingDateColumnHasTime(
  file: RequirementFile,
  mappings: RequirementMapping[],
): boolean {
  const dateMapping = mappings.find(
    (m) => m.file_id === file.id && m.action === 'map' && m.target_field === 'booking_date',
  );
  if (!dateMapping) return false;
  const samples = file.sample_rows ?? [];
  return samples.some((row) => DATETIME_VALUE_RE.test((row[dateMapping.source_column] ?? '').trim()));
}

export function computeFileRequirements(
  file: RequirementFile,
  mappings: RequirementMapping[],
  clientLabel = 'Client',
): FileRequirements {
  const mapped = effectiveMappedFields(file.id, mappings);
  const items: RequirementItem[] = [];
  const lcLabel = clientLabel.toLowerCase();

  if (file.file_type === 'clients' || file.file_type === 'unknown') {
    const hasName =
      (mapped.has('first_name') && mapped.has('last_name')) ||
      mapped.has('full_name') ||
      mapped.has('first_name') ||
      mapped.has('last_name');
    items.push({
      key: 'client_name',
      label: `${clientLabel} name`,
      satisfied: hasName,
      hint: hasName
        ? null
        : `Map a name column. A single combined column (e.g. “Sarah Jones”) can go straight to Full Name — we split it into first and last name for you — or use “Split column” to control it yourself.`,
    });
  }

  if (file.file_type === 'bookings') {
    const dateHasTime = bookingDateColumnHasTime(file, mappings);
    const hasDate = mapped.has('booking_date');
    const hasTime = mapped.has('booking_time') || dateHasTime;

    items.push({
      key: 'booking_date',
      label: 'Booking date',
      satisfied: hasDate,
      hint: hasDate
        ? null
        : 'Map the column with the appointment/booking date. A combined date + time column can be mapped to Booking Date directly.',
    });
    items.push({
      key: 'booking_time',
      label: 'Booking time',
      satisfied: hasTime,
      hint: hasTime
        ? dateHasTime && !mapped.has('booking_time')
          ? 'Time will be taken from your combined date + time column automatically.'
          : null
        : 'Map a time column, or map a combined date + time column to Booking Date — the time is extracted automatically.',
    });

    const hasIdentity =
      mapped.has('client_email') ||
      mapped.has('client_phone') ||
      mapped.has('client_external_id') ||
      mapped.has('guest_full_name') ||
      mapped.has('guest_first_name') ||
      mapped.has('guest_last_name');
    items.push({
      key: 'booking_identity',
      label: `${clientLabel} identity (email, phone, ID, or name)`,
      satisfied: hasIdentity,
      hint: hasIdentity
        ? null
        : `Map at least one way to identify who each booking is for: ${lcLabel} email, phone, an ID from your old system, or a guest name column. Name-only matching works — we match exact names and create new ${lcLabel} records when needed.`,
    });
  }

  if (file.file_type === 'staff') {
    const hasStaffName =
      mapped.has('staff_name') || mapped.has('staff_first_name') || mapped.has('staff_last_name');
    items.push({
      key: 'staff_name',
      label: 'Staff member name',
      satisfied: hasStaffName,
      hint: hasStaffName
        ? null
        : 'Map the column holding each staff member’s name (a combined full-name column is fine).',
    });
  }

  return {
    fileId: file.id,
    filename: file.filename,
    fileType: file.file_type,
    satisfied: items.every((i) => i.satisfied),
    items,
  };
}

export function computeAllFileRequirements(
  files: RequirementFile[],
  mappings: RequirementMapping[],
  clientLabel = 'Client',
): FileRequirements[] {
  return files.map((f) => computeFileRequirements(f, mappings, clientLabel));
}
