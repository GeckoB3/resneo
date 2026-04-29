import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Saved payment methods are intentionally gated until Stripe Connect direct-charge
 * PaymentMethod reuse is validated for the final charge architecture.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  return NextResponse.json({
    payment_methods: [],
    capability: 'blocked_connect_direct_charge',
    message:
      'Saved cards are not enabled: MVP deposits use direct charges on each venue Stripe Connect account, while PaymentMethods are account-scoped in Stripe.',
    technical_blocker: {
      summary:
        'A platform-level Stripe Customer / PaymentMethod cannot be attached to PaymentIntents created on arbitrary connected accounts without a chosen pattern (e.g. per-connected-account Customer + SetupIntent, destination charges, or cloning).',
      references: [
        'src/app/api/booking/pay/route.ts (paymentIntents.retrieve with stripeAccount)',
        'Docs/ReserveNI_User_Accounts_Reference.md Section 2.2 (Stripe Connect + saved cards)',
      ],
      required_before_mvp_ui: [
        'Decide storage for Stripe customer id per (user_id, stripe_connected_account_id) or an alternative charge path.',
        'Implement SetupIntent / confirm on the connected account that should own the saved PM.',
        'Wire booking deposit PaymentIntent creation to reuse that PM on the same connected account only.',
      ],
    },
  });
}
