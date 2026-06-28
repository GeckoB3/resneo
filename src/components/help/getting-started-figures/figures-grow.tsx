'use client';

import type { ReactNode } from 'react';

/* Auto-assembled figures for the gs-grow section of the Getting started hub. */

function CommsLanesSvg() {
  return (
    <svg
      viewBox="0 0 560 470"
      className="mx-auto h-auto w-full max-w-[560px]"
      role="img"
      aria-label="The Communications settings screen as a vertical stack of message cards. Booking confirmation and Pre-visit reminder are toggled on with Email and SMS channel checkboxes; the reminder also has a send-hours-before field set to 24. Deposit payment request is off. Post-visit thank you is off and offers only an Email channel. A Saved indicator sits at the top right."
    >
      {/* panel header */}
      <text x="20" y="22" fill="#64748b" fontSize="11" fontWeight="700" letterSpacing="0.08em">COMMUNICATIONS</text>
      {/* Saved indicator */}
      <rect x="452" y="9" width="88" height="20" rx="10" fill="#C2F4F5" />
      <circle cx="465" cy="19" r="3.5" fill="#059669" />
      <text x="473" y="23" fill="#0f172a" fontSize="11" fontWeight="600">Saved</text>

      {/* Card 1: Booking confirmation (ON) */}
      <rect x="20" y="38" width="520" height="92" rx="13" fill="#ffffff" stroke="#e2e8f0" />
      <text x="36" y="62" fill="#0f172a" fontSize="13" fontWeight="700">Booking confirmation</text>
      <text x="36" y="80" fill="#64748b" fontSize="11">Sent as soon as a guest books.</text>
      {/* toggle ON */}
      <rect x="478" y="50" width="46" height="24" rx="12" fill="#00A0A4" />
      <circle cx="512" cy="62" r="9" fill="#ffffff" />
      {/* channel checkboxes */}
      <rect x="36" y="96" width="14" height="14" rx="3.5" fill="#00305C" />
      <path d="M39 103 l3 3 l5 -6" stroke="#ffffff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <text x="56" y="107" fill="#0f172a" fontSize="11">Email</text>
      <rect x="108" y="96" width="14" height="14" rx="3.5" fill="#00305C" />
      <path d="M111 103 l3 3 l5 -6" stroke="#ffffff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <text x="128" y="107" fill="#0f172a" fontSize="11">SMS</text>

      {/* Card 2: Pre-visit reminder (ON) */}
      <rect x="20" y="140" width="520" height="92" rx="13" fill="#ffffff" stroke="#e2e8f0" />
      <text x="36" y="164" fill="#0f172a" fontSize="13" fontWeight="700">Pre-visit reminder</text>
      <text x="36" y="182" fill="#64748b" fontSize="11">A nudge before the appointment.</text>
      {/* toggle ON */}
      <rect x="478" y="152" width="46" height="24" rx="12" fill="#00A0A4" />
      <circle cx="512" cy="164" r="9" fill="#ffffff" />
      {/* channel checkboxes */}
      <rect x="36" y="198" width="14" height="14" rx="3.5" fill="#00305C" />
      <path d="M39 205 l3 3 l5 -6" stroke="#ffffff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <text x="56" y="209" fill="#0f172a" fontSize="11">Email</text>
      <rect x="108" y="198" width="14" height="14" rx="3.5" fill="#00305C" />
      <path d="M111 205 l3 3 l5 -6" stroke="#ffffff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <text x="128" y="209" fill="#0f172a" fontSize="11">SMS</text>
      {/* send hours before field */}
      <text x="300" y="192" fill="#64748b" fontSize="10" fontWeight="600" letterSpacing="0.04em">SEND HOURS BEFORE</text>
      <rect x="300" y="198" width="60" height="22" rx="6" fill="#f8fafc" stroke="#e2e8f0" />
      <text x="312" y="213" fill="#0f172a" fontSize="12" fontWeight="700">24</text>
      <line x1="345" y1="201" x2="345" y2="217" stroke="#e2e8f0" strokeWidth="1" />
      <path d="M350 206 l4 -4 l4 4" stroke="#64748b" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M350 213 l4 4 l4 -4" stroke="#64748b" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />

      {/* Card 3: Deposit payment request (OFF) */}
      <rect x="20" y="242" width="520" height="64" rx="13" fill="#ffffff" stroke="#e2e8f0" />
      <text x="36" y="270" fill="#0f172a" fontSize="13" fontWeight="700">Deposit payment request</text>
      <text x="36" y="288" fill="#64748b" fontSize="11">Asks for a deposit to hold the slot.</text>
      {/* toggle OFF */}
      <rect x="478" y="262" width="46" height="24" rx="12" fill="#e2e8f0" />
      <circle cx="490" cy="274" r="9" fill="#ffffff" />

      {/* Card 4: Post-visit thank you (OFF, Email only) */}
      <rect x="20" y="316" width="520" height="92" rx="13" fill="#ffffff" stroke="#e2e8f0" />
      <text x="36" y="340" fill="#0f172a" fontSize="13" fontWeight="700">Post-visit thank you</text>
      <text x="36" y="358" fill="#64748b" fontSize="11">A follow-up after they leave.</text>
      {/* toggle OFF */}
      <rect x="478" y="328" width="46" height="24" rx="12" fill="#e2e8f0" />
      <circle cx="490" cy="340" r="9" fill="#ffffff" />
      {/* Email only checkbox (unchecked, since card is off) */}
      <rect x="36" y="374" width="14" height="14" rx="3.5" fill="#f1f5f9" stroke="#e2e8f0" />
      <text x="56" y="385" fill="#64748b" fontSize="11">Email</text>

      {/* footer hint */}
      <text x="20" y="438" fill="#64748b" fontSize="10">Toggle a message on to choose its channels and timing.</text>
    </svg>
  );
}

