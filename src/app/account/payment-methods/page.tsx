export default function AccountPaymentMethodsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">Payment methods</h1>
      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
        <span className="font-semibold">Not in the current MVP.</span> Saved cards are blocked by the current Stripe
        Connect direct-charge architecture until a per-venue SetupIntent flow is specified.
      </p>
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/80 p-5">
        <p className="text-sm text-slate-700">
          Deposits use <span className="font-medium">direct charges</span> on each venue&apos;s connected Stripe
          account. A platform-wide saved card cannot be reused across arbitrary connected accounts without a deliberate
          extra step (for example saving a card per venue, or changing how charges are routed).
        </p>
        <p className="mt-3 text-sm text-slate-600">
          See the user accounts reference (Section 2.2) for the full technical note.
        </p>
      </div>
    </div>
  );
}
