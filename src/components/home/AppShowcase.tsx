import type { CSSProperties } from 'react';
import { HomeReveal } from '@/components/home/HomeReveal';
import { BookingConfirmedCard, DepositCard } from '@/components/home/HomeGraphics';

/* ────────────────────────────────────────────────────────────────────────
   "Download the app" showcase, a clean light band. Real, in-product
   screenshots sit in custom phone frames, with the App Store and Google Play
   badges on the left. Server component, no client JS beyond the shared
   scroll-reveal wrapper.
   ──────────────────────────────────────────────────────────────────────── */

const APP_STORE_URL =
  'https://apps.apple.com/gb/app/resneo/id6780271109?itscg=30200&itsct=apps_box_badge&mttnsubad=6780271109';
// Apple's BLACK badge variant, the App Store guideline choice for light backgrounds.
const APP_STORE_BADGE =
  'https://toolbox.marketingtools.apple.com/api/v2/badges/download-on-the-app-store/black/en-us?releaseDate=1782432000';

const GOOGLE_PLAY_URL = 'https://play.google.com/store/apps/details?id=com.resneo.app';
// Self-hosted "Get it on Google Play" badge (Google no longer serves hotlinkable badge images).
const GOOGLE_PLAY_BADGE = '/app/google-play-badge.svg';

/** Intrinsic aspect ratio of the exported app screenshots (1284 × 2778). */
const SHOT_RATIO = 2778 / 1284;

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
              Available on iPhone and Android
            </span>
            <h2 className="mt-6 text-4xl font-extrabold leading-[1.05] tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
              Your whole business,
              <span className="mt-1 block bg-gradient-to-r from-brand-600 to-accent-600 bg-clip-text text-transparent">
                in your pocket
              </span>
            </h2>
            <p className="mt-5 text-lg font-medium text-slate-600">Download the ResNeo app.</p>

            {/* App Store + Google Play badges */}
            <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center lg:justify-start">
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
              <a
                href={GOOGLE_PLAY_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Get ResNeo on Google Play"
                className="inline-block transition-transform hover:-translate-y-0.5"
              >
                <img
                  src={GOOGLE_PLAY_BADGE}
                  alt="Get it on Google Play"
                  width={189}
                  height={56}
                  style={{ width: 189, height: 56, objectFit: 'contain' }}
                />
              </a>
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
