'use client';

import type { ReactNode } from 'react';

/* Auto-assembled figures for the gs-run section of the Getting started hub. */

function CalendarGridSvg() {
  return (
    <svg
      viewBox="0 0 640 430"
      className="h-auto w-full"
      role="img"
      aria-label="The calendar Day view: a toolbar with a View Day selector, date navigation arrows, a Compact button, a Walk-in button and a New button, above a time grid with hour labels and two calendar columns (Sarah and Room 1) holding coloured booking cards at different times."
    >
      {/* Toolbar */}
      <rect x="10" y="10" width="620" height="46" rx="12" fill="#ffffff" stroke="#e2e8f0" />

      {/* View selector */}
      <rect x="22" y="22" width="74" height="22" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="34" y="37" fill="#0f172a" fontSize="11" fontWeight="600">Day</text>
      <text x="84" y="37" fill="#64748b" fontSize="11">▾</text>

      {/* back arrow */}
      <rect x="106" y="22" width="24" height="22" rx="8" fill="#f1f5f9" stroke="#e2e8f0" />
      <text x="118" y="38" textAnchor="middle" fill="#64748b" fontSize="12" fontWeight="700">‹</text>

      {/* date label */}
      <rect x="134" y="22" width="172" height="22" rx="8" fill="#E8EFF6" />
      <text x="220" y="37" textAnchor="middle" fill="#00305C" fontSize="11" fontWeight="600">Monday 28 June 2026</text>

      {/* forward arrow */}
      <rect x="310" y="22" width="24" height="22" rx="8" fill="#f1f5f9" stroke="#e2e8f0" />
      <text x="322" y="38" textAnchor="middle" fill="#64748b" fontSize="12" fontWeight="700">›</text>

      {/* Compact button */}
      <rect x="408" y="22" width="76" height="22" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="446" y="37" textAnchor="middle" fill="#0f172a" fontSize="11" fontWeight="600">Compact</text>

      {/* Walk-in button (green) */}
      <rect x="498" y="21" width="60" height="24" rx="9" fill="#059669" />
      <text x="528" y="37" textAnchor="middle" fill="#ffffff" fontSize="10" fontWeight="600">Walk-in</text>

      {/* New (primary brand) */}
      <rect x="564" y="21" width="56" height="24" rx="9" fill="#00305C" />
      <text x="592" y="37" textAnchor="middle" fill="#ffffff" fontSize="10" fontWeight="600">New</text>

      {/* Grid frame */}
      <rect x="10" y="66" width="620" height="354" rx="12" fill="#ffffff" stroke="#e2e8f0" />

      {/* column headers */}
      <rect x="64" y="66" width="283" height="34" fill="#f8fafc" />
      <rect x="347" y="66" width="283" height="34" fill="#f8fafc" />
      <line x1="64" y1="100" x2="630" y2="100" stroke="#e2e8f0" strokeWidth="1" />
      <line x1="64" y1="66" x2="64" y2="420" stroke="#e2e8f0" strokeWidth="1" />
      <line x1="347" y1="66" x2="347" y2="420" stroke="#e2e8f0" strokeWidth="1" />

      {/* person header */}
      <circle cx="190" cy="83" r="7" fill="#C2F4F5" stroke="#00A0A4" />
      <path d="M178 99 a12 12 0 0 1 24 0 z" fill="#C2F4F5" stroke="#00A0A4" />
      <text x="212" y="87" fill="#0f172a" fontSize="12" fontWeight="700">Sarah</text>

      {/* room header */}
      <rect x="468" y="76" width="14" height="14" rx="2" fill="#E8EFF6" stroke="#00305C" />
      <text x="492" y="87" fill="#0f172a" fontSize="12" fontWeight="700">Room 1</text>

      {/* hour rows + gutter labels */}
      <text x="50" y="124" textAnchor="end" fill="#64748b" fontSize="10">9:00</text>
      <line x1="64" y1="118" x2="630" y2="118" stroke="#f1f5f9" strokeWidth="1" />
      <text x="50" y="202" textAnchor="end" fill="#64748b" fontSize="10">10:00</text>
      <line x1="64" y1="196" x2="630" y2="196" stroke="#f1f5f9" strokeWidth="1" />
      <text x="50" y="280" textAnchor="end" fill="#64748b" fontSize="10">11:00</text>
      <line x1="64" y1="274" x2="630" y2="274" stroke="#f1f5f9" strokeWidth="1" />
      <text x="50" y="358" textAnchor="end" fill="#64748b" fontSize="10">12:00</text>
      <line x1="64" y1="352" x2="630" y2="352" stroke="#f1f5f9" strokeWidth="1" />

      {/* Booking cards */}
      {/* Sarah 9:30 booked (teal) */}
      <rect x="74" y="126" width="263" height="56" rx="10" fill="#C2F4F5" stroke="#00A0A4" />
      <rect x="74" y="126" width="5" height="56" rx="2.5" fill="#00A0A4" />
      <text x="90" y="148" fill="#0f172a" fontSize="12" fontWeight="700">Emma Carter</text>
      <text x="90" y="166" fill="#00305C" fontSize="10">9:30–10:15 · Facial</text>

      {/* Sarah 11:00 booked (navy tint) */}
      <rect x="74" y="282" width="263" height="56" rx="10" fill="#E8EFF6" stroke="#00305C" />
      <rect x="74" y="282" width="5" height="56" rx="2.5" fill="#00305C" />
      <text x="90" y="304" fill="#0f172a" fontSize="12" fontWeight="700">James Lee</text>
      <text x="90" y="322" fill="#00305C" fontSize="10">11:00–11:45 · Massage</text>

      {/* Room 1 10:00 pending (amber) */}
      <rect x="357" y="204" width="263" height="56" rx="10" fill="#fef3c7" stroke="#d97706" />
      <rect x="357" y="204" width="5" height="56" rx="2.5" fill="#d97706" />
      <text x="373" y="226" fill="#0f172a" fontSize="12" fontWeight="700">Priya Shah</text>
      <text x="373" y="244" fill="#78350F" fontSize="10">10:00–10:40 · Pending</text>

      {/* Room 1 12:00 completed (green) */}
      <rect x="357" y="360" width="263" height="52" rx="10" fill="#ffffff" stroke="#059669" />
      <rect x="357" y="360" width="5" height="52" rx="2.5" fill="#059669" />
      <text x="373" y="382" fill="#0f172a" fontSize="12" fontWeight="700">Tom Reid</text>
      <text x="373" y="400" fill="#059669" fontSize="10">12:00–12:30 · Consult</text>
    </svg>
  );
}

function CalendarCardSvg() {
  return (
    <svg
      viewBox="0 0 640 360"
      className="h-auto w-full"
      role="img"
      aria-label="An enlarged booking card showing the guest name, service, phone number, time range and a status pill, with a drag grip on the left edge, a resize handle along the bottom, and Arrived, Start and Complete action buttons, each labelled by a callout."
    >
      {/* The booking card */}
      <rect x="150" y="40" width="340" height="240" rx="14" fill="#E8EFF6" stroke="#00305C" strokeWidth="1.5" />

      {/* Drag grip strip (left edge) */}
      <rect x="150" y="40" width="14" height="240" rx="7" fill="#00305C" />
      <circle cx="157" cy="150" r="1.6" fill="#ffffff" />
      <circle cx="157" cy="160" r="1.6" fill="#ffffff" />
      <circle cx="157" cy="170" r="1.6" fill="#ffffff" />

      {/* Resize handle strip (bottom edge) */}
      <rect x="164" y="266" width="326" height="14" rx="6" fill="#003B6F" />
      <line x1="305" y1="270" x2="349" y2="270" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="305" y1="274" x2="349" y2="274" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" />

      {/* Card contents */}
      <text x="184" y="78" fill="#0f172a" fontSize="17" fontWeight="700">Jane Doe</text>
      <text x="184" y="102" fill="#64748b" fontSize="12">Haircut</text>
      <text x="184" y="123" fill="#64748b" fontSize="12">07700 900123</text>
      <text x="184" y="148" fill="#00305C" fontSize="13" fontWeight="600">10:00–10:45</text>

      {/* Status pill */}
      <rect x="184" y="162" width="92" height="24" rx="12" fill="#C2F4F5" stroke="#00A0A4" strokeWidth="1" />
      <circle cx="200" cy="174" r="3.5" fill="#00A0A4" />
      <text x="210" y="178" fill="#0f172a" fontSize="11" fontWeight="600">Booked</text>

      {/* Action buttons (bottom-right) */}
      <rect x="293" y="226" width="58" height="26" rx="13" fill="#FEF3C7" stroke="#D97706" strokeWidth="1" />
      <text x="322" y="243" textAnchor="middle" fill="#78350F" fontSize="11" fontWeight="600">Arrived</text>
      <rect x="357" y="226" width="50" height="26" rx="13" fill="#00A0A4" />
      <text x="382" y="243" textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="600">Start</text>
      <rect x="413" y="226" width="64" height="26" rx="13" fill="#00305C" />
      <text x="445" y="243" textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="600">Complete</text>

      {/* Callouts */}

      {/* Name */}
      <text x="22" y="66" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">GUEST NAME</text>
      <text x="22" y="80" fill="#0f172a" fontSize="11" fontWeight="600">Who is booked</text>
      <line x1="120" y1="72" x2="178" y2="72" stroke="#94a3b8" strokeWidth="1.25" />
      <circle cx="180" cy="72" r="2.5" fill="#00A0A4" />

      {/* Drag grip */}
      <text x="22" y="158" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">DRAG GRIP</text>
      <text x="22" y="172" fill="#0f172a" fontSize="11" fontWeight="600">Move to retime</text>
      <line x1="120" y1="164" x2="150" y2="164" stroke="#94a3b8" strokeWidth="1.25" />
      <circle cx="152" cy="164" r="2.5" fill="#00A0A4" />

      {/* Status pill */}
      <text x="510" y="166" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">STATUS</text>
      <text x="510" y="180" fill="#0f172a" fontSize="11" fontWeight="600">Booking state</text>
      <line x1="280" y1="174" x2="506" y2="174" stroke="#94a3b8" strokeWidth="1.25" strokeDasharray="3 3" />
      <circle cx="278" cy="174" r="2.5" fill="#00A0A4" />

      {/* Action buttons */}
      <text x="510" y="232" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">ACTIONS</text>
      <text x="510" y="246" fill="#0f172a" fontSize="11" fontWeight="600">Quick steps</text>
      <line x1="481" y1="239" x2="506" y2="239" stroke="#94a3b8" strokeWidth="1.25" />
      <circle cx="504" cy="239" r="2.5" fill="#00A0A4" />

      {/* Resize handle */}
      <text x="200" y="318" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">RESIZE HANDLE</text>
      <text x="200" y="332" fill="#0f172a" fontSize="11" fontWeight="600">Drag to change length</text>
      <line x1="327" y1="284" x2="327" y2="306" stroke="#94a3b8" strokeWidth="1.25" />
      <circle cx="327" cy="282" r="2.5" fill="#00A0A4" />
    </svg>
  );
}

