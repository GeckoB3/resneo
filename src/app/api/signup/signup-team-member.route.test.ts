/**
 * A team member at someone else's venue could pay for a subscription and get no venue.
 *
 * create-checkout only recognised OWNED venues (active admin rows), so a non-admin staff
 * member was sent to Stripe; then /api/signup/complete and the subscription webhook read
 * ANY staff row for the email (any role, even revoked) as "already provisioned" and
 * created nothing. A second venue is not the answer either: a login at two venues cannot
 * open either dashboard (D38). So checkout refuses, the paid paths never mistake a staff
 * row for this signup's venue, and a revoked (former) team member can sign up normally.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.hoisted(() => {
  process.env.STRIPE_APPOINTMENTS_PRO_PRICE_ID = 'price_pro_test';
  process.env.STRIPE_ONBOARDING_WEBHOOK_SECRET = 'whsec_vitest';
});

vi.mock('stripe', () => {
  const StripeMock = class {} as unknown as { webhooks: { constructEvent: ReturnType<typeof vi.fn> } };
  StripeMock.webhooks = { constructEvent: vi.fn() };
  return { default: StripeMock };
});
vi.mock('@/lib/stripe', () => ({
  stripe: {
    customers: { list: vi.fn(), create: vi.fn() },
    checkout: { sessions: { create: vi.fn(), retrieve: vi.fn() } },
    subscriptions: { retrieve: vi.fn() },
  },
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: vi.fn() }));
vi.mock('@/lib/webhooks/stripe-event-idempotency', () => ({
  claimStripeWebhookEvent: vi.fn(async () => 'claimed'),
  markStripeWebhookEventProcessed: vi.fn(async () => undefined),
  releaseStripeWebhookEvent: vi.fn(async () => undefined),
}));
vi.mock('@/lib/signup-pending-metadata', () => ({ clearSignupPendingUserMetadata: vi.fn(async () => undefined) }));
vi.mock('@/lib/billing/sms-allowance', () => ({ updateVenueSmsMonthlyAllowance: vi.fn(async () => undefined) }));
vi.mock('@/lib/emails/internal-signup-notification', () => ({ sendNewSignupNotification: vi.fn(async () => undefined) }));
vi.mock('@/lib/emails/welcome-email', () => ({ sendWelcomeEmail: vi.fn(async () => undefined) }));

import Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { columnsMissingFromMigrations } from '@/lib/testing/migration-columns';
import { makeRecordingDb, type RecordedCall, type Responder } from '@/lib/testing/recording-supabase';
import { POST as createCheckout } from './create-checkout/route';
import { POST as complete } from './complete/route';
import { POST as subscriptionWebhook } from '../webhooks/stripe-subscription/route';

const USER_ID = 'auth-user-1';
const EMAIL = 'person@example.test';
const OTHER_VENUE = 'venue-a';
const CUSTOMER = 'cus_new';

type StaffRow = { venue_id: string; email: string; user_id: string | null; role: 'admin' | 'staff'; revoked_at: string | null };

const teamMember: StaffRow = { venue_id: OTHER_VENUE, email: EMAIL, user_id: USER_ID, role: 'staff', revoked_at: null };
const formerTeamMember: StaffRow = { ...teamMember, revoked_at: '2026-06-01T00:00:00Z' };
const owner: StaffRow = { ...teamMember, role: 'admin' };

/** Applies the recorded eq / ilike / is filters to staff rows, so the routes' real filters decide. */
function staffMatching(rows: StaffRow[], call: RecordedCall): StaffRow[] {
  return rows.filter((row) =>
    call.filters.every(([op, column, value]) => {
      const cell = (row as Record<string, unknown>)[column as string];
      if (op === 'eq') return cell === value;
      if (op === 'is') return cell === value;
      if (op === 'ilike') return String(cell).toLowerCase() === String(value).toLowerCase();
      return true;
    }),
  );
}

