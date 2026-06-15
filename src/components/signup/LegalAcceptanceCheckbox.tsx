'use client';

export function LegalAcceptanceCheckbox({
  accepted,
  onChange,
}: {
  accepted: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <input
        type="checkbox"
        checked={accepted}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
      />
      <span className="text-xs leading-relaxed text-slate-600">
        By signing up, I confirm I have authority to act for this business and agree to the ResNeo{' '}
        <a
          href="/terms/customer"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-brand-600 underline hover:text-brand-700"
          onClick={(e) => e.stopPropagation()}
        >
          customer terms
        </a>
        {', '}
        <a
          href="/terms/data-processing"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-brand-600 underline hover:text-brand-700"
          onClick={(e) => e.stopPropagation()}
        >
          data processing terms
        </a>
        {', '}
        <a
          href="/terms"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-brand-600 underline hover:text-brand-700"
          onClick={(e) => e.stopPropagation()}
        >
          Website Terms of Use
        </a>
        {' and '}
        <a
          href="/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-brand-600 underline hover:text-brand-700"
          onClick={(e) => e.stopPropagation()}
        >
          Privacy Policy
        </a>
        .
      </span>
    </label>
  );
}
