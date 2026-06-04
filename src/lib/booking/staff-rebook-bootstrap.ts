import type { StaffBookingSurfaceTabId } from '@/lib/booking/staff-booking-modal-options';

export const STAFF_REBOOK_SESSION_KEY = 'reserveNI_staffRebook_v1';

export interface StaffRebookGuestPrefill {
  firstName?: string;
  lastName?: string;
  email?: string | null;
  phone?: string | null;
  dietaryNotes?: string | null;
  occasion?: string | null;
  specialRequests?: string | null;
  internalNotes?: string | null;
  customerProfileNotes?: string | null;
}

/** Payload persisted in sessionStorage for one-shot staff “Rebook from guest history”. */
export interface StaffRebookBootstrapPayloadV1 {
  v: 1;
  surface: StaffBookingSurfaceTabId;
  appointment?: {
    serviceId: string;
    practitionerId: string;
    variantId?: string | null;
    durationMinutes: number | null;
  };
  table?: {
    partySize: number;
    /** Dining / sitting service when the prior booking had one. */
    serviceId?: string | null;
    areaId?: string | null;
    coverDurationMinutes: number;
  };
  resource?: {
    resourceId: string;
    durationMinutes: number | null;
  };
  guest: StaffRebookGuestPrefill;
  /**
   * Reserved. The appointment "Comments or requests" field is per-booking and is
   * intentionally NOT pre-filled on rebook (it starts blank for manual entry);
   * persistent customer info belongs on the client record. Kept optional so a
   * future feature could populate it deliberately.
   */
  appointmentComments?: string;
  /** Default date for staff date pickers (YYYY-MM-DD). */
  initialDate?: string;
}

export function writeStaffRebookBootstrap(payload: StaffRebookBootstrapPayloadV1): void {
  try {
    sessionStorage.setItem(STAFF_REBOOK_SESSION_KEY, JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
}

export function readStaffRebookBootstrap(): StaffRebookBootstrapPayloadV1 | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STAFF_REBOOK_SESSION_KEY);
    if (!raw?.trim()) return null;
    const parsed = JSON.parse(raw) as StaffRebookBootstrapPayloadV1;
    if (parsed?.v !== 1 || typeof parsed.surface !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearStaffRebookBootstrap(): void {
  try {
    sessionStorage.removeItem(STAFF_REBOOK_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

let staffSessionBootstrapResolved = false;
let staffSessionBootstrapPayload: StaffRebookBootstrapPayloadV1 | null = null;

/** Read-clear session payload once per module lifetime (handles React Strict Mode double mount). Reset via `resetStaffRebookBootstrapSessionHydrator` on `/new` exit. */
export function hydrateStaffRebookBootstrapOnce(): StaffRebookBootstrapPayloadV1 | null {
  if (!staffSessionBootstrapResolved) {
    staffSessionBootstrapResolved = true;
    staffSessionBootstrapPayload = readStaffRebookBootstrap();
    if (staffSessionBootstrapPayload) clearStaffRebookBootstrap();
  }
  return staffSessionBootstrapPayload;
}

export function resetStaffRebookBootstrapSessionHydrator(): void {
  staffSessionBootstrapResolved = false;
  staffSessionBootstrapPayload = null;
}

/** In-memory hydrate cache + browser session payload (staff “Rebook from guest history”). */
export function discardStaffRebookBootstrapCaches(): void {
  resetStaffRebookBootstrapSessionHydrator();
  clearStaffRebookBootstrap();
}