function CalendarStatusSvg() {
  const steps = [
    { label: 'Pending', fill: '#fef3c7', stroke: '#d97706', text: '#78350F' },
    { label: 'Booked', fill: '#E8EFF6', stroke: '#003B6F', text: '#00305C' },
    { label: 'Started', fill: '#C2F4F5', stroke: '#00A0A4', text: '#00305C' },
    { label: 'Completed', fill: '#059669', stroke: '#059669', text: '#ffffff' },
  ];
  const arrows = ['Confirm', 'Start', 'Complete'];
  const boxW = 104;
  const boxH = 40;
  const gap = 56;
  const startX = 28;
  const rowY = 86;
  const x = (i: number) => startX + i * (boxW + gap);
  const cx = (i: number) => x(i) + boxW / 2;
  return (
    <svg
      viewBox="0 0 620 320"
      className="h-auto w-full"
      role="img"
      aria-label="A left-to-right flow of booking statuses: Pending leads to Booked via Confirm, Booked to Started via Start, Started to Completed via Complete. A faint dashed back-arrow shows Undo start from Started, and Reopen from Completed. Off to the side, Cancelled and No Show are shown as grey terminal end states."
    >
      <text x="28" y="34" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">BOOKING LIFECYCLE</text>
      <text x="28" y="56" fill="#0f172a" fontSize="16" fontWeight="700">The status flow</text>

      {/* main forward chain */}
      {steps.map((s, i) => (
        <g key={s.label}>
          <rect x={x(i)} y={rowY} width={boxW} height={boxH} rx="12" fill={s.fill} stroke={s.stroke} />
          <text x={cx(i)} y={rowY + boxH / 2 + 4} textAnchor="middle" fill={s.text} fontSize="12" fontWeight="700">{s.label}</text>
        </g>
      ))}

      {/* forward arrows + button labels */}
      {arrows.map((a, i) => {
        const x1 = x(i) + boxW;
        const x2 = x(i + 1);
        const ay = rowY + boxH / 2;
        return (
          <g key={a}>
            <line x1={x1 + 2} y1={ay} x2={x2 - 8} y2={ay} stroke="#00305C" strokeWidth="2" />
            <path d={`M ${x2 - 8} ${ay - 4} L ${x2 - 1} ${ay} L ${x2 - 8} ${ay + 4} Z`} fill="#00305C" />
            <rect x={x1 + (gap - 52) / 2} y={ay - 30} width="52" height="18" rx="9" fill="#00305C" />
            <text x={x1 + gap / 2} y={ay - 17} textAnchor="middle" fill="#ffffff" fontSize="9" fontWeight="600">{a}</text>
          </g>
        );
      })}

      {/* dashed back-arrow: Undo start (Started -> Booked) */}
      <path d={`M ${cx(2)} ${rowY + boxH + 4} C ${cx(2)} ${rowY + boxH + 30}, ${cx(1)} ${rowY + boxH + 30}, ${cx(1)} ${rowY + boxH + 6}`} fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="4 4" />
      <path d={`M ${cx(1) - 4} ${rowY + boxH + 12} L ${cx(1)} ${rowY + boxH + 4} L ${cx(1) + 4} ${rowY + boxH + 12} Z`} fill="#94a3b8" />
      <text x={(cx(1) + cx(2)) / 2} y={rowY + boxH + 46} textAnchor="middle" fill="#64748b" fontSize="9" fontWeight="600">Undo start</text>

      {/* dashed back-arrow: Reopen (Completed -> Started) */}
      <path d={`M ${cx(3)} ${rowY + boxH + 4} C ${cx(3)} ${rowY + boxH + 64}, ${cx(2)} ${rowY + boxH + 64}, ${cx(2)} ${rowY + boxH + 6}`} fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="4 4" />
      <path d={`M ${cx(2) - 4} ${rowY + boxH + 12} L ${cx(2)} ${rowY + boxH + 4} L ${cx(2) + 4} ${rowY + boxH + 12} Z`} fill="#94a3b8" />
      <text x={(cx(2) + cx(3)) / 2} y={rowY + boxH + 78} textAnchor="middle" fill="#64748b" fontSize="9" fontWeight="600">Reopen</text>

      {/* terminal end states */}
      <text x="28" y={236} fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">END STATES</text>
      <line x1="28" y1={246} x2="592" y2={246} stroke="#e2e8f0" strokeWidth="1" />

      <rect x="28" y={262} width={boxW} height={boxH} rx="12" fill="#f1f5f9" stroke="#cbd5e1" />
      <text x={28 + boxW / 2} y={262 + boxH / 2 + 4} textAnchor="middle" fill="#64748b" fontSize="12" fontWeight="700">Cancelled</text>

      <rect x={28 + boxW + 40} y={262} width={boxW} height={boxH} rx="12" fill="#f1f5f9" stroke="#cbd5e1" />
      <text x={28 + boxW + 40 + boxW / 2} y={262 + boxH / 2 + 4} textAnchor="middle" fill="#64748b" fontSize="12" fontWeight="700">No Show</text>

      <text x={28 + 2 * boxW + 92} y={262 + boxH / 2 + 4} fill="#64748b" fontSize="10">Reached from any active status; the booking stops here.</text>
    </svg>
  );
}

