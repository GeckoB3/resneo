import { describe, expect, it } from 'vitest';
import { FakeSupabase } from '@/lib/compliance/test-utils/fake-supabase';
import { loadComplianceDashboard } from '@/lib/compliance/dashboard-service';

/**
 * The "Expiring soon" panel is a chase list: records whose validity is running out and
 * which someone has to renew. Per-visit records (validity 0) run to the end of the
 * appointment day by design, so every one of them falls inside the 30-day window. Listing
 * them buries the records that genuinely need chasing.
 */

const VENUE = 'venue-1';
const NOW = new Date('2027-06-01T09:00:00Z');
const inDays = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

function recordRow(id: string, validityPeriodDays: number | null, name: string) {
  return {
    id,
    venue_id: VENUE,
    guest_id: 'g1',
    compliance_type_id: `type-${id}`,
    status: 'completed',
    voided_at: null,
    expires_at: inDays(4),
    result: 'signed',
    compliance_types: { name, validity_period_days: validityPeriodDays },
    guests: { first_name: 'Jane', last_name: 'Doe', name: 'Jane Doe' },
  };
}

function seed() {
  return new FakeSupabase({
    venues: [{ id: VENUE, timezone: 'Europe/London' }],
    compliance_records: [
      recordRow('per-visit', 0, 'Treatment Consent'),
      recordRow('patch-test', 90, 'Patch Test'),
    ],
    compliance_form_links: [],
    bookings: [],
  });
}

describe('loadComplianceDashboard — expiring soon', () => {
  it('lists the record that needs renewing and omits the per-visit one', async () => {
    const data = await loadComplianceDashboard(seed().asClient(), VENUE, NOW);
    expect(data.expiring_soon.map((r) => r.id)).toEqual(['patch-test']);
    expect(data.expiring_soon[0]!.compliance_type_name).toBe('Patch Test');
  });

  it('resolves "today" in the venue timezone', async () => {
    const data = await loadComplianceDashboard(seed().asClient(), VENUE, NOW);
    expect(data.today).toBe('2027-06-01');
  });
});
