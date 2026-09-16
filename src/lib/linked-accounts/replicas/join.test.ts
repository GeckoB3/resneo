/**
 * Joining a shared-services collective (plan contract 6; UX spec `join.*`).
 *
 * The preview must match names the one way the engine does, leave out services the venue already
 * holds as copies, and say in words why a venue cannot join. The join itself needs the consent the
 * venue was shown, sends its answers to the engine unchanged, and tells the right venues.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb, type Responder } from '@/lib/testing/recording-supabase';

const notifyVenue = vi.fn(async () => ({ emailFailures: 0 }));
vi.mock('@/lib/linked-accounts/notifications', () => ({
  notifyVenue: (...args: unknown[]) => notifyVenue(...(args as [])),
}));
const recordBell = vi.fn(async () => undefined);
vi.mock('@/lib/linked-accounts/replicas/collective-notices', () => ({
  recordBell: (...args: unknown[]) => recordBell(...(args as [])),
}));
const applyLinksInline = vi.fn(async () => ({ applied: 0, deferred: 0 }));
vi.mock('@/lib/linked-accounts/replicas/inline-apply', () => ({
  applyLinksInline: (...args: unknown[]) => applyLinksInline(...(args as [])),
}));

import { JOIN_CONSENT_VERSION } from './hosting-constants';
import { joinBlockerWords, loadJoinPreview, runJoin, sameName, type JoinContext } from './join';

const COLLECTIVE = 'collective-1';
const HOST = 'venue-host';
const ME = 'venue-me';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

interface WorldOptions {
  model?: string;
  blocker?: string | null;
  meStripe?: boolean;
  meFlags?: Record<string, unknown>;
}

function world({ model = 'replicas', blocker = null, meStripe = true, meFlags = {} }: WorldOptions = {}): Responder {
  return (call) => {
    if (call.table === 'venue_collectives') {
      return { data: { id: COLLECTIVE, name: 'Northside', host_venue_id: HOST, service_model: model, status: 'active' } };
    }
    if (call.table === 'rpc:collective_join_blocker') return { data: blocker };
    if (call.table === 'rpc:collective_join_member') {
      return { data: { links: [{ link_id: 'link-1' }, { link_id: 'link-2' }], operation_id: 'op-1' } };
    }
    if (call.table === 'venues') {
      return {
        data: [
          { id: HOST, name: 'Host Venue', timezone: 'Europe/London', currency: 'GBP', stripe_charges_enabled: true, feature_flags: {} },
          { id: ME, name: 'Zen Studio', timezone: 'Europe/Paris', currency: 'GBP', stripe_charges_enabled: meStripe, feature_flags: meFlags },
        ],
      };
    }
    if (call.table === 'collective_service_items') {
      return { data: [{ id: 'item-cut', master_service_id: 'master-cut' }, { id: 'item-dye', master_service_id: 'master-dye' }] };
    }
    if (call.table === 'service_items') {
      const mine = call.filters.some((f) => f[0] === 'eq' && f[1] === 'venue_id');
      if (mine) {
        return {
          data: [
            { id: 'mine-cut', name: '  haircut ' },
            { id: 'mine-nails', name: 'Nails' },
            { id: 'mine-copy', name: 'Massage' },
          ],
        };
      }
      const asked = call.filters.some((f) => f[0] === 'in' && f[1] === 'id' && (f[2] as string[]).includes(uuid(9)));
      if (asked) return { data: [{ id: uuid(9), name: 'Nails' }] };
      return {
        data: [
          { id: 'master-cut', name: 'Haircut', payment_requirement: 'deposit' },
          { id: 'master-dye', name: 'Colour', payment_requirement: 'none' },
        ],
      };
    }
    if (call.table === 'collective_service_replicas') return { data: [{ replica_service_id: 'mine-copy' }] };
    if (call.table === 'service_variants') {
      return {
        data: [
          { id: 'my-short', name: 'Short', service_item_id: 'mine-cut', is_active: true },
          { id: 'my-old', name: 'Old', service_item_id: 'mine-cut', is_active: false },
          { id: 'host-short', name: 'Short', service_item_id: 'master-cut', is_active: true },
        ],
      };
    }
    if (call.table === 'service_compliance_requirements') {
      return { data: [{ service_item_id: 'master-cut', compliance_types: { id: 'host-patch', name: 'Patch test' } }] };
    }
    if (call.table === 'compliance_types') {
      return {
        data: [
          { id: 'my-patch', name: 'patch test', managed_by_collective_id: null },
          { id: 'other-copy', name: 'Patch test', managed_by_collective_id: 'someone' },
        ],
      };
    }
    if (call.table === 'venue_collective_members') {
      return { data: [{ venue_id: HOST }, { venue_id: ME }, { venue_id: 'venue-third' }] };
    }
    return undefined;
  };
}

beforeEach(() => {
  notifyVenue.mockClear();
  recordBell.mockClear();
  applyLinksInline.mockClear();
});

describe('sameName', () => {
  it('ignores case and surrounding spaces, as the engine does', () => {
    expect(sameName('  Haircut ')).toBe(sameName('haircut'));
    expect(sameName(null)).toBe('');
  });
});

describe('joinBlockerWords', () => {
  it('names the two timezones', () => {
    expect(
      joinBlockerWords('timezone', { collective: 'Northside', yourTimezone: 'Europe/Paris', timezone: 'Europe/London' }),
    ).toBe(
      'You cannot join because your venue is in Europe/Paris and Northside is in Europe/London. Change your timezone under Profile first.',
    );
  });

  it('has a sentence for every blocker the engine returns', () => {
    for (const blocker of ['exclusivity', 'currency', 'booking_model', 'mesh', 'not_found']) {
      expect(joinBlockerWords(blocker, { collective: 'Northside' })).toMatch(/\.$/);
    }
    expect(joinBlockerWords(null, { collective: 'Northside' })).toBeNull();
  });
});

describe('loadJoinPreview', () => {
  const load = (options?: WorldOptions) =>
    loadJoinPreview(makeRecordingDb(world(options)).db as unknown as SupabaseClient, COLLECTIVE, ME);

  it('is only for shared-services collectives', async () => {
    expect(await load({ model: 'offerings' })).toBeNull();
  });

  it('pairs services by name and leaves the rest, not the copies, to choose about', async () => {
    const preview = (await load())!;
    expect(preview.consent_version).toBe(JOIN_CONSENT_VERSION);
    expect(preview.services_to_set_up).toBe(2);
    expect(preview.same_name).toEqual([
      {
        item_id: 'item-cut',
        host_service_id: 'master-cut',
        name: 'Haircut',
        my_service_id: 'mine-cut',
        my_options: [{ id: 'my-short', name: 'Short' }],
        host_options: [{ id: 'host-short', name: 'Short' }],
      },
    ]);
    expect(preview.own_services).toEqual([{ id: 'mine-nails', name: 'Nails' }]);
  });

  it("offers the venue's own form of the same name, never another collective's copy", async () => {
    const preview = (await load())!;
    expect(preview.forms).toEqual([{ host_type_id: 'host-patch', name: 'Patch test', my_type_id: 'my-patch' }]);
  });

  it('warns about paid services without Stripe, and forms that are off', async () => {
    const preview = (await load({ meStripe: false }))!;
    expect(preview.warnings).toEqual({ no_stripe_paid_services: 1, form_services: 1, forms_off: true });
    const connected = (await load({ meFlags: { compliance_records_enabled: true } }))!;
    expect(connected.warnings.no_stripe_paid_services).toBe(0);
  });

  it('says why the venue cannot join', async () => {
    const preview = (await load({ blocker: 'timezone' }))!;
    expect(preview.blocked).toContain('your venue is in Europe/Paris and Northside is in Europe/London');
  });
});

describe('runJoin', () => {
  const join = (input: Parameters<typeof runJoin>[1], options?: WorldOptions) => {
    const recording = makeRecordingDb(world(options));
    const ctx: JoinContext = {
      admin: recording.db as unknown as SupabaseClient,
      collectiveId: COLLECTIVE,
      collectiveName: 'Northside',
      hostVenueId: HOST,
      memberId: 'membership-1',
      venueId: ME,
      venueName: 'Zen Studio',
      userId: 'user-1',
    };
    return { calls: recording.calls, result: runJoin(ctx, input) };
  };
  const engineCalls = (calls: ReturnType<typeof makeRecordingDb>['calls']) =>
    calls.filter((c) => c.table === 'rpc:collective_join_member');

  it('needs the consent the venue was shown', async () => {
    const { calls, result } = join({ consent_version: 'join-2020-01' });
    const response = (await result)!;
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'COLLECTIVE_CONSENT_REQUIRED' });
    expect(engineCalls(calls)).toHaveLength(0);
  });

  it('needs to know which service to use', async () => {
    const { result } = join({
      consent_version: JOIN_CONSENT_VERSION,
      same_name_choices: [{ item_id: 'item-cut', choice: 'use_mine' }],
    });
    expect((await result)!.status).toBe(400);
  });

  it('refuses in words when something stops the venue joining', async () => {
    const { calls, result } = join({ consent_version: JOIN_CONSENT_VERSION }, { blocker: 'mesh' });
    const response = (await result)!;
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('account links with every venue in Northside');
    expect(engineCalls(calls)).toHaveLength(0);
  });

  it('sends the answers to the engine, sets up the first copies and tells the others', async () => {
    const choices = {
      same_name_choices: [
        {
          item_id: 'item-cut',
          choice: 'use_mine' as const,
          my_service_id: 'mine-cut',
          option_map: [{ my_variant_id: 'my-short', host_variant_id: 'host-short' }],
        },
      ],
      own_service_choices: [
        { service_id: uuid(9), choice: 'ask' as const },
        { service_id: uuid(8), choice: 'park' as const },
      ],
    };
    const { calls, result } = join({ consent_version: JOIN_CONSENT_VERSION, ...choices });
    expect(await result).toBeNull();

    expect(engineCalls(calls)[0]!.payload).toEqual({
      p_member_id: 'membership-1',
      p_consent_version: JOIN_CONSENT_VERSION,
      p_choices: { ...choices, form_choices: [] },
      p_actor_venue_id: ME,
      p_actor_user_id: 'user-1',
    });
    expect(applyLinksInline).toHaveBeenCalledWith(expect.anything(), ['link-1', 'link-2'], expect.objectContaining({ job: 'collective-join' }));

    // N3: the host by email, the third venue by bell, never the joiner. N28: the host, per ask.
    const emails = notifyVenue.mock.calls.map((c) => (c as unknown as [unknown, string, string])).map((c) => [c[1], c[2]]);
    expect(emails).toEqual([
      [HOST, 'Zen Studio joined Northside'],
      [HOST, 'Zen Studio suggests Nails for Northside'],
    ]);
    expect(recordBell.mock.calls.map((c) => (c as unknown as [unknown, string])[1])).toEqual(['venue-third']);
  });
});