function BookingsRowSvg() {
  return (
    <svg
      viewBox="0 0 680 116"
      className="h-auto w-full"
      role="img"
      aria-label="A single booking row from the Bookings list showing a selection checkbox, a coloured status strip down the left edge, the guest name Sarah Mitchell, the time 10:30, the service Deep tissue massage, the staff member, and a Booked status pill."
    >
      {/* Card background */}
      <rect x="8" y="14" width="664" height="88" rx="14" fill="#ffffff" stroke="#e2e8f0" strokeWidth="1.5" />

      {/* Coloured left-edge status strip */}
      <rect x="8" y="14" width="6" height="88" rx="3" fill="#00A0A4" />

      {/* Selection checkbox */}
      <rect x="32" y="49" width="18" height="18" rx="5" fill="#ffffff" stroke="#94a3b8" strokeWidth="1.5" />

      {/* Guest name */}
      <text x="66" y="52" fill="#0f172a" fontSize="15" fontWeight="700">Sarah Mitchell</text>

      {/* Time + service + staff line */}
      <text x="66" y="74" fill="#334155" fontSize="12" fontWeight="600">10:30</text>
      <text x="112" y="74" fill="#94a3b8" fontSize="12">·</text>
      <text x="122" y="74" fill="#64748b" fontSize="12">Deep tissue massage</text>
      <text x="270" y="74" fill="#94a3b8" fontSize="12">·</text>
      <text x="280" y="74" fill="#64748b" fontSize="12">Alex Carter</text>

      {/* Status pill, Booked */}
      <rect x="540" y="45" width="78" height="26" rx="13" fill="#E8EFF6" stroke="#bcd2e6" strokeWidth="1" />
      <circle cx="557" cy="58" r="3.5" fill="#003B6F" />
      <text x="567" y="62" fill="#003B6F" fontSize="11" fontWeight="700">Booked</text>

      {/* Chevron */}
      <path d="M636 53 l7 7 l7 -7" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BookingsFiltersSvg() {
  return (
    <svg
      viewBox="0 0 600 470"
      className="mx-auto h-auto w-full max-w-[600px]"
      role="img"
      aria-label="The Bookings list toolbar with a View button, date arrows and a date label, a Search contacts field, and a Filter button with a count badge; below it the filter panel with a Type row of pill buttons, Calendar and Service dropdowns, a Status row of pill buttons, and a Clear filters link; and a floating selection tray reading three selected with Add tag and Message buttons and a clear X."
    >
      {/* Toolbar card */}
      <rect x="10" y="10" width="580" height="62" rx="14" fill="#ffffff" stroke="#e2e8f0" />

      {/* View button */}
      <rect x="24" y="26" width="86" height="30" rx="9" fill="#ffffff" stroke="#e2e8f0" />
      <text x="38" y="45" fill="#0f172a" fontSize="11" fontWeight="600">Week</text>
      <text x="94" y="45" fill="#64748b" fontSize="11">▾</text>

      {/* prev / next arrows */}
      <rect x="120" y="26" width="30" height="30" rx="9" fill="#ffffff" stroke="#e2e8f0" />
      <text x="135" y="46" textAnchor="middle" fill="#64748b" fontSize="13" fontWeight="700">‹</text>
      <rect x="156" y="26" width="30" height="30" rx="9" fill="#ffffff" stroke="#e2e8f0" />
      <text x="171" y="46" textAnchor="middle" fill="#64748b" fontSize="13" fontWeight="700">›</text>

      {/* date label */}
      <text x="200" y="46" fill="#0f172a" fontSize="12" fontWeight="600">22 – 28 Jun</text>

      {/* search contacts */}
      <rect x="320" y="26" width="170" height="30" rx="9" fill="#f8fafc" stroke="#e2e8f0" />
      <circle cx="338" cy="41" r="5" fill="none" stroke="#64748b" strokeWidth="1.6" />
      <line x1="342" y1="45" x2="346" y2="49" stroke="#64748b" strokeWidth="1.6" />
      <text x="352" y="45" fill="#64748b" fontSize="11">Search contacts</text>

      {/* filter button with badge */}
      <rect x="498" y="26" width="80" height="30" rx="9" fill="#00305C" />
      <text x="514" y="45" fill="#ffffff" fontSize="11" fontWeight="600">Filter</text>
      <circle cx="562" cy="41" r="9" fill="#00A0A4" />
      <text x="562" y="45" textAnchor="middle" fill="#ffffff" fontSize="10" fontWeight="700">2</text>

      {/* Filter panel card */}
      <rect x="10" y="84" width="580" height="282" rx="14" fill="#ffffff" stroke="#e2e8f0" />
      <text x="30" y="110" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">FILTERS</text>
      <text x="494" y="110" fill="#00A0A4" fontSize="10" fontWeight="600">Clear filters</text>

      {/* Type, pill buttons */}
      <text x="30" y="140" fill="#64748b" fontSize="10" fontWeight="600">Type</text>
      <rect x="100" y="126" width="46" height="24" rx="12" fill="#00305C" />
      <text x="123" y="142" textAnchor="middle" fill="#ffffff" fontSize="10" fontWeight="600">All</text>
      <rect x="152" y="126" width="96" height="24" rx="12" fill="#ffffff" stroke="#e2e8f0" />
      <text x="200" y="142" textAnchor="middle" fill="#0f172a" fontSize="10" fontWeight="500">Appointment</text>
      <rect x="254" y="126" width="58" height="24" rx="12" fill="#ffffff" stroke="#e2e8f0" />
      <text x="283" y="142" textAnchor="middle" fill="#0f172a" fontSize="10" fontWeight="500">Class</text>
      <rect x="318" y="126" width="58" height="24" rx="12" fill="#ffffff" stroke="#e2e8f0" />
      <text x="347" y="142" textAnchor="middle" fill="#0f172a" fontSize="10" fontWeight="500">Event</text>

      {/* Calendar */}
      <text x="30" y="176" fill="#64748b" fontSize="10" fontWeight="600">Calendar</text>
      <rect x="100" y="162" width="200" height="26" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="114" y="179" fill="#0f172a" fontSize="11" fontWeight="500">All appointments</text>
      <text x="286" y="179" fill="#64748b" fontSize="11">▾</text>

      {/* Service */}
      <text x="30" y="212" fill="#64748b" fontSize="10" fontWeight="600">Service</text>
      <rect x="100" y="198" width="200" height="26" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="114" y="215" fill="#0f172a" fontSize="11" fontWeight="500">All services</text>
      <text x="286" y="215" fill="#64748b" fontSize="11">▾</text>

      {/* Status pills */}
      <text x="30" y="250" fill="#64748b" fontSize="10" fontWeight="600">Status</text>

      {/* Row 1 of status pills */}
      <rect x="100" y="238" width="46" height="24" rx="12" fill="#00305C" />
      <text x="123" y="254" textAnchor="middle" fill="#ffffff" fontSize="10" fontWeight="600">All</text>
      <rect x="152" y="238" width="74" height="24" rx="12" fill="#ffffff" stroke="#e2e8f0" />
      <text x="189" y="254" textAnchor="middle" fill="#0f172a" fontSize="10" fontWeight="500">Pending</text>
      <rect x="232" y="238" width="66" height="24" rx="12" fill="#ffffff" stroke="#e2e8f0" />
      <text x="265" y="254" textAnchor="middle" fill="#0f172a" fontSize="10" fontWeight="500">Booked</text>
      <rect x="304" y="238" width="84" height="24" rx="12" fill="#ffffff" stroke="#e2e8f0" />
      <text x="346" y="254" textAnchor="middle" fill="#0f172a" fontSize="10" fontWeight="500">Confirmed</text>
      <rect x="394" y="238" width="68" height="24" rx="12" fill="#ffffff" stroke="#e2e8f0" />
      <text x="428" y="254" textAnchor="middle" fill="#0f172a" fontSize="10" fontWeight="500">Started</text>

      {/* Row 2 of status pills */}
      <rect x="100" y="270" width="86" height="24" rx="12" fill="#ffffff" stroke="#e2e8f0" />
      <text x="143" y="286" textAnchor="middle" fill="#0f172a" fontSize="10" fontWeight="500">Completed</text>
      <rect x="192" y="270" width="84" height="24" rx="12" fill="#ffffff" stroke="#e2e8f0" />
      <text x="234" y="286" textAnchor="middle" fill="#0f172a" fontSize="10" fontWeight="500">Cancelled</text>
      <rect x="282" y="270" width="74" height="24" rx="12" fill="#ffffff" stroke="#e2e8f0" />
      <text x="319" y="286" textAnchor="middle" fill="#0f172a" fontSize="10" fontWeight="500">No show</text>

      {/* applied-filter hint */}
      <rect x="30" y="318" width="540" height="32" rx="10" fill="#E8EFF6" stroke="#bcd2e6" />
      <text x="46" y="338" fill="#00305C" fontSize="10" fontWeight="600">Filter (2): Status and Calendar are active.</text>

      {/* Floating selection tray */}
      <rect x="120" y="402" width="360" height="52" rx="14" fill="#0f172a" />
      <text x="144" y="433" fill="#ffffff" fontSize="13" fontWeight="700">3 selected</text>

      <rect x="236" y="416" width="84" height="26" rx="9" fill="#00A0A4" />
      <text x="278" y="433" textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="600">Add tag</text>

      <rect x="328" y="416" width="84" height="26" rx="9" fill="#003B6F" />
      <text x="370" y="433" textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="600">Message</text>

      {/* clear X */}
      <circle cx="454" cy="428" r="13" fill="none" stroke="#64748b" strokeWidth="1.4" />
      <line x1="449" y1="423" x2="459" y2="433" stroke="#ffffff" strokeWidth="1.6" />
      <line x1="459" y1="423" x2="449" y2="433" stroke="#ffffff" strokeWidth="1.6" />
    </svg>
  );
}

function NewbookingFormSvg() {
  return (
    <svg
      viewBox="0 0 560 700"
      className="mx-auto h-auto w-full max-w-[560px]"
      role="img"
      aria-label="The New Booking screen on the Appointment tab: a row of booking-type tabs with Appointment active, a Select a service list of service cards, a Who would you like to see step for picking a staff member, then a Date and time step with a month date picker and a grid of time slots, with a Confirm Booking button at the bottom."
    >
      {/* Outer card */}
      <rect x="10" y="10" width="540" height="680" rx="14" fill="#ffffff" stroke="#e2e8f0" />

      {/* Heading */}
      <text x="30" y="44" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">BOOKINGS</text>
      <text x="30" y="66" fill="#0f172a" fontSize="18" fontWeight="700">New Booking</text>

      {/* Booking-type tab bar */}
      <rect x="30" y="80" width="500" height="38" rx="10" fill="#f1f5f9" />
      {[
        { t: 'Table', active: false },
        { t: 'Appointment', active: true },
        { t: 'Classes', active: false },
        { t: 'Events', active: false },
        { t: 'Resources', active: false },
      ].map((tab, i) => {
        const w = 96;
        const tx = 34 + i * 98;
        return (
          <g key={tab.t}>
            <rect
              x={tx}
              y="85"
              width={w}
              height="28"
              rx="8"
              fill={tab.active ? '#00305C' : 'transparent'}
              stroke={tab.active ? '#00305C' : 'transparent'}
            />
            <text
              x={tx + w / 2}
              y="103"
              textAnchor="middle"
              fill={tab.active ? '#ffffff' : '#64748b'}
              fontSize="11"
              fontWeight={tab.active ? '700' : '500'}
            >
              {tab.t}
            </text>
          </g>
        );
      })}

      {/* Select a service */}
      <text x="30" y="168" fill="#0f172a" fontSize="14" fontWeight="700">Select a service</text>

      {/* Service cards */}
      {[
        { name: 'Classic Manicure', desc: 'Shape, cuticle care & polish', price: '£28', sel: true },
        { name: 'Gel Manicure', desc: 'Long-lasting gel finish', price: '£35', sel: false },
        { name: 'Spa Pedicure', desc: 'Soak, scrub & massage', price: '£42', sel: false },
      ].map((s, i) => {
        const y = 182 + i * 64;
        return (
          <g key={s.name}>
            <rect
              x="30"
              y={y}
              width="500"
              height="54"
              rx="12"
              fill={s.sel ? '#E8EFF6' : '#ffffff'}
              stroke={s.sel ? '#00305C' : '#e2e8f0'}
            />
            {/* radio */}
            <circle cx="52" cy={y + 27} r="8" fill="#ffffff" stroke={s.sel ? '#00305C' : '#cbd5e1'} strokeWidth="2" />
            {s.sel && <circle cx="52" cy={y + 27} r="4" fill="#00305C" />}
            <text x="74" y={y + 23} fill="#0f172a" fontSize="12" fontWeight="700">{s.name}</text>
            <text x="74" y={y + 40} fill="#64748b" fontSize="10">{s.desc}</text>
            {/* price pill */}
            <rect x="466" y={y + 16} width="50" height="22" rx="11" fill="#C2F4F5" />
            <text x="491" y={y + 31} textAnchor="middle" fill="#00305C" fontSize="11" fontWeight="700">{s.price}</text>
          </g>
        );
      })}

      {/* Choose a staff member */}
      <text x="30" y="394" fill="#0f172a" fontSize="13" fontWeight="700">Who would you like to see?</text>
      <rect x="30" y="402" width="500" height="34" rx="10" fill="#f8fafc" stroke="#e2e8f0" />
      <circle cx="50" cy="419" r="9" fill="#E8EFF6" stroke="#00305C" />
      <text x="68" y="423" fill="#0f172a" fontSize="11" fontWeight="500">Sarah</text>
      <circle cx="118" cy="419" r="9" fill="#f1f5f9" stroke="#cbd5e1" />
      <text x="136" y="423" fill="#64748b" fontSize="11">Mia</text>
      <text x="492" y="423" fill="#64748b" fontSize="11">▾</text>

      {/* Date and time */}
      <text x="30" y="466" fill="#0f172a" fontSize="13" fontWeight="700">Date and time</text>

      {/* Mini month grid */}
      <rect x="30" y="476" width="240" height="190" rx="12" fill="#ffffff" stroke="#e2e8f0" />
      <text x="46" y="500" fill="#0f172a" fontSize="12" fontWeight="700">July 2026</text>
      <text x="244" y="500" fill="#64748b" fontSize="12">‹  ›</text>
      {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
        <text key={i} x={48 + i * 31} y="522" textAnchor="middle" fill="#64748b" fontSize="9" fontWeight="600">{d}</text>
      ))}
      {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => {
        const idx = d - 1;
        const col = idx % 7;
        const rowN = Math.floor(idx / 7);
        const cx = 48 + col * 31;
        const cy = 540 + rowN * 28;
        const isSel = d === 14;
        return (
          <g key={d}>
            {isSel && <circle cx={cx} cy={cy} r="11" fill="#00305C" />}
            <text
              x={cx}
              y={cy + 4}
              textAnchor="middle"
              fill={isSel ? '#ffffff' : '#0f172a'}
              fontSize="9"
              fontWeight={isSel ? '700' : '400'}
            >
              {d}
            </text>
          </g>
        );
      })}

      {/* Time slot grid */}
      <rect x="282" y="476" width="248" height="190" rx="12" fill="#ffffff" stroke="#e2e8f0" />
      <text x="298" y="498" fill="#94a3b8" fontSize="9" fontWeight="700" letterSpacing="0.08em">MORNING</text>
      {[
        '09:00', '09:30', '10:00',
        '10:30', '11:00', '11:30',
        '13:00', '13:30', '14:00',
      ].map((t, i) => {
        const col = i % 3;
        const rowN = Math.floor(i / 3);
        const sx = 298 + col * 74;
        const sy = 510 + rowN * 42;
        const isSel = t === '10:30';
        return (
          <g key={t}>
            <rect
              x={sx}
              y={sy}
              width="64"
              height="32"
              rx="9"
              fill={isSel ? '#00305C' : '#f8fafc'}
              stroke={isSel ? '#00305C' : '#e2e8f0'}
            />
            <text
              x={sx + 32}
              y={sy + 21}
              textAnchor="middle"
              fill={isSel ? '#ffffff' : '#0f172a'}
              fontSize="11"
              fontWeight={isSel ? '700' : '500'}
            >
              {t}
            </text>
          </g>
        );
      })}

      {/* Confirm button */}
      <rect x="30" y="638" width="500" height="38" rx="11" fill="#00305C" />
      <text x="280" y="662" textAnchor="middle" fill="#ffffff" fontSize="13" fontWeight="700">Confirm Booking</text>
    </svg>
  );
}