function world(opts: { staff: StaffRow[]; customerVenue?: boolean }) {
  const responder: Responder = (call) => {
    if (call.table === 'staff' && call.op === 'select') {
      const rows = staffMatching(opts.staff, call);
      return { data: rows, count: rows.length };
    }
    if (call.table === 'venues' && call.op === 'select') {
      if (call.filters.some((f) => f[0] === 'eq' && f[1] === 'stripe_customer_id')) {
        return { data: opts.customerVenue ? { pricing_tier: 'appointments', active_booking_models: [], onboarding_completed: false } : null };
      }
      if (call.filters.some((f) => f[0] === 'eq' && f[1] === 'id' && f[2] === OTHER_VENUE)) {
        return { data: { pricing_tier: 'appointments', active_booking_models: ['unified_scheduling'], onboarding_completed: true } };
      }
      return undefined;
    }
    if (call.table === 'venues' && call.op === 'insert') return { data: { id: 'venue-new' } };
    return undefined;
  };
  const rec = makeRecordingDb(responder);
  const auth = {
    admin: {
      getUserById: vi.fn(async () => ({ data: { user: { id: USER_ID, email: EMAIL } }, error: null })),
    },
  };
  const db = Object.assign(rec.db, { auth }) as unknown as SupabaseClient;
  vi.mocked(getSupabaseAdminClient).mockReturnValue(db as never);
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: USER_ID, email: EMAIL } } })) },
  } as never);
  return rec;
}