function CommsEditorSvg() {
  return (
    <svg
      viewBox="0 0 640 386"
      className="mx-auto h-auto w-full max-w-[560px]"
      role="img"
      aria-label="An expanded Booking confirmation message card with Email and SMS checkboxes switched on, showing side-by-side email and SMS optional message text boxes, each with a Preview button and a character count."
    >
      {/* Card */}
      <rect x="12" y="12" width="616" height="362" rx="14" fill="#ffffff" stroke="#e2e8f0" strokeWidth="1.5" />

      {/* Card header */}
      <text x="34" y="42" fill="#64748b" fontSize="10" fontWeight="700" letterSpacing="1">AUTOMATIC MESSAGE</text>
      <text x="34" y="64" fill="#0f172a" fontSize="16" fontWeight="700">Booking confirmation</text>

      {/* On toggle */}
      <rect x="546" y="44" width="48" height="24" rx="12" fill="#00A0A4" />
      <circle cx="582" cy="56" r="9" fill="#ffffff" />
      <text x="540" y="60" textAnchor="end" fill="#059669" fontSize="11" fontWeight="700">On</text>

      {/* Divider */}
      <line x1="34" y1="82" x2="606" y2="82" stroke="#e2e8f0" strokeWidth="1" />

      {/* Channel checkbox row */}
      <text x="34" y="108" fill="#64748b" fontSize="10" fontWeight="700" letterSpacing="1">SEND VIA</text>
      {/* Email check */}
      <rect x="34" y="118" width="16" height="16" rx="4" fill="#00305C" />
      <path d="M38 126 l3 3 l5 -6" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <text x="58" y="131" fill="#0f172a" fontSize="12" fontWeight="600">Email</text>
      {/* SMS check */}
      <rect x="120" y="118" width="16" height="16" rx="4" fill="#00305C" />
      <path d="M124 126 l3 3 l5 -6" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <text x="144" y="131" fill="#0f172a" fontSize="12" fontWeight="600">SMS</text>

      {/* Editor area on light grey fill */}
      <rect x="24" y="150" width="592" height="212" rx="12" fill="#f1f5f9" />

      {/* Left sub-panel: Email optional message */}
      <rect x="40" y="166" width="270" height="180" rx="10" fill="#ffffff" stroke="#e2e8f0" strokeWidth="1.5" />
      <text x="56" y="190" fill="#0f172a" fontSize="11" fontWeight="700">Email optional message</text>
      {/* Preview button */}
      <rect x="232" y="178" width="62" height="22" rx="7" fill="#ffffff" stroke="#00305C" strokeWidth="1.2" />
      <text x="263" y="193" textAnchor="middle" fill="#00305C" fontSize="10" fontWeight="600">Preview</text>
      {/* Text box */}
      <rect x="56" y="208" width="238" height="98" rx="8" fill="#f8fafc" stroke="#e2e8f0" strokeWidth="1" />
      <text x="68" y="230" fill="#94a3b8" fontSize="10">Optional extra line shown</text>
      <text x="68" y="246" fill="#94a3b8" fontSize="10">with the standard template...</text>
      {/* Char count */}
      <text x="56" y="326" fill="#94a3b8" fontSize="9">0 characters</text>

      {/* Right sub-panel: SMS optional message */}
      <rect x="330" y="166" width="270" height="180" rx="10" fill="#ffffff" stroke="#e2e8f0" strokeWidth="1.5" />
      <text x="346" y="190" fill="#0f172a" fontSize="11" fontWeight="700">SMS optional message</text>
      {/* Preview button */}
      <rect x="522" y="178" width="62" height="22" rx="7" fill="#ffffff" stroke="#00305C" strokeWidth="1.2" />
      <text x="553" y="193" textAnchor="middle" fill="#00305C" fontSize="10" fontWeight="600">Preview</text>
      {/* Text box */}
      <rect x="346" y="208" width="238" height="98" rx="8" fill="#f8fafc" stroke="#e2e8f0" strokeWidth="1" />
      <text x="358" y="230" fill="#94a3b8" fontSize="10">Optional extra line shown</text>
      <text x="358" y="246" fill="#94a3b8" fontSize="10">with the standard template...</text>
      {/* Char count */}
      <text x="346" y="326" fill="#94a3b8" fontSize="9">0 characters</text>
    </svg>
  );
}