function NewbookingGuestSvg() {
  return (
    <svg
      viewBox="0 0 560 470"
      className="mx-auto h-auto w-full max-w-[560px]"
      role="img"
      aria-label="The guest details step of the booking flow: four input fields for first name, surname, email (all optional) and a required phone field, with the first name field active and an open autocomplete dropdown listing two matching saved contacts plus an empty-state line."
    >
      {/* Card */}
      <rect x="12" y="12" width="536" height="446" rx="14" fill="#ffffff" stroke="#e2e8f0" strokeWidth="1.5" />

      {/* Title */}
      <text x="36" y="56" fill="#0f172a" fontSize="16" fontWeight="700">Guest details</text>

      {/* First name field (active) */}
      <text x="36" y="96" fill="#64748b" fontSize="11" fontWeight="600">First name (optional)</text>
      <rect x="36" y="104" width="488" height="40" rx="9" fill="#ffffff" stroke="#00305C" strokeWidth="2" />
      <text x="50" y="129" fill="#0f172a" fontSize="13" fontWeight="500">Sar</text>
      {/* cursor */}
      <rect x="71" y="114" width="1.6" height="20" fill="#0f172a" />

      {/* Autocomplete dropdown */}
      <rect x="36" y="150" width="488" height="146" rx="11" fill="#ffffff" stroke="#e2e8f0" strokeWidth="1.5" />
      <text x="52" y="172" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.8">MATCHING CONTACTS</text>

      {/* Row 1 */}
      <rect x="44" y="182" width="472" height="40" rx="8" fill="#f8fafc" />
      <circle cx="68" cy="202" r="14" fill="#00305C" />
      <text x="68" y="206" textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="700">S</text>
      <text x="92" y="199" fill="#0f172a" fontSize="12.5" fontWeight="700">Sarah Jenkins</text>
      <text x="92" y="214" fill="#64748b" fontSize="11">+44 7700 900118</text>

      {/* Row 2 */}
      <rect x="44" y="226" width="472" height="40" rx="8" fill="#ffffff" />
      <circle cx="68" cy="246" r="14" fill="#00305C" />
      <text x="68" y="250" textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="700">S</text>
      <text x="92" y="243" fill="#0f172a" fontSize="12.5" fontWeight="700">Sara Patel</text>
      <text x="92" y="258" fill="#64748b" fontSize="11">sara.patel@email.com</text>

      {/* Empty-state line */}
      <line x1="44" y1="272" x2="516" y2="272" stroke="#e2e8f0" strokeWidth="1" />
      <text x="52" y="288" fill="#94a3b8" fontSize="10.5">No saved contacts match that search.</text>

      {/* Surname field */}
      <text x="36" y="324" fill="#64748b" fontSize="11" fontWeight="600">Surname (optional)</text>
      <rect x="36" y="332" width="488" height="38" rx="9" fill="#ffffff" stroke="#e2e8f0" strokeWidth="1.5" />

      {/* Email field */}
      <text x="36" y="394" fill="#64748b" fontSize="11" fontWeight="600">Email (optional)</text>
      <rect x="36" y="402" width="236" height="38" rx="9" fill="#ffffff" stroke="#e2e8f0" strokeWidth="1.5" />

      {/* Phone field (required) */}
      <text x="288" y="394" fill="#64748b" fontSize="11" fontWeight="600">Phone </text>
      <text x="324" y="394" fill="#dc2626" fontSize="11" fontWeight="700">*</text>
      <rect x="288" y="402" width="236" height="38" rx="9" fill="#ffffff" stroke="#e2e8f0" strokeWidth="1.5" />
    </svg>
  );
}

