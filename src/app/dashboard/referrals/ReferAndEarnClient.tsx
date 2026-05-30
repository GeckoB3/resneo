'use client';

import { useState } from 'react';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';

interface ReferAndEarnClientProps {
  code: string;
  shareableLink: string;
  rewardDisplay: string;
}

export function ReferAndEarnClient({
  code,
  shareableLink,
  rewardDisplay,
}: ReferAndEarnClientProps) {
  const [copied, setCopied] = useState<null | 'code' | 'link'>(null);

  function copyToClipboard(value: string, which: 'code' | 'link') {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    void navigator.clipboard.writeText(value).then(
      () => {
        setCopied(which);
        setTimeout(() => setCopied((current) => (current === which ? null : current)), 1500);
      },
      () => {
        // Clipboard access denied. Fall back silently — the value is also visible/selectable.
      },
    );
  }

  return (
    <SectionCard elevated>
      <SectionCard.Body>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-[1fr_1fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Your referral code</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-lg font-mono font-semibold text-slate-900 select-all">
                {code || '—'}
              </code>
              <button
                type="button"
                onClick={() => code && copyToClipboard(code, 'code')}
                disabled={!code}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {copied === 'code' ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Both you and the venue you refer get a free month worth {rewardDisplay} of credit. Your reward is
              applied to your next Resneo invoice once their first paid month settles.
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Shareable link</p>
            <div className="mt-2 flex items-center gap-2">
              <input
                readOnly
                value={shareableLink}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              />
              <button
                type="button"
                onClick={() => shareableLink && copyToClipboard(shareableLink, 'link')}
                disabled={!shareableLink}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {copied === 'link' ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        </div>
      </SectionCard.Body>
      <SectionCard.Footer>
        <p className="text-xs text-slate-500">
          How it works: share your link → they get 14 days trial + 30 free days → on their first paid invoice
          you get {rewardDisplay} credit on your next Resneo invoice.
        </p>
      </SectionCard.Footer>
    </SectionCard>
  );
}