function ReportsDashboardSvg() {
  const bars = [22, 38, 30, 52, 44, 60, 48];
  const baseY = 318;
  const maxH = 70;
  return (
    <svg
      viewBox="0 0 560 470"
      className="mx-auto h-auto w-full max-w-[560px]"
      role="img"
      aria-label="The Settings, Reports overview screen: a page header with Overview and Clients tabs, a Date range card with From and To inputs and an Apply button, an Appointment activity report card with three stat tiles and a bar chart and an Export CSV button, and a hinted No-show rate card below."
    >
      {/* Page header */}
      <text x="14" y="26" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">INSIGHTS</text>
      <text x="14" y="50" fill="#0f172a" fontSize="22" fontWeight="700">Reports</text>
      {/* Tabs */}
      <rect x="372" y="22" width="174" height="32" rx="9" fill="#f1f5f9" />
      <rect x="377" y="27" width="84" height="22" rx="7" fill="#ffffff" stroke="#e2e8f0" />
      <text x="419" y="42" textAnchor="middle" fill="#00305C" fontSize="11" fontWeight="700">Overview</text>
      <text x="503" y="42" textAnchor="middle" fill="#64748b" fontSize="11" fontWeight="500">Clients</text>

      {/* Date range card */}
      <rect x="10" y="68" width="540" height="78" rx="14" fill="#ffffff" stroke="#e2e8f0" />
      <text x="30" y="92" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.06em">RANGE</text>
      <text x="30" y="116" fill="#64748b" fontSize="9" fontWeight="600">From</text>
      <rect x="30" y="120" width="150" height="28" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="44" y="138" fill="#0f172a" fontSize="11" fontWeight="500">01 Jun 2026</text>
      <text x="196" y="116" fill="#64748b" fontSize="9" fontWeight="600">To</text>
      <rect x="196" y="120" width="150" height="28" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="210" y="138" fill="#0f172a" fontSize="11" fontWeight="500">28 Jun 2026</text>
      <rect x="446" y="120" width="84" height="28" rx="9" fill="#00305C" />
      <text x="488" y="138" textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="600">Apply</text>

      {/* Report card 1: Appointment activity */}
      <rect x="10" y="160" width="540" height="208" rx="14" fill="#ffffff" stroke="#e2e8f0" />
      <text x="30" y="186" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.06em">REPORT</text>
      <text x="30" y="206" fill="#0f172a" fontSize="15" fontWeight="700">Appointment activity</text>
      {/* Export CSV button */}
      <g>
        <path d="M449 192 v8 M445 197 l4 4 4 -4 M443 205 h12" stroke="#00305C" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <text x="463" y="206" fill="#00305C" fontSize="11" fontWeight="600">Export CSV</text>
      </g>

      {/* Stat tiles */}
      <rect x="30" y="222" width="158" height="64" rx="11" fill="#f8fafc" stroke="#e2e8f0" />
      <text x="44" y="244" fill="#64748b" fontSize="9" fontWeight="600">Bookings created</text>
      <text x="44" y="272" fill="#0f172a" fontSize="20" fontWeight="700">128</text>

      <rect x="201" y="222" width="158" height="64" rx="11" fill="#f8fafc" stroke="#e2e8f0" />
      <text x="215" y="244" fill="#64748b" fontSize="9" fontWeight="600">Client places booked</text>
      <text x="215" y="272" fill="#0f172a" fontSize="20" fontWeight="700">214</text>

      <rect x="372" y="222" width="158" height="64" rx="11" fill="#ffffff" stroke="#059669" />
      <text x="386" y="244" fill="#059669" fontSize="9" fontWeight="700">Clients seen</text>
      <text x="386" y="272" fill="#059669" fontSize="20" fontWeight="700">189</text>

      {/* Bar chart */}
      <line x1="30" y1={baseY} x2="530" y2={baseY} stroke="#e2e8f0" strokeWidth="1" />
      {bars.map((v, i) => {
        const w = 44;
        const gap = 26;
        const x = 38 + i * (w + gap);
        const h = (v / 70) * maxH;
        return (
          <rect key={i} x={x} y={baseY - h} width={w} height={h} rx="4" fill="#003B6F" />
        );
      })}

      {/* Report card 2: No-show rate (hinted) */}
      <rect x="10" y="382" width="540" height="78" rx="14" fill="#ffffff" stroke="#e2e8f0" />
      <text x="30" y="408" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.06em">REPORT</text>
      <text x="30" y="428" fill="#0f172a" fontSize="15" fontWeight="700">No-show rate</text>
      <text x="30" y="450" fill="#dc2626" fontSize="20" fontWeight="700">6.4%</text>
      {/* line chart hint */}
      <polyline points="360,440 392,424 424,432 456,414 488,420 520,406" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="520" cy="406" r="3" fill="#ef4444" />
    </svg>
  );
}

