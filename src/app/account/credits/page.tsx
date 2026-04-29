export default function AccountCreditsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">Credits</h1>
      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
        <span className="font-semibold">Not in the current MVP.</span> This page is a placeholder until credit packs
        are modelled for your venues.
      </p>
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/80 p-5">
        <p className="text-sm text-slate-700">
          When enabled, venue credit balances and expiry warnings will appear here. Nothing is stored or charged from
          this screen yet.
        </p>
      </div>
    </div>
  );
}
