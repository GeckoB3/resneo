'use client';

/**
 * The staff opt-in for collecting money at the end of a booking flow.
 *
 * Staff are always allowed to take a booking without charging for it: they take
 * payment at the counter, on account, or not at all, and that is a per-booking
 * call. So this is an opt-IN, unchecked by default, and leaving it unchecked
 * confirms the booking there and then with no payment step.
 *
 * It covers both chargeable labels. `full_payment` used to be forced on with no
 * control at all, which meant a pay-in-full service simply could not be taken
 * over the phone: the booking landed `Pending` and stayed there.
 *
 * Card holds are a separate decision with the opposite default (on) and their
 * own control, `StaffCardHoldToggle`.
 */
export function StaffRequireChargeCheckbox({
  checked,
  onChange,
  chargeLabel,
  amountPence,
  currencySymbol,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  chargeLabel: 'deposit' | 'full_payment';
  amountPence: number;
  currencySymbol: string;
  className?: string;
}) {
  const noun = chargeLabel === 'full_payment' ? 'payment' : 'deposit';
  const amount = `${currencySymbol}${(amountPence / 100).toFixed(2)}`;

  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50 ${className ?? ''}`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
      />
      <span className="text-sm text-slate-700">
        <span className="font-medium">
          Require {noun} ({amount})
        </span>
        <span className="mt-0.5 block text-xs text-slate-500">
          {checked
            ? `We will send a payment link and hold the booking until the ${noun} is paid.`
            : `Leave unchecked to confirm the booking now and take the ${noun} in person.`}
        </span>
      </span>
    </label>
  );
}