function ImportFlowSvg() {
  const steps = [
    { n: '1', label: 'Upload' },
    { n: '2', label: 'Map' },
    { n: '3', label: 'Review' },
    { n: '4', label: 'Services & staff' },
    { n: '5', label: 'Validate' },
    { n: '6', label: 'Import' },
  ];
  const activeIndex = 2;
  const pillW = 104;
  const pillH = 36;
  const gap = 8;
  const startX = 12;
  const rowY = 64;
  return (
    <svg
      viewBox="0 0 700 250"
      className="h-auto w-full"
      role="img"
      aria-label="The import wizard stepper with six numbered pills in order: 1 Upload, 2 Map, 3 Review (active), 4 Services and staff, 5 Validate, 6 Import, with arrows showing left-to-right flow, a note that progress is saved if you leave, and a callout that the whole import can be undone for 24 hours."
    >
      <text x="14" y="28" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">IMPORT WIZARD</text>
      <text x="14" y="48" fill="#0f172a" fontSize="15" fontWeight="700">Step 3 of 6</text>

      {steps.map((s, i) => {
        const x = startX + i * (pillW + gap);
        const active = i === activeIndex;
        const cy = rowY + pillH / 2;
        const longLabel = s.label.length > 8;
        return (
          <g key={s.n}>
            <rect
              x={x}
              y={rowY}
              width={pillW}
              height={pillH}
              rx="18"
              fill={active ? '#E8EFF6' : '#ffffff'}
              stroke={active ? '#bcd2e6' : '#e2e8f0'}
            />
            <circle cx={x + 20} cy={cy} r="11" fill={active ? '#00305C' : '#f1f5f9'} stroke={active ? '#00305C' : '#cbd5e1'} />
            <text x={x + 20} y={cy + 4} textAnchor="middle" fill={active ? '#ffffff' : '#64748b'} fontSize="11" fontWeight="700">{s.n}</text>
            <text x={x + 36} y={cy + 4} fill={active ? '#00305C' : '#0f172a'} fontSize={longLabel ? '8' : '11'} fontWeight={active ? '700' : '500'}>{s.label}</text>
            {i < steps.length - 1 && (
              <g>
                <line x1={x + pillW + 1} y1={cy} x2={x + pillW + gap - 1} y2={cy} stroke="#94a3b8" strokeWidth="1.5" />
                <path d={`M ${x + pillW + gap - 1} ${cy} l -5 -3.5 l 0 7 z`} fill="#94a3b8" />
              </g>
            )}
          </g>
        );
      })}

      <rect x="14" y="128" width="672" height="42" rx="12" fill="#E8EFF6" stroke="#bcd2e6" />
      <circle cx="38" cy="149" r="9" fill="#00305C" />
      <path d="M34 149 l3 3 l5 -6" fill="none" stroke="#ffffff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <text x="58" y="153" fill="#00305C" fontSize="11" fontWeight="600">You can leave and come back, progress is saved.</text>

      <rect x="14" y="182" width="672" height="52" rx="12" fill="#e6fbfb" stroke="#7fd9db" />
      <rect x="14" y="182" width="6" height="52" rx="3" fill="#00A0A4" />
      <circle cx="44" cy="208" r="10" fill="#C2F4F5" stroke="#00A0A4" />
      <path d="M48 204 a6 6 0 1 1 -2 -4 m0 0 l-1 -4 m1 4 l4 -1" fill="none" stroke="#00A0A4" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <text x="66" y="204" fill="#00305C" fontSize="11" fontWeight="700">Undo available for 24 hours</text>
      <text x="66" y="221" fill="#0f172a" fontSize="10">After it finishes you can undo the whole import for 24 hours.</text>
    </svg>
  );
}

