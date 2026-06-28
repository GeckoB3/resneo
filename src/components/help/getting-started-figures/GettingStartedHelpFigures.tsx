'use client';

import { type ReactNode } from 'react';
import { START_HERE_FIGURES } from './figures-start-here';
import { SET_UP_FIGURES } from './figures-set-up';
import { CATALOGUE_FIGURES } from './figures-catalogue';
import { RUN_FIGURES } from './figures-run';
import { GROW_FIGURES } from './figures-grow';

/**
 * Hand-built schematic figures for the Getting started help hub.
 * These mirror the real dashboard chrome (not pixel-perfect) using brand tokens,
 * the same approach as AppointmentsHelpFigures. Each figure is referenced from an
 * article body with a `:::help-figure <id>` marker.
 */

const brand = '#00305C';
const brandMid = '#003B6F';
const brandLight = '#E8EFF6';
const accent = '#00A0A4';
const accentSoft = '#C2F4F5';
const slate = '#64748b';
const slateDark = '#0f172a';
const border = '#e2e8f0';
const white = '#ffffff';

const green = '#059669';
const red = '#dc2626';
const redSoft = '#fee2e2';
const amber = '#d97706';
const amberSoft = '#fef3c7';

function FigureFrame({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string;
  children: ReactNode;
}) {
  return (
    <figure className="help-figure my-8 overflow-hidden rounded-2xl border border-slate-200/90 bg-gradient-to-b from-white to-slate-50/80 shadow-sm shadow-slate-900/5">
      <figcaption className="border-b border-slate-100 bg-slate-50/90 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-800">{title}</p>
        {caption ? <p className="mt-1 text-sm text-slate-600">{caption}</p> : null}
      </figcaption>
      <div className="p-4 sm:p-5">{children}</div>
    </figure>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   1. How your hours combine - the core mental model.
   A single day's timeline: venue hours ∩ calendar hours − breaks = bookable.
   ───────────────────────────────────────────────────────────────────────── */
function HoursStackSvg() {
  const x = (t: number) => 140 + (t - 8) * 56; // axis spans 8:00 → 18:00
  const ticks = [8, 10, 12, 14, 16, 18];
  const barH = 26;
  const rows = { venue: 40, cal: 82, brk: 124, book: 166 };
  const mid = (a: number, b: number) => (a + b) / 2;
  return (
    <svg
      viewBox="0 0 720 244"
      className="h-auto w-full"
      role="img"
      aria-label="A day's timeline showing that guests can only book where the venue's business hours and the calendar's working hours overlap, with the lunch break removed."
    >
      {/* intersection guides */}
      <line x1={x(9)} y1="32" x2={x(9)} y2="198" stroke="#94a3b8" strokeWidth="1" strokeDasharray="4 4" />
      <line x1={x(17)} y1="32" x2={x(17)} y2="198" stroke="#94a3b8" strokeWidth="1" strokeDasharray="4 4" />

      {/* Row 1 - venue business hours 9–18 */}
      <text x="14" y={rows.venue + 17} fill={slateDark} fontSize="12" fontWeight="600">Venue hours</text>
      <rect x={x(9)} y={rows.venue} width={x(18) - x(9)} height={barH} rx="7" fill={brand} />
      <text x={mid(x(9), x(18))} y={rows.venue + 17} textAnchor="middle" fill={white} fontSize="10" fontWeight="600">9:00 – 18:00</text>

      {/* Row 2 - calendar working hours 8–17 (8–9 is outside venue hours) */}
      <text x="14" y={rows.cal + 17} fill={slateDark} fontSize="12" fontWeight="600">Sarah&apos;s hours</text>
      <rect x={x(8)} y={rows.cal} width={x(17) - x(8)} height={barH} rx="7" fill={accent} />
      <rect x={x(8)} y={rows.cal} width={x(9) - x(8)} height={barH} rx="7" fill="#94a3b8" opacity="0.55" />
      <text x={mid(x(9), x(17))} y={rows.cal + 17} textAnchor="middle" fill={white} fontSize="10" fontWeight="600">8:00 – 17:00</text>

      {/* Row 3 - lunch break carved out of the working window */}
      <text x="14" y={rows.brk + 17} fill={slateDark} fontSize="12" fontWeight="600">Lunch break</text>
      <rect x={x(9)} y={rows.brk} width={x(17) - x(9)} height={barH} rx="7" fill="#f1f5f9" stroke={border} />
      <rect x={x(13)} y={rows.brk} width={x(14) - x(13)} height={barH} fill={red} />
      <text x={x(14) + 8} y={rows.brk + 17} fill={amber} fontSize="10" fontWeight="600">13:00 – 14:00</text>

      {/* Row 4 - what's actually bookable */}
      <text x="14" y={rows.book + 16} fill={green} fontSize="12" fontWeight="700">Guests book</text>
      <rect x={x(9)} y={rows.book} width={x(13) - x(9)} height={barH} rx="7" fill={green} />
      <rect x={x(14)} y={rows.book} width={x(17) - x(14)} height={barH} rx="7" fill={green} />
      <text x={mid(x(9), x(13))} y={rows.book + 17} textAnchor="middle" fill={white} fontSize="10" fontWeight="600">9:00 – 13:00</text>
      <text x={mid(x(14), x(17))} y={rows.book + 17} textAnchor="middle" fill={white} fontSize="10" fontWeight="600">14:00 – 17:00</text>

      {/* time axis */}
      <line x1="140" y1="206" x2="700" y2="206" stroke={border} strokeWidth="1" />
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} y1="202" x2={x(t)} y2="210" stroke="#94a3b8" strokeWidth="1" />
          <text x={x(t)} y="226" textAnchor="middle" fill={slate} fontSize="10">{`${t}:00`}</text>
        </g>
      ))}
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   2. Settings → Business hours - weekly opening hours + closures card.
   ───────────────────────────────────────────────────────────────────────── */
