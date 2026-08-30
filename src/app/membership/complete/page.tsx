import Link from 'next/link';

/**
 * Where a membership card confirmation lands (P0-17, closes C9).
 *
 * PUBLIC ON PURPOSE. The old hosted-Checkout `success_url` was
 * `/account/memberships?checkout=success`, which middleware protects: in an app
 * webview with no cookie it resolved no user and redirected to `/login`, so a
 * customer who had just subscribed was shown a sign-in page and reasonably
 * concluded the payment had failed. This page is outside `/account` so it
 * renders for anyone, cookie or not.
 *
 * It says the membership is being set up rather than that it is active,
 * because at this point it genuinely is: the card is confirmed and the
 * subscription is created by the `setup_intent.succeeded` webhook moments
 * later. Claiming it is ready and then showing an empty list would be worse
 * than saying what is true.
 */
export const metadata = {
  title: 'Membership confirmed',
};

export default function MembershipCompletePage() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col justify-center px-6 py-16">
      <div className="rounded-2xl border border-slate-200/80 bg-white p-7 text-center shadow-sm shadow-slate-900/5">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
          <svg
            className="h-6 w-6 text-emerald-600"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
        </div>
        <h1 className="mt-4 text-xl font-semibold text-slate-900">Your card is confirmed</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          We are setting up your membership now. It usually takes a few seconds. You will get a receipt by
          email, and the membership will appear in your account.
        </p>
        <Link
          // The retired path still 307s here (P1-5), but this is the 3DS
          // return page: the customer has just been through a card challenge,
          // and sending them through a redirect hop as well is a wait they do
          // not need. Linked directly for that reason.
          href="/account/passes?tab=memberships"
          className="mt-6 inline-flex min-h-10 items-center justify-center rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
        >
          View my memberships
        </Link>
        <p className="mt-3 text-xs text-slate-500">
          You may be asked to sign in first. Your membership is not affected either way.
        </p>
      </div>
    </main>
  );
}