function ImportMappingSvg() {
  const rows = [
    { src: 'Date', tgt: 'Booking Date', status: 'ok' },
    { src: 'Time', tgt: 'Booking Time', status: 'ok' },
    { src: 'Client name', tgt: 'Guest name (split)', status: 'warn' },
    { src: 'Email', tgt: 'Client Email', status: 'ok' },
    { src: 'Service', tgt: 'Service Name', status: 'ok' },
    { src: 'Staff', tgt: 'Staff Member', status: 'ok' },
    { src: 'Price', tgt: 'Price (£)', status: 'ok' },
    { src: 'Status', tgt: 'Booking Status', status: 'ok' },
  ];
  const rowH = 34;
  const top = 150;
  const leftX = 26;
  const colW = 200;
  const rightX = 354;
  const chipH = 26;
  return (
    <svg
      viewBox="0 0 620 470"
      className="h-auto w-full"
      role="img"
      aria-label="The Map columns screen: spreadsheet column headers on the left (Date, Time, Client name, Email, Service, Staff, Price, Status) linked to ResNeo target fields on the right, with green ticks for auto-matched rows and an amber warning on the Client name row that still needs attention."
    >
      <text x="20" y="30" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">STEP 2 OF 6</text>
      <text x="20" y="54" fill="#0f172a" fontSize="16" fontWeight="700">Map columns</text>
      <text x="20" y="74" fill="#64748b" fontSize="11">We matched your columns automatically, check the result.</text>

      <rect x="20" y="90" width="120" height="24" rx="12" fill="#d1fae5" />
      <path d="M34 102 l4 4 l7 -8" fill="none" stroke="#059669" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <text x="52" y="106" fill="#059669" fontSize="10" fontWeight="600">7 auto-matched</text>
      <rect x="150" y="90" width="158" height="24" rx="12" fill="#fef3c7" />
      <text x="170" y="106" fill="#d97706" fontSize="10" fontWeight="600">1 needs attention</text>

      <text x={leftX + 4} y={top - 14} fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.06em">YOUR FILE</text>
      <text x={rightX + 4} y={top - 14} fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.06em">RESNEO FIELD</text>

      {rows.map((row, i) => {
        const y = top + i * rowH;
        const cy = y + chipH / 2;
        const warn = row.status === 'warn';
        const linkColor = warn ? '#d97706' : '#059669';
        return (
          <g key={row.src}>
            <line x1={leftX + colW} y1={cy} x2={rightX} y2={cy} stroke={linkColor} strokeWidth="1.6" strokeDasharray={warn ? '4 4' : undefined} />
            <circle cx={leftX + colW} cy={cy} r="2.6" fill={linkColor} />
            <circle cx={rightX} cy={cy} r="2.6" fill={linkColor} />

            <rect x={leftX} y={y} width={colW} height={chipH} rx="8" fill="#f1f5f9" stroke="#e2e8f0" />
            <text x={leftX + 14} y={y + 17} fill="#0f172a" fontSize="11" fontWeight="500">{row.src}</text>

            <rect x={rightX} y={y} width={colW} height={chipH} rx="8" fill={warn ? '#fffbeb' : '#ffffff'} stroke={warn ? '#fcd34d' : '#e2e8f0'} />
            <text x={rightX + 14} y={y + 17} fill="#0f172a" fontSize="11" fontWeight="500">{row.tgt}</text>

            {warn ? (
              <g>
                <circle cx={rightX + colW + 16} cy={cy} r="9" fill="#fef3c7" />
                <path d={`M${rightX + colW + 16} ${cy - 5} l5 9 h-10 z`} fill="none" stroke="#d97706" strokeWidth="1.6" strokeLinejoin="round" />
                <rect x={rightX + colW + 14} y={cy - 1.5} width="4" height="3.5" fill="#d97706" />
                <rect x={rightX + colW + 14.6} y={cy + 3} width="2.8" height="2.8" rx="1.4" fill="#d97706" />
              </g>
            ) : (
              <g>
                <circle cx={rightX + colW + 16} cy={cy} r="9" fill="#d1fae5" />
                <path d={`M${rightX + colW + 11} ${cy} l3.5 3.5 l6 -7`} fill="none" stroke="#059669" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </g>
            )}
          </g>
        );
      })}

      <rect x="20" y="430" width="430" height="28" rx="9" fill="#E8EFF6" stroke="#bcd2e6" />
      <text x="34" y="448" fill="#00305C" fontSize="10">A combined column like &apos;Client name&apos; can split into first &amp; last.</text>

      <rect x="462" y="430" width="130" height="28" rx="9" fill="#003B6F" />
      <text x="527" y="448" textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="600">Continue</text>
    </svg>
  );
}