function ContactsRowSvg() {
  return (
    <svg
      viewBox="0 0 620 150"
      className="h-auto w-full"
      role="img"
      aria-label="A single contact row in the Directory list for Jane Smith, showing a checkbox, a blue avatar with initials, name, phone and email, visit count and tag badges, a next booking pill, and an expand chevron."
    >
      <text x="16" y="20" fill="#64748b" fontSize="10" fontWeight="700" letterSpacing="1">DIRECTORY</text>

      <rect x="16" y="30" width="588" height="104" rx="13" fill="#ffffff" stroke="#e2e8f0" strokeWidth="1.5" />

      <rect x="34" y="74" width="16" height="16" rx="4" fill="#ffffff" stroke="#64748b" strokeWidth="1.5" />

      <rect x="64" y="50" width="44" height="44" rx="11" fill="#003B6F" />
      <text x="86" y="78" textAnchor="middle" fill="#ffffff" fontSize="16" fontWeight="700">JS</text>

      <text x="122" y="62" fill="#0f172a" fontSize="15" fontWeight="700">Jane Smith</text>

      <g>
        <rect x="122" y="74" width="13" height="13" rx="3" fill="#E8EFF6" stroke="#00305C" strokeWidth="1" />
        <path d="M125.5 77.5c0 3 2 5 5 5l1-1.6-1.8-0.9-0.9 0.7c-0.9-0.5-1.6-1.2-2.1-2.1l0.7-0.9-0.9-1.8z" fill="#00305C" />
      </g>
      <text x="141" y="84" fill="#64748b" fontSize="11">07700 900123</text>

      <g>
        <rect x="230" y="74" width="14" height="13" rx="2.5" fill="#E8EFF6" stroke="#00305C" strokeWidth="1" />
        <path d="M230.5 75.5l6.5 4.5 6.5-4.5" fill="none" stroke="#00305C" strokeWidth="1" />
      </g>
      <text x="250" y="84" fill="#64748b" fontSize="11">jane@email.com</text>

      <rect x="122" y="100" width="64" height="20" rx="10" fill="#f1f5f9" stroke="#e2e8f0" strokeWidth="1" />
      <text x="154" y="113" textAnchor="middle" fill="#0f172a" fontSize="10" fontWeight="600">12 visits</text>

      <rect x="190" y="100" width="38" height="20" rx="10" fill="#fee2e2" stroke="#fecaca" strokeWidth="1" />
      <text x="209" y="113" textAnchor="middle" fill="#dc2626" fontSize="10" fontWeight="700">1 NS</text>

      <rect x="232" y="100" width="80" height="20" rx="10" fill="#f8fafc" stroke="#e2e8f0" strokeWidth="1" />
      <text x="272" y="113" textAnchor="middle" fill="#64748b" fontSize="10" fontWeight="600">3 weeks ago</text>

      <rect x="316" y="100" width="124" height="20" rx="10" fill="#E8EFF6" stroke="#00305C" strokeWidth="1" />
      <circle cx="328" cy="110" r="2.4" fill="#00305C" />
      <text x="378" y="113" textAnchor="middle" fill="#00305C" fontSize="10" fontWeight="700">Tue 2 Jul, 10:00</text>

      <rect x="444" y="100" width="40" height="20" rx="10" fill="#f1f5f9" stroke="#e2e8f0" strokeWidth="1" />
      <text x="464" y="113" textAnchor="middle" fill="#64748b" fontSize="10" fontWeight="600">VIP</text>

      <rect x="488" y="100" width="56" height="20" rx="10" fill="#f1f5f9" stroke="#e2e8f0" strokeWidth="1" />
      <text x="516" y="113" textAnchor="middle" fill="#64748b" fontSize="10" fontWeight="600">Regular</text>

      <text x="550" y="113" fill="#64748b" fontSize="10" fontWeight="700">+1</text>

      <path d="M576 76l7 7 7-7" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ContactsDetailSvg() {
  return (
    <svg
      viewBox="0 0 600 720"
      className="mx-auto h-auto w-full max-w-[600px]"
      role="img"
      aria-label="The expanded contact detail panel beneath a contact row: three stat blocks for Visits, Last visit and Next visit; name, email and phone fields with an Edit button; a Tags editor with pills and an add input; a row with New booking, Merge and Erase data actions; a Guest bookings history list; and a Messages and privacy section with a Send via selector, message box and Send button."
    >
      <rect x="10" y="10" width="580" height="700" rx="14" fill="#f8fafc" stroke="#e2e8f0" />

      <rect x="10" y="10" width="580" height="40" rx="14" fill="#ffffff" stroke="#e2e8f0" />
      <circle cx="40" cy="30" r="12" fill="#E8EFF6" stroke="#00305C" />
      <text x="40" y="34" textAnchor="middle" fill="#00305C" fontSize="10" fontWeight="700">SM</text>
      <text x="62" y="34" fill="#0f172a" fontSize="12" fontWeight="700">Sarah Mitchell</text>
      <text x="570" y="34" textAnchor="end" fill="#64748b" fontSize="13">▾</text>

      <rect x="26" y="66" width="174" height="60" rx="12" fill="#ffffff" stroke="#e2e8f0" />
      <text x="42" y="88" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.07em">VISITS</text>
      <text x="42" y="114" fill="#0f172a" fontSize="20" fontWeight="700">12</text>

      <rect x="213" y="66" width="174" height="60" rx="12" fill="#ffffff" stroke="#e2e8f0" />
      <text x="229" y="88" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.07em">LAST VISIT</text>
      <text x="229" y="114" fill="#0f172a" fontSize="16" fontWeight="700">14 Jun</text>

      <rect x="400" y="66" width="174" height="60" rx="12" fill="#ffffff" stroke="#e2e8f0" />
      <text x="416" y="88" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.07em">NEXT VISIT</text>
      <text x="416" y="113" fill="#64748b" fontSize="12" fontWeight="600">None scheduled</text>

      <rect x="26" y="142" width="548" height="120" rx="12" fill="#ffffff" stroke="#e2e8f0" />
      <text x="42" y="164" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.07em">CONTACT DETAILS</text>
      <rect x="470" y="150" width="88" height="24" rx="8" fill="#ffffff" stroke="#cbd5e1" />
      <text x="514" y="166" textAnchor="middle" fill="#0f172a" fontSize="11" fontWeight="600">Edit</text>

      <text x="42" y="190" fill="#64748b" fontSize="9" fontWeight="600">Name</text>
      <rect x="42" y="196" width="240" height="26" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="54" y="213" fill="#0f172a" fontSize="11" fontWeight="500">Sarah Mitchell</text>

      <text x="318" y="190" fill="#64748b" fontSize="9" fontWeight="600">Phone</text>
      <rect x="318" y="196" width="240" height="26" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="330" y="213" fill="#0f172a" fontSize="11" fontWeight="500">07700 900123</text>

      <text x="42" y="240" fill="#64748b" fontSize="9" fontWeight="600">Email</text>
      <rect x="42" y="246" width="516" height="24" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="54" y="262" fill="#0f172a" fontSize="11" fontWeight="500">sarah.mitchell@example.com</text>

      <rect x="26" y="278" width="548" height="70" rx="12" fill="#ffffff" stroke="#e2e8f0" />
      <text x="42" y="300" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.07em">TAGS</text>
      <rect x="42" y="312" width="78" height="22" rx="11" fill="#C2F4F5" />
      <text x="81" y="327" textAnchor="middle" fill="#00305C" fontSize="10" fontWeight="600">VIP  x</text>
      <rect x="128" y="312" width="100" height="22" rx="11" fill="#E8EFF6" />
      <text x="178" y="327" textAnchor="middle" fill="#00305C" fontSize="10" fontWeight="600">Regular  x</text>
      <rect x="238" y="312" width="150" height="22" rx="11" fill="#ffffff" stroke="#e2e8f0" />
      <text x="252" y="327" fill="#64748b" fontSize="10">+ Add a tag…</text>

      <rect x="42" y="364" width="148" height="34" rx="9" fill="#003B6F" />
      <text x="64" y="386" fill="#ffffff" fontSize="14" fontWeight="700">+</text>
      <text x="78" y="385" fill="#ffffff" fontSize="11" fontWeight="600">New booking</text>

      <rect x="200" y="364" width="92" height="34" rx="9" fill="#ffffff" stroke="#e2e8f0" />
      <text x="246" y="385" textAnchor="middle" fill="#0f172a" fontSize="11" fontWeight="600">Merge…</text>

      <text x="492" y="383" textAnchor="middle" fill="#dc2626" fontSize="11" fontWeight="600">Erase data</text>
      <text x="492" y="396" textAnchor="middle" fill="#64748b" fontSize="8">admin only</text>

      <rect x="26" y="414" width="548" height="116" rx="12" fill="#ffffff" stroke="#e2e8f0" />
      <text x="42" y="437" fill="#0f172a" fontSize="12" fontWeight="700">Guest bookings</text>
      <text x="558" y="437" textAnchor="end" fill="#64748b" fontSize="13">▾</text>

      <line x1="42" y1="450" x2="558" y2="450" stroke="#f1f5f9" strokeWidth="1" />
      <circle cx="52" cy="468" r="4" fill="#059669" />
      <text x="66" y="472" fill="#0f172a" fontSize="11" fontWeight="500">14 Jun, Deep tissue massage</text>
      <text x="558" y="472" textAnchor="end" fill="#059669" fontSize="10" fontWeight="600">Completed</text>

      <line x1="42" y1="486" x2="558" y2="486" stroke="#f1f5f9" strokeWidth="1" />
      <circle cx="52" cy="504" r="4" fill="#059669" />
      <text x="66" y="508" fill="#0f172a" fontSize="11" fontWeight="500">02 May, Facial treatment</text>
      <text x="558" y="508" textAnchor="end" fill="#059669" fontSize="10" fontWeight="600">Completed</text>

      <line x1="42" y1="514" x2="558" y2="514" stroke="#f1f5f9" strokeWidth="1" />

      <rect x="26" y="546" width="548" height="148" rx="12" fill="#ffffff" stroke="#e2e8f0" />
      <text x="42" y="568" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.07em">MESSAGES &amp; PRIVACY</text>

      <text x="42" y="588" fill="#64748b" fontSize="9" fontWeight="600">Send via</text>
      <rect x="42" y="594" width="200" height="26" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="54" y="611" fill="#0f172a" fontSize="10" fontWeight="500">Email &amp; SMS (if available)</text>
      <text x="228" y="611" fill="#64748b" fontSize="11">▾</text>

      <rect x="42" y="628" width="516" height="40" rx="8" fill="#f8fafc" stroke="#e2e8f0" />
      <text x="54" y="645" fill="#64748b" fontSize="10">SMS / email to Sarah…</text>

      <rect x="478" y="664" width="80" height="22" rx="9" fill="#0f172a" />
      <text x="518" y="679" textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="600">Send</text>
    </svg>
  );
}

function WaitlistLifecycleSvg() {
  return (
    <svg
      viewBox="0 0 640 340"
      className="h-auto w-full"
      role="img"
      aria-label="A waitlist entry flow: a Waiting status in amber leads to an Offered status in brand blue with an expiry tag, which leads to a green Complete status. Expired in grey branches off Offered, and Cancelled in red can be reached from both Waiting and Offered."
    >
      <text x="20" y="28" fill="#64748b" fontSize="11" fontWeight="700" letterSpacing="0.6">WAITLIST ENTRY LIFECYCLE</text>

      <defs>
        <marker id="wl-arrow" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto">
          <path d="M0,0 L7,3 L0,6 Z" fill="#64748b" />
        </marker>
        <marker id="wl-arrow-red" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto">
          <path d="M0,0 L7,3 L0,6 Z" fill="#dc2626" />
        </marker>
      </defs>

      <line x1="200" y1="92" x2="248" y2="92" stroke="#64748b" strokeWidth="1.5" markerEnd="url(#wl-arrow)" />
      <text x="224" y="80" textAnchor="middle" fill="#0f172a" fontSize="10" fontWeight="600">Offer spot</text>

      <line x1="443" y1="92" x2="492" y2="92" stroke="#64748b" strokeWidth="1.5" markerEnd="url(#wl-arrow)" />
      <text x="468" y="74" textAnchor="middle" fill="#0f172a" fontSize="10" fontWeight="600">Guest takes</text>
      <text x="468" y="86" textAnchor="middle" fill="#0f172a" fontSize="10" fontWeight="600">up offer</text>

      <rect x="60" y="72" width="140" height="40" rx="20" fill="#fef3c7" stroke="#d97706" strokeWidth="1.5" />
      <circle cx="92" cy="92" r="6" fill="#d97706" />
      <text x="122" y="96" textAnchor="middle" fill="#d97706" fontSize="13" fontWeight="700">Waiting</text>

      <rect x="305" y="72" width="138" height="40" rx="20" fill="#00305C" stroke="#003B6F" strokeWidth="1.5" />
      <circle cx="336" cy="92" r="6" fill="#C2F4F5" />
      <text x="366" y="96" textAnchor="middle" fill="#ffffff" fontSize="13" fontWeight="700">Offered</text>
      <rect x="318" y="120" width="112" height="22" rx="6" fill="#E8EFF6" stroke="#003B6F" strokeWidth="1" />
      <text x="374" y="135" textAnchor="middle" fill="#003B6F" fontSize="10" fontWeight="600">Expires 14:30</text>

      <rect x="492" y="72" width="128" height="40" rx="20" fill="#059669" stroke="#047857" strokeWidth="1.5" />
      <circle cx="520" cy="92" r="6" fill="#C2F4F5" />
      <text x="554" y="96" textAnchor="middle" fill="#ffffff" fontSize="13" fontWeight="700">Complete</text>

      <path d="M374,142 L374,206 L300,206" fill="none" stroke="#64748b" strokeWidth="1.5" markerEnd="url(#wl-arrow)" />
      <text x="384" y="180" fill="#64748b" fontSize="10" fontWeight="600">offer ran out</text>
      <rect x="160" y="186" width="132" height="40" rx="20" fill="#f1f5f9" stroke="#64748b" strokeWidth="1.5" />
      <circle cx="190" cy="206" r="6" fill="#64748b" />
      <text x="220" y="210" textAnchor="middle" fill="#64748b" fontSize="13" fontWeight="700">Expired</text>

      <path d="M130,112 L130,288 L230,288" fill="none" stroke="#dc2626" strokeWidth="1.5" markerEnd="url(#wl-arrow-red)" />
      <path d="M362,142 L362,288 L312,288" fill="none" stroke="#dc2626" strokeWidth="1.5" markerEnd="url(#wl-arrow-red)" />
      <text x="240" y="262" textAnchor="middle" fill="#dc2626" fontSize="10" fontWeight="600">cancelled</text>

      <rect x="237" y="268" width="138" height="40" rx="20" fill="#fee2e2" stroke="#dc2626" strokeWidth="1.5" />
      <circle cx="268" cy="288" r="6" fill="#dc2626" />
      <text x="300" y="292" textAnchor="middle" fill="#dc2626" fontSize="13" fontWeight="700">Cancelled</text>
    </svg>
  );
}

function WaitlistListSvg() {
  return (
    <svg
      viewBox="0 0 640 360"
      className="h-auto w-full"
      role="img"
      aria-label="The dashboard Waitlist page: an Operations header titled Waitlist with a Live pill and Active and All tabs, above an Active requests card listing three appointment rows with Waiting, Offered, and Complete status pills, an Offer spot button, a Cancel button, and an Expires note."
    >
      <text x="20" y="28" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">OPERATIONS</text>
      <text x="20" y="52" fill="#0f172a" fontSize="20" fontWeight="700">Waitlist</text>
      <rect x="110" y="36" width="54" height="20" rx="10" fill="#d1fae5" />
      <circle cx="124" cy="46" r="3.5" fill="#059669" />
      <text x="133" y="50" fill="#059669" fontSize="10" fontWeight="700">Live</text>

      <rect x="470" y="30" width="150" height="32" rx="9" fill="#f1f5f9" />
      <rect x="475" y="35" width="70" height="22" rx="7" fill="#ffffff" stroke="#e2e8f0" />
      <text x="510" y="50" textAnchor="middle" fill="#00305C" fontSize="11" fontWeight="700">Active</text>
      <text x="585" y="50" textAnchor="middle" fill="#64748b" fontSize="11" fontWeight="500">All</text>

      <rect x="14" y="76" width="612" height="268" rx="14" fill="#ffffff" stroke="#e2e8f0" />
      <text x="34" y="102" fill="#94a3b8" fontSize="9" fontWeight="700" letterSpacing="0.08em">QUEUE</text>
      <text x="34" y="120" fill="#0f172a" fontSize="14" fontWeight="700">Active requests</text>
      <text x="606" y="120" textAnchor="end" fill="#64748b" fontSize="10" fontWeight="600">3 entries</text>

      <rect x="34" y="134" width="572" height="60" rx="12" fill="#f8fafc" stroke="#e2e8f0" />
      <rect x="34" y="134" width="5" height="60" rx="2.5" fill="#f59e0b" />
      <text x="56" y="160" fill="#0f172a" fontSize="11" fontWeight="700">14:00</text>
      <text x="120" y="156" fill="#0f172a" fontSize="12" fontWeight="700">Emma Wright</text>
      <text x="120" y="174" fill="#64748b" fontSize="9">Deep Tissue &middot; Any team member &middot; Mon 7 Jul &middot; emma.w@mail.com</text>
      <rect x="360" y="146" width="60" height="20" rx="10" fill="#fef3c7" />
      <text x="390" y="160" textAnchor="middle" fill="#b45309" fontSize="10" fontWeight="700">Waiting</text>
      <rect x="428" y="148" width="86" height="24" rx="8" fill="#00305C" />
      <text x="471" y="164" textAnchor="middle" fill="#ffffff" fontSize="10" fontWeight="700">Offer spot</text>
      <rect x="522" y="148" width="66" height="24" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="555" y="164" textAnchor="middle" fill="#64748b" fontSize="10" fontWeight="600">Cancel</text>

      <rect x="34" y="204" width="572" height="60" rx="12" fill="#f8fafc" stroke="#e2e8f0" />
      <rect x="34" y="204" width="5" height="60" rx="2.5" fill="#00305C" />
      <text x="56" y="230" fill="#0f172a" fontSize="11" fontWeight="700">10:30</text>
      <text x="120" y="226" fill="#0f172a" fontSize="12" fontWeight="700">James Okafor</text>
      <text x="120" y="244" fill="#64748b" fontSize="9">Sports Massage &middot; Sarah Lewis &middot; Tue 8 Jul &middot; +44 7700 900123</text>
      <rect x="396" y="216" width="62" height="20" rx="10" fill="#E8EFF6" />
      <text x="427" y="230" textAnchor="middle" fill="#00305C" fontSize="10" fontWeight="700">Offered</text>
      <text x="466" y="245" fill="#b45309" fontSize="9.5" fontWeight="600">Expires 14:30</text>

      <rect x="34" y="274" width="572" height="60" rx="12" fill="#f8fafc" stroke="#e2e8f0" />
      <rect x="34" y="274" width="5" height="60" rx="2.5" fill="#10b981" />
      <text x="56" y="300" fill="#0f172a" fontSize="11" fontWeight="700">16:15</text>
      <text x="120" y="296" fill="#0f172a" fontSize="12" fontWeight="700">Priya Shah</text>
      <text x="120" y="314" fill="#64748b" fontSize="9">Sports Massage &middot; Tom Reed &middot; Wed 9 Jul &middot; priya.s@mail.com</text>
      <rect x="480" y="286" width="72" height="20" rx="10" fill="#d1fae5" />
      <text x="516" y="300" textAnchor="middle" fill="#047857" fontSize="10" fontWeight="700">Complete</text>
    </svg>
  );
}

function ComplianceConceptsSvg() {
  return (
    <svg
      viewBox="0 0 700 300"
      className="h-auto w-full"
      role="img"
      aria-label="A left-to-right flow: a compliance type is attached to a service as a requirement, the guest completes it to create a record, and the record stays valid for a year before expiring."
    >
      {/* Box 1 - Compliance type */}
      <rect x="14" y="40" width="190" height="92" rx="13" fill="#E8EFF6" stroke="#00305C" strokeWidth="1.5" />
      <text x="30" y="62" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.5">COMPLIANCE TYPE</text>
      <text x="30" y="88" fill="#0f172a" fontSize="15" fontWeight="700">Patch test</text>
      <text x="30" y="110" fill="#64748b" fontSize="10">the kind of record</text>

      {/* Arrow 1 */}
      <text x="251" y="74" textAnchor="middle" fill="#00305C" fontSize="9" fontWeight="700">attached to</text>
      <text x="251" y="86" textAnchor="middle" fill="#00305C" fontSize="9" fontWeight="700">a service</text>
      <line x1="208" y1="96" x2="290" y2="96" stroke="#00305C" strokeWidth="2" />
      <path d="M290 96 l-9 -5 v10 z" fill="#00305C" />

      {/* Box 2 - Service requirement */}
      <rect x="298" y="40" width="190" height="92" rx="13" fill="#E8EFF6" stroke="#00305C" strokeWidth="1.5" />
      <text x="314" y="62" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.5">SERVICE REQUIREMENT</text>
      <text x="314" y="88" fill="#0f172a" fontSize="15" fontWeight="700">Service asks</text>
      <text x="314" y="106" fill="#64748b" fontSize="10">for it, with an</text>
      <text x="314" y="120" fill="#64748b" fontSize="10">enforcement level</text>

      {/* Arrow 2 */}
      <text x="535" y="74" textAnchor="middle" fill="#00305C" fontSize="9" fontWeight="700">guest</text>
      <text x="535" y="86" textAnchor="middle" fill="#00305C" fontSize="9" fontWeight="700">completes it</text>
      <line x1="492" y1="96" x2="574" y2="96" stroke="#00305C" strokeWidth="2" />
      <path d="M574 96 l-9 -5 v10 z" fill="#00305C" />

      {/* Box 3 - Record */}
      <rect x="582" y="40" width="104" height="92" rx="13" fill="#00305C" />
      <text x="598" y="62" fill="#C2F4F5" fontSize="9" fontWeight="700" letterSpacing="0.5">RECORD</text>
      <text x="598" y="88" fill="#ffffff" fontSize="15" fontWeight="700">Done</text>
      <text x="598" y="108" fill="#E8EFF6" fontSize="10">the completed</text>
      <text x="598" y="121" fill="#E8EFF6" fontSize="10">form</text>

      {/* Expiry chain below Box 3 */}
      {/* connector down from record */}
      <line x1="634" y1="132" x2="634" y2="166" stroke="#94a3b8" strokeWidth="1.5" />
      <path d="M634 166 l-5 -9 h10 z" fill="#94a3b8" />

      {/* Valid-until calendar chip */}
      <rect x="500" y="172" width="186" height="48" rx="11" fill="#f1f5f9" stroke="#e2e8f0" strokeWidth="1" />
      <rect x="514" y="184" width="24" height="24" rx="5" fill="#ffffff" stroke="#64748b" strokeWidth="1.2" />
      <line x1="514" y1="191" x2="538" y2="191" stroke="#64748b" strokeWidth="1.2" />
      <line x1="521" y1="181" x2="521" y2="187" stroke="#64748b" strokeWidth="1.2" />
      <line x1="531" y1="181" x2="531" y2="187" stroke="#64748b" strokeWidth="1.2" />
      <text x="548" y="192" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.3">VALID UNTIL</text>
      <text x="548" y="206" fill="#0f172a" fontSize="12" fontWeight="700">1 year</text>

      {/* dashed arrow to Expired */}
      <line x1="486" y1="196" x2="408" y2="196" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="4 4" />
      <path d="M408 196 l9 -5 v10 z" fill="#94a3b8" />
      <text x="447" y="186" textAnchor="middle" fill="#94a3b8" fontSize="9">lapses on</text>
      <text x="447" y="216" textAnchor="middle" fill="#94a3b8" fontSize="9">expiry date</text>

      {/* Expired badge (faded) */}
      <g opacity="0.6">
        <rect x="300" y="180" width="92" height="34" rx="10" fill="#fee2e2" stroke="#dc2626" strokeWidth="1" />
        <text x="346" y="202" textAnchor="middle" fill="#dc2626" fontSize="12" fontWeight="700">Expired</text>
      </g>
    </svg>
  );
}

function ComplianceEnforceSvg() {
  const rungs = [
    {
      label: 'Block all bookings',
      sub: 'Nobody can book until a valid record exists',
      fill: '#dc2626',
      tint: '#fee2e2',
      stroke: '#dc2626',
      text: '#ffffff',
      subText: '#fee2e2',
    },
    {
      label: 'Block online booking',
      sub: 'No online booking; staff can still book',
      fill: '#ef4444',
      tint: '#fee2e2',
      stroke: '#dc2626',
      text: '#ffffff',
      subText: '#fee2e2',
    },
    {
      label: 'Warn client',
      sub: 'Guest warned online, can still book',
      fill: '#f59e0b',
      tint: '#fef3c7',
      stroke: '#d97706',
      text: '#0f172a',
      subText: '#7c2d12',
    },
    {
      label: 'Warn staff',
      sub: 'Team sees a flag, nothing blocked',
      fill: '#fde68a',
      tint: '#fef3c7',
      stroke: '#d97706',
      text: '#0f172a',
      subText: '#7c2d12',
    },
  ];
  const rowH = 62;
  const gap = 10;
  const top = 58;
  const barX = 96;
  const barW = 520;
  return (
    <svg
      viewBox="0 0 660 360"
      className="h-auto w-full"
      role="img"
      aria-label="A four-rung ladder of When unmet enforcement levels, from Warn staff at the bottom in amber up to Block all bookings at the top in red, getting stricter towards the top."
    >
      {/* eyebrow */}
      <text x="96" y="26" fill="#64748b" fontSize="11" fontWeight="700" letterSpacing="1.2">WHEN UNMET</text>
      <text x="96" y="44" fill="#0f172a" fontSize="13" fontWeight="700">Enforcement level</text>

      {/* stricter arrow on the left */}
      <line x1="40" y1={top + rowH * 3 + gap * 3 + 20} x2="40" y2={top + 6} stroke="#64748b" strokeWidth="2" />
      <path
        d={`M40 ${top + 2} l-5 9 l10 0 z`}
        fill="#64748b"
      />
      <text
        x="22"
        y={top + rowH * 1.7}
        fill="#64748b"
        fontSize="11"
        fontWeight="700"
        letterSpacing="1"
        transform={`rotate(-90 22 ${top + rowH * 1.7})`}
        textAnchor="middle"
      >
        STRICTER
      </text>

      {rungs.map((r, i) => {
        const y = top + i * (rowH + gap);
        return (
          <g key={r.label}>
            <rect
              x={barX}
              y={y}
              width={barW}
              height={rowH}
              rx="13"
              fill={r.fill}
              stroke={r.stroke}
              strokeWidth="1"
            />
            <text x={barX + 22} y={y + 27} fill={r.text} fontSize="15" fontWeight="700">
              {r.label}
            </text>
            <text x={barX + 22} y={y + 47} fill={r.subText} fontSize="11" fontWeight="500">
              {r.sub}
            </text>
            {/* rung index chip on the right */}
            <circle cx={barX + barW - 28} cy={y + rowH / 2} r="14" fill="#ffffff" opacity="0.92" />
            <text
              x={barX + barW - 28}
              y={y + rowH / 2 + 5}
              textAnchor="middle"
              fill={r.stroke}
              fontSize="14"
              fontWeight="800"
            >
              {rungs.length - i}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function ComplianceDashboardSvg() {
  return (
    <svg
      viewBox="0 0 560 532"
      className="mx-auto h-auto w-full max-w-[560px]"
      role="img"
      aria-label="The Compliance page stacks four cards: Check-in today with Complete now and Send link buttons; Missing for upcoming bookings with a status pill and Send link; Expiring soon with an amber Expiring pill and Send renewal; and Awaiting client submission with a Pending pill."
    >
      {/* Card 1 - Check-in today */}
      <rect x="10" y="10" width="540" height="118" rx="14" fill="#ffffff" stroke="#e2e8f0" />
      <text x="30" y="36" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">TODAY</text>
      <text x="30" y="58" fill="#0f172a" fontSize="15" fontWeight="700">Check-in today</text>
      <text x="30" y="76" fill="#64748b" fontSize="11">Review forms due before today&apos;s appointments.</text>
      {/* sample row */}
      <rect x="30" y="86" width="500" height="30" rx="9" fill="#f8fafc" stroke="#e2e8f0" />
      <circle cx="50" cy="101" r="9" fill="#E8EFF6" />
      <text x="50" y="105" textAnchor="middle" fill="#00305C" fontSize="9" fontWeight="700">JM</text>
      <text x="68" y="105" fill="#0f172a" fontSize="11" fontWeight="500">Jamie Morgan</text>
      <text x="180" y="105" fill="#64748b" fontSize="10">10:30 facial</text>
      <rect x="306" y="91" width="98" height="20" rx="10" fill="#00305C" />
      <text x="355" y="105" textAnchor="middle" fill="#ffffff" fontSize="10" fontWeight="600">Complete now</text>
      <rect x="412" y="91" width="78" height="20" rx="10" fill="#00A0A4" />
      <text x="451" y="105" textAnchor="middle" fill="#ffffff" fontSize="10" fontWeight="600">Send link</text>

      {/* Card 2 - Missing for upcoming bookings */}
      <rect x="10" y="140" width="540" height="118" rx="14" fill="#ffffff" stroke="#e2e8f0" />
      <text x="30" y="166" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">MISSING</text>
      <text x="30" y="188" fill="#0f172a" fontSize="15" fontWeight="700">Missing for upcoming bookings</text>
      <text x="30" y="206" fill="#64748b" fontSize="11">No consent on file for a future appointment.</text>
      <rect x="30" y="216" width="500" height="30" rx="9" fill="#f8fafc" stroke="#e2e8f0" />
      <circle cx="50" cy="231" r="9" fill="#E8EFF6" />
      <text x="50" y="235" textAnchor="middle" fill="#00305C" fontSize="9" fontWeight="700">PL</text>
      <text x="68" y="235" fill="#0f172a" fontSize="11" fontWeight="500">Priya Lal</text>
      <text x="180" y="235" fill="#64748b" fontSize="10">Fri 3 Jul</text>
      <rect x="338" y="221" width="74" height="20" rx="10" fill="#fee2e2" />
      <text x="375" y="235" textAnchor="middle" fill="#dc2626" fontSize="10" fontWeight="600">Missing</text>
      <rect x="420" y="221" width="70" height="20" rx="10" fill="#00A0A4" />
      <text x="455" y="235" textAnchor="middle" fill="#ffffff" fontSize="10" fontWeight="600">Send link</text>

      {/* Card 3 - Expiring soon */}
      <rect x="10" y="270" width="540" height="118" rx="14" fill="#ffffff" stroke="#e2e8f0" />
      <text x="30" y="296" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">EXPIRING</text>
      <text x="30" y="318" fill="#0f172a" fontSize="15" fontWeight="700">Expiring soon</text>
      <text x="30" y="336" fill="#64748b" fontSize="11">Records that lapse within the next 30 days.</text>
      <rect x="30" y="346" width="500" height="30" rx="9" fill="#f8fafc" stroke="#e2e8f0" />
      <circle cx="50" cy="361" r="9" fill="#E8EFF6" />
      <text x="50" y="365" textAnchor="middle" fill="#00305C" fontSize="9" fontWeight="700">DC</text>
      <text x="68" y="365" fill="#0f172a" fontSize="11" fontWeight="500">Dan Cole</text>
      <text x="180" y="365" fill="#64748b" fontSize="10">Expires 9 Jul</text>
      <rect x="330" y="351" width="80" height="20" rx="10" fill="#fef3c7" />
      <text x="370" y="365" textAnchor="middle" fill="#d97706" fontSize="10" fontWeight="600">Expiring</text>
      <rect x="402" y="351" width="88" height="20" rx="10" fill="#00305C" />
      <text x="446" y="365" textAnchor="middle" fill="#ffffff" fontSize="10" fontWeight="600">Send renewal</text>

      {/* Card 4 - Awaiting client submission */}
      <rect x="10" y="400" width="540" height="118" rx="14" fill="#ffffff" stroke="#e2e8f0" />
      <text x="30" y="426" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">AWAITING</text>
      <text x="30" y="448" fill="#0f172a" fontSize="15" fontWeight="700">Awaiting client submission</text>
      <text x="30" y="466" fill="#64748b" fontSize="11">Link sent, waiting for the client to reply.</text>
      <rect x="30" y="476" width="500" height="30" rx="9" fill="#f8fafc" stroke="#e2e8f0" />
      <circle cx="50" cy="491" r="9" fill="#E8EFF6" />
      <text x="50" y="495" textAnchor="middle" fill="#00305C" fontSize="9" fontWeight="700">SR</text>
      <text x="68" y="495" fill="#0f172a" fontSize="11" fontWeight="500">Sam Reed</text>
      <text x="180" y="495" fill="#64748b" fontSize="10">Sent 2 days ago</text>
      <rect x="416" y="481" width="74" height="20" rx="10" fill="#f1f5f9" stroke="#e2e8f0" />
      <text x="453" y="495" textAnchor="middle" fill="#64748b" fontSize="10" fontWeight="600">Pending</text>
    </svg>
  );
}

export const RUN_FIGURES: Record<string, { title: string; caption: string; node: ReactNode }> = {
  "calendar-grid": { title: "The day view", caption: "The calendar day view: a toolbar above a time grid with one column per calendar and coloured booking cards.", node: <CalendarGridSvg /> },
  "calendar-card": { title: "A booking card", caption: "A single booking card showing the guest details, a status pill, and the quick action buttons.", node: <CalendarCardSvg /> },
  "calendar-status": { title: "The status flow", caption: "How a booking moves from Pending through to Completed, with Cancelled and No Show as end states.", node: <CalendarStatusSvg /> },
  "bookings-row": { title: "A booking row in the list", caption: "One row in the Bookings list, showing the selection checkbox, the guest, the time, the service, the staff member, and a status pill.", node: <BookingsRowSvg /> },
  "bookings-filters": { title: "The list toolbar and filters", caption: "The toolbar across the top of the list with view, search, and filter, the filter panel below it, and the floating selection tray's bulk actions.", node: <BookingsFiltersSvg /> },
  "newbooking-form": { title: "New Booking, Appointment tab", caption: "A combined illustration of the Appointment booking steps: the booking-type tabs, the Select a service list, choosing a staff member, then the Date and time step with a month picker and grouped time slots.", node: <NewbookingFormSvg /> },
  "newbooking-guest": { title: "Guest details with saved-contact search", caption: "Typing into the guest fields searches your saved contacts and shows matches in a dropdown.", node: <NewbookingGuestSvg /> },
  "contacts-row": { title: "A contact row in the Directory", caption: "One row in the Contacts directory showing avatar, name, contact details, visit count and tags.", node: <ContactsRowSvg /> },
  "contacts-detail": { title: "The expanded contact detail panel", caption: "The contact detail panel with visit stats, tags, Guest bookings history and the New booking and Send actions.", node: <ContactsDetailSvg /> },
  "waitlist-lifecycle": { title: "Waitlist entry lifecycle", caption: "How a waitlist entry moves from waiting to offered to complete, with expired and cancelled as side outcomes.", node: <WaitlistLifecycleSvg /> },
  "waitlist-list": { title: "Waitlist screen", caption: "The Waitlist screen showing appointment entries with status pills and the offer action.", node: <WaitlistListSvg /> },
  "compliance-concepts": { title: "Type, requirement, record", caption: "How a compliance type becomes a service requirement and then a dated record on a guest&apos;s file.", node: <ComplianceConceptsSvg /> },
  "compliance-enforce": { title: "When unmet: enforcement levels", caption: "The four enforcement levels run from a quiet staff warning up to blocking every booking.", node: <ComplianceEnforceSvg /> },
  "compliance-dashboard": { title: "Compliance dashboard panels", caption: "The compliance page stacks four panels so you can clear missing, expiring and pending records in one pass.", node: <ComplianceDashboardSvg /> },
};
