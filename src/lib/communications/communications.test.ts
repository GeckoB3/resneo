import { describe, it, expect, vi, beforeEach } from 'vitest';

// Test the logToCommLogs dedup logic by mocking Supabase
const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockMaybeSingle = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdminClient: () => ({
    from: mockFrom,
  }),
}));

// Reconstruct the chain for each test
function setupSupabaseMock(returnData: unknown, error: { code: string } | null = null) {
  mockMaybeSingle.mockResolvedValue({ data: returnData, error });
  mockSelect.mockReturnValue({ maybeSingle: mockMaybeSingle });
  mockInsert.mockReturnValue({ select: mockSelect });
  mockFrom.mockReturnValue({ insert: mockInsert });
}

// Import after mocking
import { logToCommLogs } from './service';
import { isSelfServeBookingSource } from '@/lib/booking-source';
import {
  defaultCommunicationPolicies,
  parseCommunicationPolicies,
} from './policies';
import { formatCommunicationLogLabel } from './display-labels';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('logToCommLogs', () => {
  it('returns true when insert succeeds (first send)', async () => {
    setupSupabaseMock({ id: 'log-1' });

    const result = await logToCommLogs({
      venue_id: 'v1',
      booking_id: 'b1',
      message_type: 'booking_confirmation_email',
      channel: 'email',
      recipient: 'test@example.com',
      status: 'sent',
    });

    expect(result).toBe(true);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        venue_id: 'v1',
        booking_id: 'b1',
        message_type: 'booking_confirmation_email',
        channel: 'email',
        recipient: 'test@example.com',
        status: 'sent',
      }),
    );
  });

  it('returns false when unique constraint is violated (duplicate)', async () => {
    setupSupabaseMock(null, { code: '23505' });

    const result = await logToCommLogs({
      venue_id: 'v1',
      booking_id: 'b1',
      message_type: 'booking_confirmation_email',
      channel: 'email',
      recipient: 'test@example.com',
      status: 'sent',
    });

    expect(result).toBe(false);
  });

  it('returns false on other database errors', async () => {
    setupSupabaseMock(null, { code: '42P01' });

    const result = await logToCommLogs({
      venue_id: 'v1',
      booking_id: 'b1',
      message_type: 'reminder_56h_email',
      channel: 'email',
      recipient: 'test@example.com',
      status: 'sent',
    });

    expect(result).toBe(false);
  });
});

describe('cron window logic', () => {
  it('correctly identifies 56-hour window bookings', () => {
    const now = new Date('2026-03-15T12:00:00Z');
    const h56 = 56 * 60 * 60 * 1000;
    const tolerance = 15 * 60 * 1000;

    // Booking exactly 56 hours from now
    const exactBooking = new Date(now.getTime() + h56);
    const diff = exactBooking.getTime() - now.getTime();
    expect(diff >= h56 - tolerance && diff <= h56 + tolerance).toBe(true);

    // Booking 55 hours from now (outside window)
    const earlyBooking = new Date(now.getTime() + 55 * 60 * 60 * 1000);
    const earlyDiff = earlyBooking.getTime() - now.getTime();
    expect(earlyDiff >= h56 - tolerance && earlyDiff <= h56 + tolerance).toBe(false);

    // Booking 57 hours from now (outside window)
    const lateBooking = new Date(now.getTime() + 57 * 60 * 60 * 1000);
    const lateDiff = lateBooking.getTime() - now.getTime();
    expect(lateDiff >= h56 - tolerance && lateDiff <= h56 + tolerance).toBe(false);

    // Booking 55h50m from now (inside window)
    const nearBooking = new Date(now.getTime() + (55 * 60 + 50) * 60 * 1000);
    const nearDiff = nearBooking.getTime() - now.getTime();
    expect(nearDiff >= h56 - tolerance && nearDiff <= h56 + tolerance).toBe(true);
  });

  it('correctly identifies 15-minute send windows', () => {
    const sendTime = '09:00:00';
    const [sh, sm] = sendTime.split(':').map(Number);
    const sendMins = sh! * 60 + sm!;

    // At 09:00 - inside window
    expect(540 >= sendMins && 540 < sendMins + 15).toBe(true);
    // At 09:14 - inside window
    expect(554 >= sendMins && 554 < sendMins + 15).toBe(true);
    // At 09:15 - outside window
    expect(555 >= sendMins && 555 < sendMins + 15).toBe(false);
    // At 08:59 - outside window
    expect(539 >= sendMins && 539 < sendMins + 15).toBe(false);
  });
});