function ReferFlowSvg() {
  return (
    <svg
      viewBox="0 0 720 230"
      className="h-auto w-full"
      role="img"
      aria-label="A three-step flow: share your code or link, the new venue signs up for a 14-day trial plus 30 bonus free days, and once they pay their first invoice you get a credit on your next ResNeo invoice."
    >
      <text x="20" y="26" fill="#0f172a" fontSize="13" fontWeight="700">How the reward works</text>

      {/* Step 1 - Share your code */}
      <rect x="20" y="48" width="200" height="150" rx="14" fill="#ffffff" stroke="#e2e8f0" />
      <text x="40" y="76" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">STEP 1</text>
      <text x="40" y="98" fill="#0f172a" fontSize="13" fontWeight="700">Share your code</text>
      <text x="40" y="115" fill="#0f172a" fontSize="13" fontWeight="700">or link</text>
      {/* code chip + copy icon */}
      <rect x="40" y="134" width="118" height="30" rx="9" fill="#f1f5f9" stroke="#e2e8f0" />
      <text x="54" y="153" fill="#00305C" fontSize="12" fontWeight="700" letterSpacing="0.04em">RESNEO-7K2</text>
      <rect x="166" y="134" width="30" height="30" rx="9" fill="#E8EFF6" stroke="#bcd2e6" />
      <rect x="174" y="141" width="11" height="13" rx="2" fill="#ffffff" stroke="#00305C" />
      <rect x="178" y="145" width="11" height="13" rx="2" fill="#E8EFF6" stroke="#00305C" />
      <text x="40" y="186" fill="#64748b" fontSize="10">Send to a venue you know.</text>

      {/* Arrow 1 */}
      <line x1="226" y1="123" x2="256" y2="123" stroke="#94a3b8" strokeWidth="2" />
      <path d="M256 117 l10 6 l-10 6 z" fill="#94a3b8" />

      {/* Step 2 - New venue signs up (amber / trialling) */}
      <rect x="272" y="48" width="176" height="150" rx="14" fill="#fef3c7" stroke="#f1d49a" />
      <text x="292" y="76" fill="#d97706" fontSize="9" fontWeight="700" letterSpacing="0.08em">STEP 2</text>
      <text x="292" y="98" fill="#0f172a" fontSize="13" fontWeight="700">New venue</text>
      <text x="292" y="115" fill="#0f172a" fontSize="13" fontWeight="700">signs up</text>
      {/* stacked trial label */}
      <rect x="292" y="130" width="136" height="50" rx="10" fill="#ffffff" stroke="#f1d49a" />
      <text x="304" y="151" fill="#d97706" fontSize="12" fontWeight="700">14-day trial</text>
      <text x="304" y="170" fill="#d97706" fontSize="12" fontWeight="700">+ 30 bonus free days</text>

      {/* Arrow 2 */}
      <line x1="454" y1="123" x2="484" y2="123" stroke="#94a3b8" strokeWidth="2" />
      <path d="M484 117 l10 6 l-10 6 z" fill="#94a3b8" />

      {/* Step 3 - They pay, you get credit (brand / success) */}
      <rect x="500" y="48" width="200" height="150" rx="14" fill="#00305C" />
      <text x="520" y="76" fill="#C2F4F5" fontSize="9" fontWeight="700" letterSpacing="0.08em">STEP 3</text>
      <text x="520" y="98" fill="#ffffff" fontSize="13" fontWeight="700">They pay first</text>
      <text x="520" y="115" fill="#ffffff" fontSize="13" fontWeight="700">invoice</text>
      <rect x="520" y="130" width="160" height="50" rx="10" fill="#003B6F" />
      <circle cx="538" cy="155" r="10" fill="#00A0A4" />
      <path d="M533 155 l4 4 l7 -8" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <text x="556" y="151" fill="#C2F4F5" fontSize="11" fontWeight="700">You get credit on</text>
      <text x="556" y="167" fill="#C2F4F5" fontSize="11" fontWeight="700">your next invoice</text>
    </svg>
  );
}

