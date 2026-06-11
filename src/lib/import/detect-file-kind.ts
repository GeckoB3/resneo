/**
 * Heuristic file-kind detection (clients / bookings / staff) from headers,
 * filename and the deterministic column profile. Runs at upload so users
 * confirm a pre-selected label instead of classifying files from scratch.
 *
 * Deliberately conservative: only returns a kind with 'high' confidence when
 * the evidence is one-sided; otherwise callers should keep the file 'unknown'
 * and let the user choose.
 */

import type { ColumnProfile } from '@/lib/import/column-profile';

export type DetectedFileKind = {
  kind: 'clients' | 'bookings' | 'staff' | 'unknown';
  confidence: 'high' | 'low';
  reason: string;
};

const BOOKING_HEADER_RE =
  /\b(appointment|booking|reservation|visit date|service date|start time|end time|check.?in|party|covers|arrival)\b/i;
const SERVICE_HEADER_RE = /\b(service|treatment|class|event|provider|practitioner|table)\b/i;
const CLIENT_HEADER_RE =
  /\b(first name|last name|surname|forename|full name|client|customer|guest|patient|member|email|mobile|phone|date of birth|dob|postcode|address|marketing)\b/i;
const STAFF_FILE_RE = /\b(staff|employee|team|roster|payroll|stylist|therapist|practitioner)s?\b/i;
const ROLE_HEADER_RE = /\b(role|job title|position|commission|hire date|start date of employment)\b/i;

function dominantType(p: ColumnProfile): keyof ColumnProfile['type_counts'] | null {
  const entries = Object.entries(p.type_counts) as Array<[keyof ColumnProfile['type_counts'], number]>;
  const total = entries.reduce((acc, [, n]) => acc + n, 0);
  if (total === 0) return null;
  entries.sort((a, b) => b[1] - a[1]);
  const [kind, count] = entries[0]!;
  return count / total >= 0.6 ? kind : null;
}

export function detectFileKind(params: {
  filename: string;
  headers: string[];
  rowCount: number;
  columnProfiles?: ColumnProfile[] | null;
}): DetectedFileKind {
  const { filename, headers, rowCount, columnProfiles } = params;
  const headerBlob = headers.join(' | ');
  // Underscores/dots are word characters, so "staff_list.xlsx" would defeat \b
  // matching — normalise separators to spaces first.
  const fname = filename.toLowerCase().replace(/[_\-.]+/g, ' ');

  const profiles = columnProfiles ?? [];
  const hasDateColumn = profiles.some((p) => {
    const t = dominantType(p);
    return t === 'date' || t === 'datetime';
  });
  const hasTimeColumn = profiles.some((p) => {
    const t = dominantType(p);
    return t === 'time' || t === 'datetime';
  });

  const bookingHeaderHit = BOOKING_HEADER_RE.test(headerBlob);
  const serviceHeaderHit = SERVICE_HEADER_RE.test(headerBlob);
  const clientHeaderHit = CLIENT_HEADER_RE.test(headerBlob);
  const staffFileHit = STAFF_FILE_RE.test(fname);
  const roleHeaderHit = ROLE_HEADER_RE.test(headerBlob);
  const bookingFileHit = /\b(booking|appointment|reservation)s?\b/i.test(fname);
  const clientFileHit = /\b(client|customer|guest|contact|member)s?\b/i.test(fname);

  // Bookings: rows that happen at a date/time. Strongest signal wins first —
  // a bookings export usually also contains client columns, so check it before
  // the clients heuristic.
  if ((hasDateColumn && hasTimeColumn) || (hasDateColumn && (bookingHeaderHit || serviceHeaderHit))) {
    return {
      kind: 'bookings',
      confidence: bookingHeaderHit || serviceHeaderHit || bookingFileHit ? 'high' : 'low',
      reason: 'Rows have date/time columns typical of a booking history.',
    };
  }
  if (bookingFileHit && hasDateColumn) {
    return { kind: 'bookings', confidence: 'high', reason: 'Filename and date columns suggest bookings.' };
  }

  // Staff lists: staff-y filename or role columns, few rows, no booking dates.
  if ((staffFileHit || roleHeaderHit) && !hasDateColumn && rowCount <= 500) {
    return {
      kind: 'staff',
      confidence: staffFileHit && roleHeaderHit ? 'high' : 'low',
      reason: 'Looks like a staff roster (staff/role columns, no booking dates).',
    };
  }

  // Client lists: people columns without booking date/times.
  if (clientHeaderHit && !bookingHeaderHit) {
    return {
      kind: 'clients',
      confidence: clientFileHit || /email|mobile|phone/i.test(headerBlob) ? 'high' : 'low',
      reason: 'Name and contact columns without booking dates suggest a client list.',
    };
  }
  if (clientFileHit) {
    return { kind: 'clients', confidence: 'low', reason: 'Filename suggests a client list.' };
  }

  return { kind: 'unknown', confidence: 'low', reason: 'Could not tell from the columns.' };
}
