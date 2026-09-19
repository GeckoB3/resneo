import { describe, expect, it } from 'vitest';
import { columnsMissingFromMigrations } from '@/lib/testing/migration-columns';
import type { RecordedCall } from '@/lib/testing/recording-supabase';
import { BROADCAST_COLUMNS } from './broadcast-send';

const read = (table: string, columns: string, filters: RecordedCall['filters'] = []): RecordedCall => ({
  table,
  op: 'select',
  columns,
  filters,
});

/**
 * Every column the Contact Users code reads must exist in the migrations. Unit tests with a fake
 * client pass whatever is selected, so a typo here would otherwise first show up as an empty page.
 */
describe('Contact Users queries only name real columns', () => {
  it('audience, broadcasts, recipients and opt-outs', () => {
    expect(
      columnsMissingFromMigrations([
        read(
          'venues',
          'id, name, slug, email, pricing_tier, plan_status, billing_access_source, subscription_current_period_end, is_test',
          [['order', 'id', { ascending: true }]],
        ),
        read('staff', 'venue_id, name, email', [
          ['eq', 'role', 'admin'],
          ['is', 'revoked_at', null],
          ['order', 'id', { ascending: true }],
        ]),
        read('platform_email_opt_outs', 'email, opted_out_at, broadcast_id'),
        read('platform_broadcasts', BROADCAST_COLUMNS, [['order', 'updated_at', { ascending: false }]]),
        read(
          'platform_broadcast_recipients',
          'id, broadcast_id, email, first_name, venue_ids, venue_names, status, provider_message_id, error, sent_at',
        ),
      ]),
    ).toEqual([]);
  });
});