function jsonPost(path: string, body: Record<string, unknown>) {
  return new Request(`http://localhost${path}`, { method: 'POST', body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(stripe.customers.list).mockResolvedValue({ data: [{ id: CUSTOMER }] } as never);
  vi.mocked(stripe.checkout.sessions.create).mockResolvedValue({ url: 'https://checkout.stripe.test/s' } as never);
  vi.mocked(stripe.checkout.sessions.retrieve).mockResolvedValue({
    id: 'cs_1',
    payment_status: 'paid',
    status: 'complete',
    customer: CUSTOMER,
    subscription: null,
    customer_details: { email: EMAIL },
    metadata: { supabase_user_id: USER_ID, plan: 'appointments', business_type: 'other' },
  } as never);
});

const TEAM_MEMBER_MESSAGE = `${EMAIL} is already a team member at a ResNeo venue. To create your own business, sign up with a different email address.`;

describe('POST /api/signup/create-checkout', () => {
  it('refuses a team member at another venue before touching Stripe', async () => {
    const rec = world({ staff: [teamMember] });

    const res = await createCheckout(jsonPost('/api/signup/create-checkout', { plan: 'appointments' }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: TEAM_MEMBER_MESSAGE, code: 'SIGNUP_EMAIL_IS_TEAM_MEMBER' });
    expect(stripe.customers.list).not.toHaveBeenCalled();
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect(columnsMissingFromMigrations(rec.calls)).toEqual([]);
  });

  it('refuses when the row is found only by auth user id (its email is stale)', async () => {
    world({ staff: [{ ...teamMember, email: 'old-address@example.test' }] });

    const res = await createCheckout(jsonPost('/api/signup/create-checkout', { plan: 'appointments' }));

    expect(res.status).toBe(409);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('refuses the free Founding path too, before creating a venue', async () => {
    const rec = world({ staff: [teamMember] });

    const res = await createCheckout(
      jsonPost('/api/signup/create-checkout', { plan: 'founding', business_type: 'restaurant' }),
    );

    expect(res.status).toBe(409);
    expect(rec.queryCount({ table: 'venues', op: 'insert' })).toBe(0);
    expect(rec.queryCount({ table: 'staff', op: 'insert' })).toBe(0);
  });

  it('lets a former (revoked) team member go to checkout', async () => {
    world({ staff: [formerTeamMember] });

    const res = await createCheckout(jsonPost('/api/signup/create-checkout', { plan: 'appointments' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ redirect_url: 'https://checkout.stripe.test/s' });
    expect(stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
  });

  it('still sends an owner back to their own venue', async () => {
    world({ staff: [owner] });

    const res = await createCheckout(jsonPost('/api/signup/create-checkout', { plan: 'appointments' }));

    expect(await res.json()).toEqual({ redirect_url: '/onboarding' });
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/signup/complete', () => {
  it('does not send a paid team member into the other venue, and says what to do', async () => {
    const rec = world({ staff: [teamMember] });

    const res = await complete(jsonPost('/api/signup/complete', { session_id: 'cs_1' }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: `${EMAIL} is already a team member at a ResNeo venue, so we could not set up a new business with it. Please email support@resneo.com and we will cancel this subscription for you.`,
      code: 'SIGNUP_EMAIL_IS_TEAM_MEMBER',
    });
    expect(rec.queryCount({ table: 'venues', op: 'insert' })).toBe(0);
    expect(rec.queryCount({ table: 'staff', op: 'insert' })).toBe(0);
    expect(columnsMissingFromMigrations(rec.calls)).toEqual([]);
  });

  it('creates the venue for a former (revoked) team member', async () => {
    const rec = world({ staff: [formerTeamMember] });

    const res = await complete(jsonPost('/api/signup/complete', { session_id: 'cs_1' }));

    expect(await res.json()).toEqual({ redirect_url: '/signup/booking-models' });
    expect(rec.queryCount({ table: 'venues', op: 'insert' })).toBe(1);
    const staffInsert = rec.calls.find((c) => c.table === 'staff' && c.op === 'insert');
    expect(staffInsert?.payload).toMatchObject({ venue_id: 'venue-new', role: 'admin', user_id: USER_ID });
    expect(columnsMissingFromMigrations(rec.calls)).toEqual([]);
  });

  it('resumes without creating anything when the webhook already provisioned this customer', async () => {
    const rec = world({ staff: [], customerVenue: true });

    const res = await complete(jsonPost('/api/signup/complete', { session_id: 'cs_1' }));

    expect(await res.json()).toEqual({ redirect_url: '/signup/booking-models' });
    expect(rec.queryCount({ table: 'venues', op: 'insert' })).toBe(0);
  });
});

describe('POST /api/webhooks/stripe-subscription checkout.session.completed', () => {
  function deliver() {
    vi.mocked(
      (Stripe as unknown as { webhooks: { constructEvent: ReturnType<typeof vi.fn> } }).webhooks.constructEvent,
    ).mockReturnValue({
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_1',
          mode: 'subscription',
          customer: CUSTOMER,
          subscription: null,
          metadata: { supabase_user_id: USER_ID, plan: 'appointments', business_type: 'other' },
        },
      },
    });
    return subscriptionWebhook(
      new NextRequest('http://localhost/api/webhooks/stripe-subscription', {
        method: 'POST',
        body: '{}',
        headers: { 'stripe-signature': 't=1,v1=x' },
      }),
    );
  }

  it('creates nothing for a team member, and logs it for support', async () => {
    const rec = world({ staff: [teamMember] });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await deliver();

    expect(res.status).toBe(200);
    expect(rec.queryCount({ table: 'venues', op: 'insert' })).toBe(0);
    expect(rec.queryCount({ table: 'staff', op: 'insert' })).toBe(0);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('no venue created'),
      expect.objectContaining({ userId: USER_ID, stripeCustomerId: CUSTOMER }),
    );
    expect(columnsMissingFromMigrations(rec.calls)).toEqual([]);
    errorSpy.mockRestore();
  });

  it('provisions a former (revoked) team member', async () => {
    const rec = world({ staff: [formerTeamMember] });

    await deliver();

    expect(rec.queryCount({ table: 'venues', op: 'insert' })).toBe(1);
    expect(rec.calls.find((c) => c.table === 'staff' && c.op === 'insert')?.payload).toMatchObject({
      role: 'admin',
      user_id: USER_ID,
    });
    expect(columnsMissingFromMigrations(rec.calls)).toEqual([]);
  });

  it('still skips an owner', async () => {
    const rec = world({ staff: [owner] });

    await deliver();

    expect(rec.queryCount({ table: 'venues', op: 'insert' })).toBe(0);
  });
});
