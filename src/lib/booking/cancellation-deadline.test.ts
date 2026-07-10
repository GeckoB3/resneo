import { describe, expect, it } from 'vitest';
import {
  cancellationDeadlineHoursBefore,
  formatRefundDeadlineDisplay,
  isDepositRefundAvailableAt,
} from '@/lib/booking/cancellation-deadline';
import { venueLocalWallTimeToUtcMs } from '@/lib/venue/venue-local-clock';

describe('cancellationDeadlineHoursBefore', () => {
  it('interprets the booking wall time in the venue timezone during BST', () => {
    // Fri 10 Jul 2026 09:30 Europe/London (BST, UTC+1) = 08:30Z.
    // 24h before is Thu 9 Jul 08:30Z, i.e. 09:30 local, NOT 10:30.
    const iso = cancellationDeadlineHoursBefore('2026-07-10', '09:30', 24);
    expect(iso).toBe('2026-07-09T08:30:00.000Z');
  });

  it('matches UTC during GMT (winter)', () => {
    const iso = cancellationDeadlineHoursBefore('2026-01-10', '09:30', 24);
    expect(iso).toBe('2026-01-09T09:30:00.000Z');
  });

  it('handles booking times off the 15-minute grid', () => {
    const iso = cancellationDeadlineHoursBefore('2026-07-10', '09:20', 24);
    expect(iso).toBe('2026-07-09T08:20:00.000Z');
  });

  it('accepts HH:mm:ss times as stored on booking rows', () => {
    const iso = cancellationDeadlineHoursBefore('2026-07-10', '09:30:00', 48);
    expect(iso).toBe('2026-07-08T08:30:00.000Z');
  });

  it('displays the deadline at the same wall-clock time as the booking start', () => {
    const label = formatRefundDeadlineDisplay('2026-07-10', '09:30', 24);
    expect(label).toContain('9 Jul 2026');
    expect(label).toContain('09:30');
  });

  it('gates refunds on the corrected instant', () => {
    const iso = cancellationDeadlineHoursBefore('2026-07-10', '09:30', 24);
    // One minute before the true deadline (08:30Z): still refundable.
    expect(isDepositRefundAvailableAt(iso, new Date('2026-07-09T08:29:00Z'))).toBe(true);
    // The old (wall-time-as-UTC) reading was an hour later; that window is gone.
    expect(isDepositRefundAvailableAt(iso, new Date('2026-07-09T08:31:00Z'))).toBe(false);
  });
});

describe('venueLocalWallTimeToUtcMs', () => {
  it('converts BST and GMT wall times, including off-grid minutes', () => {
    expect(venueLocalWallTimeToUtcMs('2026-07-10', '09:30', 'Europe/London')).toBe(
      Date.parse('2026-07-10T08:30:00Z'),
    );
    expect(venueLocalWallTimeToUtcMs('2026-01-10', '09:30', 'Europe/London')).toBe(
      Date.parse('2026-01-10T09:30:00Z'),
    );
    expect(venueLocalWallTimeToUtcMs('2026-07-10', '09:05', 'Europe/London')).toBe(
      Date.parse('2026-07-10T08:05:00Z'),
    );
  });

  it('maps a nonexistent spring-forward time to the instant the clocks skipped to', () => {
    // Europe/London springs forward 29 Mar 2026: 01:00Z jumps 01:00 -> 02:00 local.
    // 01:30 local never happens; resolve to 01:30Z (02:30 BST) rather than noon.
    expect(venueLocalWallTimeToUtcMs('2026-03-29', '01:30', 'Europe/London')).toBe(
      Date.parse('2026-03-29T01:30:00Z'),
    );
  });
});
