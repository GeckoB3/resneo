'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { EMBED_IFRAME_DEFAULT_HEIGHT_PX } from '@/lib/embed/widget-frame';

interface WidgetSectionProps {
  venueName: string;
  venueSlug: string;
  baseUrl: string;
}

interface CollectiveEmbedOption {
  slug: string;
  name: string;
}

export function WidgetSection({ venueName, venueSlug, baseUrl }: WidgetSectionProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [accentColour, setAccentColour] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** 'venue' = this venue's own page; otherwise a collective slug. */
  const [target, setTarget] = useState<'venue' | string>('venue');
  const [collectives, setCollectives] = useState<CollectiveEmbedOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/venue/collectives');
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        const options: CollectiveEmbedOption[] = (json.collectives ?? [])
          .filter(
            (c: { status: string; myMembershipStatus: string | null; activeMemberCount: number }) =>
              c.status === 'active' &&
              c.myMembershipStatus === 'active' &&
              c.activeMemberCount >= 2,
          )
          .map((c: { slug: string; name: string }) => ({ slug: c.slug, name: c.name }));
        setCollectives(options);
      } catch {
        // Collective embed is optional; ignore failures.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const usingCollective = target !== 'venue';
  const root = baseUrl.replace(/\/$/, '');
  const embedUrl = usingCollective
    ? `${root}/book/c/${target}${accentColour ? `?accent=${accentColour.replace(/^#/, '')}` : ''}`
    : `${root}/embed/${venueSlug}${accentColour ? `?accent=${accentColour.replace(/^#/, '')}` : ''}`;
  const bookUrl = usingCollective
    ? `${root}/book/c/${target}`
    : `${root}/book/${venueSlug}`;
  const snippet = `<iframe src="${embedUrl}" width="100%" height="${EMBED_IFRAME_DEFAULT_HEIGHT_PX}" style="border:none;overflow:hidden;" scrolling="no" id="reserveni-widget"></iframe>
<script src="${baseUrl.replace(/\/$/, '')}/embed/resize.js"></script>`;

  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
    };
  }, []);

  useEffect(() => {
    QRCode.toDataURL(bookUrl, { width: 256, margin: 2 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [bookUrl]);

  const copyEmbed = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopyState('copied');
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
      copyResetRef.current = setTimeout(() => setCopyState('idle'), 2500);
    } catch {
      setCopyState('error');
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
      copyResetRef.current = setTimeout(() => setCopyState('idle'), 4000);
    }
  }, [snippet]);

  const downloadQr = useCallback(() => {
    if (!qrDataUrl || !canvasRef.current) return;
    const canvas = document.createElement('canvas');
    const qrSize = 400;
    const padding = 40;
    const textHeight = 48;
    canvas.width = qrSize + padding * 2;
    canvas.height = qrSize + padding * 2 + textHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, padding, padding, qrSize, qrSize);
      ctx.fillStyle = '#111';
      ctx.font = '24px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(venueName, canvas.width / 2, qrSize + padding + 32);
      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `reserve-ni-qr-${venueSlug}.png`;
      a.click();
    };
    img.src = qrDataUrl;
  }, [qrDataUrl, venueName, venueSlug]);

  return (
    <div className="space-y-8">
      <section className="rounded-lg border border-neutral-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-neutral-900">Embed code</h2>
        <p className="mt-1 text-sm text-neutral-600">
          Add this to your website to show the booking form in an iframe. The widget will resize to fit the content.
        </p>
        {collectives.length > 0 ? (
          <div className="mt-4">
            <label htmlFor="embed-target" className="mb-1 block text-sm font-medium text-neutral-700">
              What to embed
            </label>
            <select
              id="embed-target"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="w-full max-w-sm rounded border border-neutral-300 px-3 py-2 text-sm"
            >
              <option value="venue">My venue only ({venueName})</option>
              {collectives.map((c) => (
                <option key={c.slug} value={c.slug}>
                  Venue collective — {c.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-neutral-500">
              {usingCollective
                ? 'This embeds the combined collective booking page.'
                : 'This embeds only your own venue’s booking flow.'}
            </p>
          </div>
        ) : null}
        <div className="mt-4">
          <label htmlFor="accent" className="block text-sm font-medium text-neutral-700 mb-1">Accent colour (optional)</label>
          <div className="flex items-center gap-2">
            <input
              id="accent"
              type="text"
              value={accentColour}
              onChange={(e) => setAccentColour(e.target.value.replace(/[^a-fA-F0-9#]/g, '').slice(0, 7))}
              placeholder="#4F46E5"
              className="w-32 rounded border border-neutral-300 px-3 py-2 text-sm"
            />
            {accentColour && (
              <div className="h-8 w-8 rounded border border-neutral-300" style={{ backgroundColor: `#${accentColour.replace(/^#/, '')}` }} />
            )}
          </div>
          <p className="mt-1 text-xs text-neutral-500">Hex colour for buttons in the embedded widget (e.g. 4F46E5)</p>
        </div>
        <pre className="mt-4 overflow-x-auto rounded border border-neutral-200 bg-neutral-50 p-4 text-xs text-neutral-800">
          {snippet}
        </pre>
        <div className="mt-3 flex flex-col items-start gap-2">
          <button
            type="button"
            onClick={() => void copyEmbed()}
            className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            {copyState === 'copied' ? 'Copied!' : copyState === 'error' ? 'Copy failed — try again' : 'Copy code'}
          </button>
          <p
            id="embed-copy-feedback"
            className={`text-sm ${copyState === 'copied' ? 'text-emerald-700' : copyState === 'error' ? 'text-red-600' : 'sr-only'}`}
            role="status"
            aria-live="polite"
          >
            {copyState === 'copied'
              ? 'Embed code copied to your clipboard.'
              : copyState === 'error'
                ? 'Clipboard access was denied. Check browser permissions or copy from the box above.'
                : ''}
          </p>
        </div>
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-neutral-900">QR code</h2>
        <p className="mt-1 text-sm text-neutral-600">
          Link to your booking page. Suitable for table cards, menus, or window stickers.
        </p>
        <div className="mt-4 flex flex-col items-center gap-4">
          {qrDataUrl && (
            <>
              <img src={qrDataUrl} alt="QR code" className="h-64 w-64 rounded border border-neutral-200" />
              <canvas ref={canvasRef} className="hidden" />
              <button
                type="button"
                onClick={downloadQr}
                className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
              >
                Download QR code
              </button>
              <p className="text-center text-sm text-neutral-500">{venueName}</p>
            </>
          )}
          {!qrDataUrl && <p className="text-sm text-neutral-500">Generating QR code…</p>}
        </div>
      </section>
    </div>
  );
}
