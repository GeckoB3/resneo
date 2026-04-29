export default function AccountMembershipsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">Memberships</h1>
      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
        <span className="font-semibold">Not in the current MVP.</span> Memberships, courses, and recurring bookings
        stay out of scope until their product models ship.
      </p>
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/80 p-5">
        <p className="text-sm text-slate-700">
          When enabled, subscriptions, course enrolments, and pause/cancel actions for linked venues will appear here.
        </p>
      </div>
    </div>
  );
}
