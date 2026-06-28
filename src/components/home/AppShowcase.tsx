import type { CSSProperties } from 'react';
import { HomeReveal } from '@/components/home/HomeReveal';
import { BookingConfirmedCard, DepositCard } from '@/components/home/HomeGraphics';

/* ────────────────────────────────────────────────────────────────────────
   "Download the app" showcase, a clean light band. Real, in-product
   screenshots sit in custom phone frames, with the App Store badge and a
   scannable QR code on the left. Server component, no client JS beyond the
   shared scroll-reveal wrapper.
   ──────────────────────────────────────────────────────────────────────── */

const APP_STORE_URL =
  'https://apps.apple.com/gb/app/resneo/id6780271109?itscg=30200&itsct=apps_box_badge&mttnsubad=6780271109';
// Apple's BLACK badge variant, the App Store guideline choice for light backgrounds.
const APP_STORE_BADGE =
  'https://toolbox.marketingtools.apple.com/api/v2/badges/download-on-the-app-store/black/en-us?releaseDate=1782432000';

/** Intrinsic aspect ratio of the exported app screenshots (1284 × 2778). */
const SHOT_RATIO = 2778 / 1284;

function AppleGlyph() {
  return (
    <svg viewBox="0 0 384 512" width="13" height="13" fill="currentColor" aria-hidden>
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
    </svg>
  );
}

/** A single phone: dark bezel + rounded screen wrapping a real app screenshot. */
function PhoneFrame({
  src,
  alt,
  width,
  className,
  style,
}: {
  src: string;
  alt: string;
  width: number;
  className?: string;
  style?: CSSProperties;
}) {
  const bezel = Math.round(width * 0.032);
  const screenW = width - bezel * 2;
  const screenH = Math.round(screenW * SHOT_RATIO);
  return (
    <div
      className={`bg-slate-950 ring-1 ring-white/10 ${className ?? ''}`}
      style={{
        width,
        padding: bezel,
        borderRadius: Math.round(width * 0.14),
        boxShadow: '0 40px 80px -28px rgba(0, 12, 28, 0.75)',
        ...style,
      }}
    >
      <img
        src={src}
        alt={alt}
        width={screenW}
        height={screenH}
        loading="lazy"
        style={{ display: 'block', width: screenW, height: 'auto', borderRadius: Math.round(width * 0.108) }}
      />
    </div>
  );
}

export function AppShowcase() {
  return (
    <HomeReveal className="mt-16 sm:mt-20">
      <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-8 shadow-sm sm:p-12 lg:p-14">

        <div className="relative grid items-center gap-12 lg:grid-cols-[1fr_1.05fr] lg:gap-8">
          {/* ── Copy ───────────────────────────────────────────── */}
          <div className="text-center lg:text-left">
            <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3.5 py-1.5 text-xs font-bold uppercase tracking-[0.18em] text-brand-700">
              <AppleGlyph />
              Available on iPhone
            </span>
            <h2 className="mt-6 text-4xl font-extrabold leading-[1.05] tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
              Your whole business,
              <span className="mt-1 block bg-gradient-to-r from-brand-600 to-accent-600 bg-clip-text text-transparent">
                in your pocket
              </span>
            </h2>
            <p className="mt-5 text-lg font-medium text-slate-600">Download the ResNeo app.</p>

            {/* App Store badge + scannable QR */}
            <div className="mt-8 flex flex-col items-center gap-5 sm:flex-row sm:justify-center lg:justify-start">
              <a
                href={APP_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Download ResNeo on the App Store"
                className="inline-block transition-transform hover:-translate-y-0.5"
              >
                <img
                  src={APP_STORE_BADGE}
                  alt="Download on the App Store"
                  width={168}
                  height={56}
                  style={{ width: 168, height: 56, objectFit: 'contain' }}
                />
              </a>
              <div className="rounded-2xl bg-white p-2.5 shadow-lg ring-1 ring-black/5">
                <img
                  src="/app/app-store-qr.svg"
                  alt="Scan to download the ResNeo app from the App Store"
                  width={72}
                  height={72}
                  style={{ width: 72, height: 72 }}
                />
              </div>
            </div>
          </div>

          {/* ── Phones ─────────────────────────────────────────── */}
          <div className="relative flex items-center justify-center">
            {/* Glow puck behind the phones */}
            <div
              className="pointer-events-none absolute rounded-full bg-accent/10 blur-3xl"
              style={{ width: '78%', height: '70%' }}
              aria-hidden
            />

            {/* Back phone — the booking command centre */}
            <div className="relative hidden sm:block" style={{ marginRight: -52, marginTop: 52 }}>
              <PhoneFrame
                src="/app/03-booking-detail.png"
                alt="Managing a booking in the ResNeo app"
                width={212}
                style={{ transform: 'rotate(-7deg)' }}
              />
            </div>

            {/* Front phone — the daily calendar */}
            <div className="relative z-10" style={{ transform: 'rotate(3deg)' }}>
              <PhoneFrame
                src="/app/01-calendar.png"
                alt="Your daily calendar in the ResNeo app"
                width={262}
              />
            </div>

            {/* Floating product cards for life */}
            <BookingConfirmedCard
              className="absolute z-20 hidden w-56 sm:flex"
              style={{ top: 16, right: -16 }}
            />
            <DepositCard className="absolute z-20 hidden w-52 sm:flex" style={{ bottom: 20, left: -18 }} />
          </div>
        </div>
      </div>
    </HomeReveal>
  );
}