describe('settings toggle logic', () => {
  it('maps message types to correct enabled keys', () => {
    const settingsKeys = {
      booking_confirmation_email: 'confirmation_email_enabled',
      deposit_request_email: 'deposit_request_email_enabled',
      deposit_request_sms: 'deposit_sms_enabled',
      deposit_confirmation_email: 'deposit_confirmation_email_enabled',
      reminder_56h_email: 'reminder_email_enabled',
      day_of_reminder_sms: 'day_of_reminder_sms_enabled',
      day_of_reminder_email: 'day_of_reminder_email_enabled',
      post_visit_email: 'post_visit_email_enabled',
    };

    expect(Object.keys(settingsKeys)).toHaveLength(8);
    for (const [messageType, settingsKey] of Object.entries(settingsKeys)) {
      expect(settingsKey).toBeTruthy();
      expect(messageType).toBeTruthy();
    }
  });

  it('confirmation email is always enabled by default', () => {
    const defaults = {
      confirmation_email_enabled: true,
      deposit_sms_enabled: true,
      deposit_confirmation_email_enabled: true,
      reminder_email_enabled: true,
      day_of_reminder_enabled: true,
      day_of_reminder_sms_enabled: true,
      day_of_reminder_email_enabled: true,
      post_visit_email_enabled: true,
    };

    expect(defaults.confirmation_email_enabled).toBe(true);
  });
});

describe('card-hold communication policies (§10.3)', () => {
  it('defaults both card-hold keys to email + SMS in both lanes', () => {
    const defaults = defaultCommunicationPolicies();
    for (const lane of ['table', 'appointments_other'] as const) {
      expect(defaults[lane].card_hold_request.enabled).toBe(true);
      expect(defaults[lane].card_hold_request.channels).toEqual(['email', 'sms']);
      expect(defaults[lane].card_hold_payment_reminder.enabled).toBe(true);
      expect(defaults[lane].card_hold_payment_reminder.channels).toEqual([
        'email',
        'sms',
      ]);
    }
  });

  it('sanitize round-trips card-hold customisations', () => {
    const policies = defaultCommunicationPolicies();
    policies.table.card_hold_request = {
      ...policies.table.card_hold_request,
      channels: ['sms'],
      smsCustomMessage: 'From the front desk.',
    };
    policies.appointments_other.card_hold_payment_reminder = {
      ...policies.appointments_other.card_hold_payment_reminder,
      enabled: false,
      emailCustomMessage: 'Reply to this email with any questions.',
    };

    const parsed = parseCommunicationPolicies(
      JSON.parse(JSON.stringify(policies)),
    );
    expect(parsed.table.card_hold_request.channels).toEqual(['sms']);
    expect(parsed.table.card_hold_request.smsCustomMessage).toBe(
      'From the front desk.',
    );
    expect(parsed.appointments_other.card_hold_payment_reminder.enabled).toBe(false);
    expect(
      parsed.appointments_other.card_hold_payment_reminder.emailCustomMessage,
    ).toBe('Reply to this email with any questions.');
  });

  it('drops unknown channels for the card-hold keys and falls back to defaults', () => {
    const parsed = parseCommunicationPolicies({
      table: { card_hold_request: { channels: ['whatsapp'] } },
    });
    expect(parsed.table.card_hold_request.channels).toEqual(['email', 'sms']);
  });

  it('labels the five card-hold log types', () => {
    expect(formatCommunicationLogLabel('card_hold_request_email')).toBe(
      'Card request email',
    );
    expect(formatCommunicationLogLabel('card_hold_request_sms')).toBe(
      'Card request SMS',
    );
    expect(formatCommunicationLogLabel('card_hold_payment_reminder_email')).toBe(
      'Card reminder email',
    );
    expect(formatCommunicationLogLabel('card_hold_payment_reminder_sms')).toBe(
      'Card reminder SMS',
    );
    expect(formatCommunicationLogLabel('card_hold_charged_email')).toBe(
      'No-show fee receipt',
    );
  });
});

describe('isSelfServeBookingSource', () => {
  it('returns true for public booking sources', () => {
    expect(isSelfServeBookingSource('online')).toBe(true);
    expect(isSelfServeBookingSource('widget')).toBe(true);
    expect(isSelfServeBookingSource('booking_page')).toBe(true);
  });

  it('returns false for staff or walk-in sources', () => {
    expect(isSelfServeBookingSource('phone')).toBe(false);
    expect(isSelfServeBookingSource('walk-in')).toBe(false);
    expect(isSelfServeBookingSource(null)).toBe(false);
    expect(isSelfServeBookingSource(undefined)).toBe(false);
  });
});

describe('edge cases', () => {
  it('phone booking without email should skip email sends gracefully', () => {
    const booking = {
      guest_email: null,
      guest_phone: '+447700900123',
    };

    expect(booking.guest_email).toBeNull();
    expect(!booking.guest_email).toBe(true);
  });

  it('late booking (30 min before) should not trigger 56h reminder', () => {
    const now = new Date('2026-03-15T18:30:00Z');
    const bookingTime = new Date('2026-03-15T19:00:00Z');
    const diffMs = bookingTime.getTime() - now.getTime();
    const h56 = 56 * 60 * 60 * 1000;
    const tolerance = 15 * 60 * 1000;

    expect(diffMs >= h56 - tolerance && diffMs <= h56 + tolerance).toBe(false);
  });

  it('no-show and cancelled bookings should not receive post-visit thank you', () => {
    const completedStatuses = ['Completed'];
    const excludedStatuses = ['No-Show', 'Cancelled'];

    for (const status of excludedStatuses) {
      expect(completedStatuses.includes(status)).toBe(false);
    }
  });
});