function ReferTrackingSvg() {
  return (
    <svg
      viewBox="0 0 640 420"
      className="h-auto w-full"
      role="img"
      aria-label="The Refer and Earn tracking area: three summary cards showing credits earned, credit on next invoice, and referrals in progress, above a Your referrals table with rows carrying Pending, Signed up trialling, and Credited status pills."
    >
      {/* Summary cards row */}
      {/* Card 1 - Credits earned */}
      <rect x="10" y="10" width="200" height="96" rx="13" fill="#ffffff" stroke="#e2e8f0" />
      <text x="28" y="36" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">CREDITS EARNED</text>
      <text x="28" y="70" fill="#0f172a" fontSize="26" fontWeight="700">&pound;120</text>
      <text x="28" y="92" fill="#64748b" fontSize="10">Across 4 referrals</text>

      {/* Card 2 - Credit on next invoice */}
      <rect x="220" y="10" width="200" height="96" rx="13" fill="#ffffff" stroke="#e2e8f0" />
      <text x="238" y="36" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">NEXT INVOICE</text>
      <text x="238" y="70" fill="#00305C" fontSize="26" fontWeight="700">&pound;30</text>
      <text x="238" y="92" fill="#64748b" fontSize="10">Applied by Stripe</text>

      {/* Card 3 - In progress */}
      <rect x="430" y="10" width="200" height="96" rx="13" fill="#ffffff" stroke="#e2e8f0" />
      <text x="448" y="36" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">IN PROGRESS</text>
      <text x="448" y="70" fill="#00A0A4" fontSize="26" fontWeight="700">2</text>
      <text x="448" y="92" fill="#64748b" fontSize="10">Trialling now</text>

      {/* Referrals table card */}
      <rect x="10" y="124" width="620" height="284" rx="14" fill="#ffffff" stroke="#e2e8f0" />
      <text x="28" y="152" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">REFERRALS</text>
      <text x="28" y="174" fill="#0f172a" fontSize="16" fontWeight="700">Your referrals</text>

      {/* Column headers */}
      <text x="28" y="208" fill="#64748b" fontSize="10" fontWeight="700" letterSpacing="0.04em">VENUE</text>
      <text x="250" y="208" fill="#64748b" fontSize="10" fontWeight="700" letterSpacing="0.04em">STATUS</text>
      <text x="480" y="208" fill="#64748b" fontSize="10" fontWeight="700" letterSpacing="0.04em">CREDIT</text>
      <text x="560" y="208" fill="#64748b" fontSize="10" fontWeight="700" letterSpacing="0.04em">UPDATED</text>
      <line x1="28" y1="218" x2="612" y2="218" stroke="#e2e8f0" strokeWidth="1" />

      {/* Row 1 - Pending */}
      <text x="28" y="248" fill="#0f172a" fontSize="11" fontWeight="500">The Glasshouse</text>
      <rect x="250" y="235" width="74" height="20" rx="10" fill="#f1f5f9" />
      <text x="287" y="249" textAnchor="middle" fill="#64748b" fontSize="9" fontWeight="600">Pending</text>
      <text x="480" y="248" fill="#64748b" fontSize="11">-</text>
      <text x="560" y="248" fill="#64748b" fontSize="10">12 Jun 2026</text>
      <line x1="28" y1="266" x2="612" y2="266" stroke="#f1f5f9" strokeWidth="1" />

      {/* Row 2 - Signed up, trialling */}
      <text x="28" y="296" fill="#0f172a" fontSize="11" fontWeight="500">Maple Spa</text>
      <rect x="250" y="283" width="150" height="20" rx="10" fill="#fef3c7" />
      <text x="325" y="297" textAnchor="middle" fill="#92400e" fontSize="9" fontWeight="600">Signed up, trialling</text>
      <text x="480" y="296" fill="#64748b" fontSize="11">-</text>
      <text x="560" y="296" fill="#64748b" fontSize="10">9 Jun 2026</text>
      <line x1="28" y1="314" x2="612" y2="314" stroke="#f1f5f9" strokeWidth="1" />

      {/* Row 3 - Credited */}
      <text x="28" y="344" fill="#0f172a" fontSize="11" fontWeight="500">Harbour Clinic</text>
      <rect x="250" y="331" width="76" height="20" rx="10" fill="#C2F4F5" />
      <text x="288" y="345" textAnchor="middle" fill="#00305C" fontSize="9" fontWeight="600">Credited</text>
      <text x="480" y="344" fill="#059669" fontSize="11" fontWeight="700">&pound;30</text>
      <text x="560" y="344" fill="#64748b" fontSize="10">2 Jun 2026</text>
      <line x1="28" y1="362" x2="612" y2="362" stroke="#f1f5f9" strokeWidth="1" />

      {/* Footer note */}
      <text x="28" y="390" fill="#64748b" fontSize="10">Credit applies automatically once a referred venue starts paying.</text>
    </svg>
  );
}

