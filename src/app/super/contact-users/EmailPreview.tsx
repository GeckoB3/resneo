'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  html: string;
  subject: string;
  preheader: string;
  /** Extra controls on the right of the toolbar (e.g. "Preview as"). */
  toolbar?: React.ReactNode;
  className?: string;
}

/**
 * The rendered email in a sandboxed frame (no scripts; same-origin only so the frame can be sized
 * to its content), under an inbox-style header showing sender, subject and preview text.
 */
export function EmailPreview({ html, subject, preheader, toolbar, className }: Props) {
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(900);

  const measure = useCallback(() => {
    const doc = frame.current?.contentDocument;
    if (!doc?.documentElement) return;
    const h = Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0);
    if (h > 0) setHeight(h);
  }, []);

  useEffect(() => {
    // Fonts and images settle after load; measure a couple more times.
    const t1 = window.setTimeout(measure, 150);
    const t2 = window.setTimeout(measure, 700);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [html, device, measure]);

  return (
    <div className={`overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ${className ?? ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
        <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-xs font-semibold">
          {(['desktop', 'mobile'] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDevice(d)}
              className={`rounded-md px-3 py-1 ${device === d ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {d === 'desktop' ? 'Desktop' : 'Phone'}
            </button>
          ))}
        </div>
        {toolbar}
      </div>

      <div className="flex items-start gap-3 border-b border-slate-100 bg-white px-4 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#003B6F] text-sm font-bold text-white">
          R
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-semibold text-slate-900">
              ResNeo <span className="font-normal text-slate-400">&lt;hello@resneo.com&gt;</span>
            </p>
            <span className="shrink-0 text-[11px] text-slate-400">now</span>
          </div>
          <p className="truncate text-sm font-medium text-slate-800">{subject || 'No subject yet'}</p>
          <p className="truncate text-xs text-slate-500">{preheader}</p>
        </div>
      </div>

      <div className="bg-[#F4F0E9]">
        <div className={device === 'mobile' ? 'mx-auto w-[375px] max-w-full border-x border-slate-200/70' : 'w-full'}>
          <iframe
            ref={frame}
            title="Email preview"
            srcDoc={html}
            sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            onLoad={measure}
            style={{ height }}
            className="block w-full border-0"
          />
        </div>
      </div>
    </div>
  );
}