function BusinessHoursScreenSvg() {
  const days = [
    { d: 'Monday', t: '09:00 – 18:00', open: true },
    { d: 'Tuesday', t: '09:00 – 18:00', open: true },
    { d: 'Wednesday', t: '09:00 – 18:00', open: true },
    { d: 'Thursday', t: '09:00 – 18:00', open: true },
    { d: 'Friday', t: '09:00 – 18:00', open: true },
    { d: 'Saturday', t: '10:00 – 16:00', open: true },
    { d: 'Sunday', t: 'Closed', open: false },
  ];
  return (
    <svg
      viewBox="0 0 560 470"
      className="mx-auto h-auto w-full max-w-[560px]"
      role="img"
      aria-label="The Settings, Business hours screen: a Weekly opening hours card with a row for each day and a Save opening hours button, above a Closures and special days card."
    >
      {/* Card 1 - weekly opening hours */}
      <rect x="10" y="10" width="540" height="276" rx="14" fill={white} stroke={border} />
      <text x="30" y="36" fill={slate} fontSize="9" fontWeight="700" letterSpacing="0.08em">HOURS</text>
      <text x="30" y="58" fill={slateDark} fontSize="16" fontWeight="700">Weekly opening hours</text>
      {days.map((row, i) => {
        const y = 80 + i * 24;
        return (
          <g key={row.d}>
            <text x="30" y={y + 13} fill={slateDark} fontSize="11" fontWeight="500">{row.d}</text>
            {/* toggle */}
            <rect x="150" y={y + 2} width="34" height="16" rx="8" fill={row.open ? accent : '#cbd5e1'} />
            <circle cx={row.open ? 176 : 158} cy={y + 10} r="6" fill={white} />
            <text x="210" y={y + 13} fill={row.open ? slateDark : slate} fontSize="11" fontWeight={row.open ? '600' : '400'}>
              {row.t}
            </text>
          </g>
        );
      })}
      <rect x="380" y="246" width="150" height="28" rx="9" fill={slateDark} />
      <text x="455" y="264" textAnchor="middle" fill={white} fontSize="11" fontWeight="600">Save opening hours</text>

      {/* Card 2 - closures & special days */}
      <rect x="10" y="300" width="540" height="160" rx="14" fill={white} stroke={border} />
      <text x="30" y="326" fill={slate} fontSize="9" fontWeight="700" letterSpacing="0.08em">EXCEPTIONS</text>
      <text x="30" y="348" fill={slateDark} fontSize="16" fontWeight="700">Closures &amp; special days</text>
      <text x="30" y="370" fill={slate} fontSize="11">Bank holidays, private events, or different hours for a date.</text>
      <rect x="30" y="388" width="88" height="24" rx="12" fill={redSoft} />
      <text x="74" y="404" textAnchor="middle" fill={red} fontSize="10" fontWeight="600">Closure</text>
      <rect x="128" y="388" width="124" height="24" rx="12" fill={amberSoft} />
      <text x="190" y="404" textAnchor="middle" fill={amber} fontSize="10" fontWeight="600">Amended Hours</text>
      <text x="30" y="438" fill={slate} fontSize="10">Click a date on the calendar, then add a block.</text>
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   3. Calendar Availability - the four tabs + weekly hours for one calendar.
   ───────────────────────────────────────────────────────────────────────── */
function AvailabilityTabsSvg() {
  const tabs = ['Calendars', 'Availability', 'Breaks', 'Closures'];
  const activeTab = 'Availability';
  const hours = [
    { d: 'Mon', t: '09:00 – 17:00' },
    { d: 'Tue', t: '09:00 – 17:00' },
    { d: 'Wed', t: '09:00 – 17:00' },
    { d: 'Thu', t: '10:00 – 19:00' },
    { d: 'Fri', t: '09:00 – 17:00' },
  ];
  return (
    <svg
      viewBox="0 0 560 430"
      className="mx-auto h-auto w-full max-w-[560px]"
      role="img"
      aria-label="The Calendar Availability screen with four tabs (Calendars, Availability, Breaks, Closures), a calendar picker, an information note about how hours combine, a weekly hours list, and a Save Working Hours button."
    >
      <text x="20" y="32" fill={slateDark} fontSize="16" fontWeight="700">Availability Settings</text>

      {/* tab bar */}
      <rect x="20" y="48" width="520" height="38" rx="10" fill="#f1f5f9" />
      {tabs.map((t, i) => {
        const w = 124;
        const tx = 26 + i * 128;
        const active = t === activeTab;
        return (
          <g key={t}>
            <rect x={tx} y="53" width={w} height="28" rx="8" fill={active ? white : 'transparent'} stroke={active ? border : 'transparent'} />
            <text x={tx + w / 2} y="71" textAnchor="middle" fill={active ? brand : slate} fontSize="11" fontWeight={active ? '700' : '500'}>
              {t}
            </text>
          </g>
        );
      })}

      {/* calendar picker */}
      <text x="20" y="116" fill={slate} fontSize="10" fontWeight="600">Calendar</text>
      <rect x="20" y="124" width="190" height="30" rx="8" fill={white} stroke={border} />
      <text x="34" y="143" fill={slateDark} fontSize="11" fontWeight="500">Sarah</text>
      <text x="196" y="143" fill={slate} fontSize="11">▾</text>

      {/* info callout (mirrors the in-app note) */}
      <rect x="20" y="166" width="520" height="58" rx="12" fill={brandLight} stroke="#bcd2e6" />
      <text x="36" y="188" fill={brand} fontSize="11" fontWeight="700">How calendar hours and business hours work together</text>
      <text x="36" y="206" fill={slateDark} fontSize="10">A time is only bookable where it also sits inside your venue&apos;s business hours.</text>
      <text x="36" y="220" fill={slateDark} fontSize="10">Set hours wider than your business hours and the extra time stays unbookable.</text>

      {/* weekly hours list */}
      {hours.map((row, i) => {
        const y = 240 + i * 26;
        return (
          <g key={row.d}>
            <text x="20" y={y + 15} fill={slateDark} fontSize="11" fontWeight="500">{row.d}</text>
            <rect x="70" y={y + 1} width="150" height="20" rx="6" fill={accentSoft} />
            <text x="145" y={y + 15} textAnchor="middle" fill={brand} fontSize="10" fontWeight="600">{row.t}</text>
          </g>
        );
      })}

      <rect x="20" y="382" width="166" height="28" rx="9" fill={brandMid} />
      <text x="103" y="400" textAnchor="middle" fill={white} fontSize="11" fontWeight="600">Save Working Hours</text>
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   4. Closures & special days - month calendar + the New Block form.
   ───────────────────────────────────────────────────────────────────────── */
function ClosuresFormSvg() {
  // Schematic December grid; Dec 1 sits on a Tuesday (col index 2).
  const offset = 2;
  const cells = Array.from({ length: 31 }, (_, i) => i + 1);
  const cellW = 38;
  const cellH = 30;
  const gridX = 26;
  const gridY = 92;
  const dow = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  return (
    <svg
      viewBox="0 0 600 360"
      className="mx-auto h-auto w-full max-w-[600px]"
      role="img"
      aria-label="The Closures and special days editor: a month calendar with one day marked as a closure and one as amended hours, beside a New Block form with a Type selector and an Add to Calendar button."
    >
      {/* Calendar card */}
      <rect x="10" y="10" width="300" height="340" rx="14" fill={white} stroke={border} />
      <text x="30" y="42" fill={slateDark} fontSize="13" fontWeight="700">December 2026</text>
      <text x="262" y="42" fill={slate} fontSize="13">‹  ›</text>
      {dow.map((d, i) => (
        <text key={i} x={gridX + i * cellW + cellW / 2} y="76" textAnchor="middle" fill={slate} fontSize="9" fontWeight="600">{d}</text>
      ))}
      {cells.map((d) => {
        const idx = d - 1 + offset;
        const col = idx % 7;
        const rowN = Math.floor(idx / 7);
        const cx = gridX + col * cellW;
        const cy = gridY + rowN * cellH;
        const isClosure = d === 25;
        const isAmended = d === 12;
        const fill = isClosure ? red : isAmended ? amber : 'transparent';
        const txtFill = isClosure || isAmended ? white : slateDark;
        return (
          <g key={d}>
            {(isClosure || isAmended) && <rect x={cx + 3} y={cy + 2} width={cellW - 6} height={cellH - 6} rx="7" fill={fill} />}
            <text x={cx + cellW / 2} y={cy + cellH / 2 + 2} textAnchor="middle" fill={txtFill} fontSize="10" fontWeight={isClosure || isAmended ? '700' : '400'}>{d}</text>
          </g>
        );
      })}
      {/* legend */}
      <rect x="30" y="312" width="12" height="12" rx="3" fill={red} />
      <text x="48" y="322" fill={slate} fontSize="9">Closure</text>
      <rect x="120" y="312" width="12" height="12" rx="3" fill={amber} />
      <text x="138" y="322" fill={slate} fontSize="9">Amended hours</text>

      {/* Form card */}
      <rect x="326" y="10" width="264" height="340" rx="14" fill="#f8fafc" stroke={border} />
      <text x="346" y="40" fill={slateDark} fontSize="13" fontWeight="700">New Block</text>

      <text x="346" y="64" fill={slate} fontSize="9" fontWeight="600">Type</text>
      <rect x="346" y="70" width="224" height="28" rx="8" fill={white} stroke={border} />
      <text x="360" y="88" fill={slateDark} fontSize="11" fontWeight="500">Closure</text>
      <text x="556" y="88" fill={slate} fontSize="11">▾</text>

      <text x="346" y="120" fill={slate} fontSize="9" fontWeight="600">Start date</text>
      <rect x="346" y="126" width="106" height="26" rx="8" fill={white} stroke={border} />
      <text x="360" y="143" fill={slateDark} fontSize="10">25 Dec 2026</text>
      <text x="464" y="120" fill={slate} fontSize="9" fontWeight="600">End date</text>
      <rect x="464" y="126" width="106" height="26" rx="8" fill={white} stroke={border} />
      <text x="478" y="143" fill={slateDark} fontSize="10">25 Dec 2026</text>

      <text x="346" y="174" fill={slate} fontSize="9" fontWeight="600">Reason (optional)</text>
      <rect x="346" y="180" width="224" height="26" rx="8" fill={white} stroke={border} />
      <text x="360" y="197" fill={slate} fontSize="10">Christmas Day</text>

      <rect x="346" y="222" width="140" height="30" rx="9" fill={brandMid} />
      <text x="416" y="241" textAnchor="middle" fill={white} fontSize="11" fontWeight="600">Add to Calendar</text>

      {/* upcoming row */}
      <text x="346" y="284" fill={slate} fontSize="9" fontWeight="700" letterSpacing="0.06em">UPCOMING</text>
      <rect x="346" y="292" width="224" height="44" rx="10" fill={white} stroke={border} />
      <rect x="358" y="302" width="60" height="18" rx="9" fill={redSoft} />
      <text x="388" y="315" textAnchor="middle" fill={red} fontSize="9" fontWeight="600">Closure</text>
      <text x="358" y="332" fill={slateDark} fontSize="10" fontWeight="500">25 Dec 2026 · Christmas Day</text>
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   5. Two kinds of closure - which screen blocks what.
   ───────────────────────────────────────────────────────────────────────── */
function TwoClosuresSvg() {
  return (
    <svg
      viewBox="0 0 720 248"
      className="h-auto w-full"
      role="img"
      aria-label="A comparison of two closure types: closing the whole venue from Settings, Business hours blocks every calendar; taking one calendar off from Calendar Availability, Closures blocks just that person or room."
    >
      <text x="20" y="24" fill={slateDark} fontSize="13" fontWeight="700">Two kinds of closure: pick the right screen</text>

      {/* Left - whole venue */}
      <rect x="20" y="40" width="320" height="190" rx="14" fill={white} stroke={border} />
      <rect x="20" y="40" width="320" height="6" rx="3" fill={red} />
      {/* building icon */}
      <rect x="44" y="66" width="34" height="36" rx="3" fill={brandLight} stroke={brand} />
      <rect x="50" y="73" width="7" height="7" fill={brand} />
      <rect x="64" y="73" width="7" height="7" fill={brand} />
      <rect x="50" y="86" width="7" height="7" fill={brand} />
      <rect x="64" y="86" width="7" height="7" fill={brand} />
      <text x="92" y="80" fill={slateDark} fontSize="14" fontWeight="700">Close the whole venue</text>
      <text x="92" y="98" fill={slate} fontSize="10">Settings → Business hours</text>
      <text x="44" y="134" fill={slateDark} fontSize="11">Blocks <tspan fontWeight="700">every</tspan> calendar and all</text>
      <text x="44" y="150" fill={slateDark} fontSize="11">booking types on that date.</text>
      <rect x="44" y="176" width="252" height="32" rx="8" fill={redSoft} />
      <text x="58" y="196" fill={red} fontSize="10" fontWeight="600">e.g. bank holiday, refurbishment day</text>

      {/* Right - one calendar */}
      <rect x="380" y="40" width="320" height="190" rx="14" fill={white} stroke={border} />
      <rect x="380" y="40" width="320" height="6" rx="3" fill={accent} />
      {/* person icon */}
      <circle cx="408" cy="74" r="9" fill={accentSoft} stroke={accent} />
      <path d="M392 102 a16 16 0 0 1 32 0 z" fill={accentSoft} stroke={accent} />
      <text x="438" y="80" fill={slateDark} fontSize="14" fontWeight="700">Take one calendar off</text>
      <text x="438" y="98" fill={slate} fontSize="10">Calendar Availability → Closures</text>
      <text x="404" y="134" fill={slateDark} fontSize="11">Blocks <tspan fontWeight="700">just</tspan> that person or</text>
      <text x="404" y="150" fill={slateDark} fontSize="11">room. Everyone else stays open.</text>
      <rect x="404" y="176" width="272" height="32" rx="8" fill="#e6fbfb" />
      <text x="418" y="196" fill={accent} fontSize="10" fontWeight="600">e.g. Sarah on holiday, room being painted</text>
    </svg>
  );
}

const FIGURE_COPY: Record<string, { title: string; caption: string; node: ReactNode }> = {
  ...START_HERE_FIGURES,
  ...SET_UP_FIGURES,
  ...CATALOGUE_FIGURES,
  ...RUN_FIGURES,
  ...GROW_FIGURES,
  'hours-stack': {
    title: 'How your hours combine',
    caption:
      'A time is bookable only where the venue’s business hours and the calendar’s working hours overlap, then breaks and closures are removed.',
    node: <HoursStackSvg />,
  },
  'business-hours-screen': {
    title: 'Settings → Business hours',
    caption: 'Set your normal weekly opening hours, then add one-off closures or amended hours in the card below.',
    node: <BusinessHoursScreenSvg />,
  },
  'availability-tabs': {
    title: 'Calendar Availability',
    caption: 'Four tabs per calendar: Calendars, Availability (weekly hours), Breaks, and Closures.',
    node: <AvailabilityTabsSvg />,
  },
  'closures-form': {
    title: 'Closures & special days',
    caption: 'Click a date (or drag a range), choose Closure or Amended Hours, add a reason, then Add to Calendar.',
    node: <ClosuresFormSvg />,
  },
  'two-closures': {
    title: 'Two kinds of closure',
    caption: 'Close the whole venue from Settings; take one person or room off from Calendar Availability.',
    node: <TwoClosuresSvg />,
  },
};

export function GettingStartedHelpFigure({ id }: { id: string }) {
  const def = FIGURE_COPY[id];
  if (!def) {
    return (
      <div className="my-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Missing help figure: <code className="rounded bg-amber-100 px-1">{id}</code>
      </div>
    );
  }
  return (
    <FigureFrame title={def.title} caption={def.caption}>
      {def.node}
    </FigureFrame>
  );
}