export const GROW_FIGURES: Record<string, { title: string; caption: string; node: ReactNode }> = {
  "comms-lanes": { title: "Settings, Communications", caption: "Each guest message sits in its own card with an on/off switch, channel checkboxes, and a timing field where relevant.", node: <CommsLanesSvg /> },
  "comms-editor": { title: "Optional message editor and preview", caption: "Each active message has optional email and SMS text boxes with a character count and a Preview button.", node: <CommsEditorSvg /> },
  "reports-dashboard": { title: "Settings then Reports (Overview)", caption: "The Reports overview with a date range control, stat tiles, a chart, and per-report Export CSV buttons.", node: <ReportsDashboardSvg /> },
  "import-flow": { title: "The import wizard, step by step", caption: "The six wizard steps in order, with a note that the whole import can be undone for 24 hours.", node: <ImportFlowSvg /> },
  "import-mapping": { title: "Map columns", caption: "Your spreadsheet column headers on the left matched to ResNeo fields on the right.", node: <ImportMappingSvg /> },
  "refer-flow": { title: "How the reward works", caption: "Sharing your code leads to bonus trial days for the new venue and a credit for you once they pay. Amounts shown are examples; your credit equals a free month of your own plan.", node: <ReferFlowSvg /> },
  "refer-tracking": { title: "Refer & Earn tracking", caption: "Three summary cards sit above the referrals table with coloured status pills. Amounts and venue names shown are examples.", node: <ReferTrackingSvg /> },
};
