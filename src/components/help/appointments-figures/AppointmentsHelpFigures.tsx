'use client';

import { useId, type ReactNode } from 'react';
import { SMS_INCLUDED_APPOINTMENTS, SMS_INCLUDED_LIGHT, SMS_INCLUDED_PLUS } from '@/lib/billing/sms-allowance';

const brand = '#00305C';
const brandLight = '#e8f0f2';
const slate = '#64748b';
const slateDark = '#0f172a';
const border = '#e2e8f0';
const white = '#ffffff';

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

/** Schematic layout matching dashboard chrome (not pixel-perfect). */
function TierComparisonSvg() {
  return (
    <svg viewBox="0 0 720 200" className="h-auto w-full max-w-full" aria-hidden>
      <rect x="8" y="12" width="224" height="176" rx="12" fill={brandLight} stroke="#cbd5e1" />
      <text x="120" y="44" textAnchor="middle" fill={slateDark} fontSize="15" fontWeight="700">
        Light
      </text>
      <text x="120" y="72" textAnchor="middle" fill={slate} fontSize="12">
        1 calendar · 1 login
      </text>
      <text x="120" y="98" textAnchor="middle" fill={slate} fontSize="11">
        {SMS_INCLUDED_LIGHT} SMS / month included
      </text>
      <rect x="248" y="12" width="224" height="176" rx="12" fill="white" stroke={brand} strokeWidth="2" />
      <text x="360" y="44" textAnchor="middle" fill={slateDark} fontSize="15" fontWeight="700">
        Plus
      </text>
      <text x="360" y="72" textAnchor="middle" fill={slate} fontSize="12">
        Up to 5 calendars
      </text>
      <text x="360" y="92" textAnchor="middle" fill={slate} fontSize="12">
        Up to 5 team logins
      </text>
      <text x="360" y="118" textAnchor="middle" fill={slate} fontSize="11">
        {SMS_INCLUDED_PLUS} SMS / month included
      </text>
      <rect x="488" y="12" width="224" height="176" rx="12" fill="white" stroke="#94a3b8" />
      <text x="600" y="44" textAnchor="middle" fill={slateDark} fontSize="15" fontWeight="700">
        Pro
      </text>
      <text x="600" y="72" textAnchor="middle" fill={slate} fontSize="12">
        Unlimited calendars
      </text>
      <text x="600" y="92" textAnchor="middle" fill={slate} fontSize="12">
        Unlimited team logins
      </text>
      <text x="600" y="118" textAnchor="middle" fill={slate} fontSize="11">
        {SMS_INCLUDED_APPOINTMENTS} SMS / month included
      </text>
    </svg>
  );
}

function SidebarNavSvg() {
  const items = [
    'Home',
    'Bookings',
    'Appointment Calendar',
    'New Booking',
    'Contacts',
    'Services',
    'Classes',
    'Events',
    'Resources',
    'Calendar Availability',
    'Reports',
    'Settings',
  ];
  return (
    <svg viewBox="0 0 260 420" className="mx-auto h-auto w-full max-w-[260px]" aria-hidden>
      <rect width="260" height="420" rx="0" fill="#f1f5f9" />
      <rect x="10" y="14" width="240" height="392" rx="16" fill={white} stroke={border} />
      <text x="24" y="38" fill={slate} fontSize="9" fontWeight="600" letterSpacing="0.06em">
        DASHBOARD
      </text>
      {items.map((label, i) => {
        const active = label === 'Services';
        const y = 52 + i * 28;
        return (
          <g key={label}>
            <rect
              x="14"
              y={y - 10}
              width="232"
              height="24"
              rx="10"
              fill={active ? white : 'transparent'}
              stroke={active ? border : 'transparent'}
            />
            <circle cx="26" cy={y - 2} r="2.5" fill={active ? brand : '#cbd5e1'} />
            <text x="36" y={y + 2} fill={active ? brand : slateDark} fontSize="10" fontWeight={active ? '700' : '500'}>
              {label}
            </text>
          </g>
        );
      })}
      <rect x="14" y="358" width="232" height="40" rx="10" fill="#f8fafc" stroke={border} />
      <text x="24" y="378" fill={slateDark} fontSize="9" fontWeight="600">
        Your venue
      </text>
      <text x="24" y="392" fill={slate} fontSize="8">
        Staff profile card
      </text>
    </svg>
  );
}

function CalendarAvailabilitySvg() {
  return (
    <svg viewBox="0 0 640 260" className="h-auto w-full" aria-hidden>
      <text x="24" y="34" fill={slate} fontSize="10" fontWeight="600" letterSpacing="0.08em">
        VENUE
      </text>
      <text x="24" y="56" fill={slateDark} fontSize="18" fontWeight="700">
        Availability Settings
      </text>
      {['Calendars', 'Availability', 'Breaks', 'Closures'].map((t, i) => (
        <g key={t}>
          <rect x={24 + i * 118} y="72" width="108" height="30" rx="10" fill={i === 0 ? brand : '#f1f5f9'} stroke={border} />
          <text x={78 + i * 118} y="92" textAnchor="middle" fill={i === 0 ? white : slateDark} fontSize="10" fontWeight="700">
            {t}
          </text>
        </g>
      ))}
      <rect x="24" y="118" width="592" height="120" rx="14" fill={white} stroke={border} />
      <text x="44" y="146" fill={slateDark} fontSize="12" fontWeight="700">
        Calendars
      </text>
      <rect x="460" y="130" width="120" height="26" rx="8" fill={brand} />
      <text x="520" y="147" textAnchor="middle" fill="white" fontSize="9" fontWeight="700">
        + Add calendar
      </text>
      <text x="44" y="168" fill={slate} fontSize="9">
        Each column is a bookable schedule…
      </text>
      <rect x="40" y="182" width="560" height="44" rx="10" fill="#f8fafc" stroke={border} />
      <rect x="52" y="196" width="10" height="16" rx="2" fill="#cbd5e1" />
      <text x="72" y="208" fill={slateDark} fontSize="10" fontWeight="700">
        Example calendar
      </text>
      <rect x="420" y="198" width="56" height="16" rx="7" fill="#dcfce7" stroke="#86efac" />
      <text x="448" y="209" textAnchor="middle" fill="#166534" fontSize="7" fontWeight="700">
        ACTIVE
      </text>
      <rect x="488" y="198" width="44" height="16" rx="7" fill={white} stroke={border} />
      <text x="510" y="209" textAnchor="middle" fill={slate} fontSize="7" fontWeight="600">
        Edit
      </text>
    </svg>
  );
}

function AppointmentCalendarSvg() {
  return (
    <svg viewBox="0 0 640 240" className="h-auto w-full" aria-hidden>
      <text x="20" y="30" fill={slateDark} fontSize="16" fontWeight="700">
        Calendar
      </text>
      <rect x="20" y="42" width="600" height="36" rx="10" fill={white} stroke={border} />
      <rect x="32" y="52" width="40" height="18" rx="6" fill={brand} />
      <text x="52" y="65" textAnchor="middle" fill="white" fontSize="8" fontWeight="700">
        Day
      </text>
      <rect x="82" y="52" width="120" height="18" rx="6" fill="#f1f5f9" stroke={border} />
      <text x="142" y="65" textAnchor="middle" fill={slateDark} fontSize="8" fontWeight="600">
        Thu 14 May
      </text>
      {['Filter', 'Refresh'].map((l, i) => (
        <g key={l}>
          <rect x={220 + i * 72} y="52" width="64" height="18" rx="6" fill="white" stroke={border} />
          <text x={252 + i * 72} y="65" textAnchor="middle" fill={slateDark} fontSize="8" fontWeight="600">
            {l}
          </text>
        </g>
      ))}
      <rect x="380" y="50" width="88" height="22" rx="8" fill={brand} />
      <text x="424" y="65" textAnchor="middle" fill="white" fontSize="8" fontWeight="700">
        + New Booking
      </text>
      <rect x="478" y="50" width="72" height="22" rx="8" fill="#22c55e" />
      <text x="514" y="65" textAnchor="middle" fill="white" fontSize="8" fontWeight="700">
        Walk-in
      </text>
      {[0, 1].map((col) => (
        <g key={col} transform={`translate(${24 + col * 300}, 92)`}>
          <rect width="276" height="132" rx="12" fill="white" stroke={border} />
          <rect width="276" height="28" rx="12" fill={col === 0 ? brandLight : '#f1f5f9'} />
          <text x="14" y="19" fill={slateDark} fontSize="10" fontWeight="700">
            {col === 0 ? 'Calendar column A' : 'Calendar column B'}
          </text>
          <text x="200" y="19" fill={slate} fontSize="8">
            09:00–17:00
          </text>
          <line x1="12" y1="44" x2="264" y2="44" stroke="#f1f5f9" />
          <line x1="12" y1="68" x2="264" y2="68" stroke="#f1f5f9" />
          <rect x="40" y="78" width="196" height="36" rx="8" fill={brandLight} stroke={brand} strokeOpacity="0.35" />
          <text x="52" y="96" fill={slateDark} fontSize="8" fontWeight="700">
            Guest · Service
          </text>
          <text x="52" y="108" fill={slate} fontSize="7">
            Booked · actions on card
          </text>
        </g>
      ))}
    </svg>
  );
}

function ServicesCatalogSvg() {
  return (
    <svg viewBox="0 0 620 200" className="h-auto w-full" aria-hidden>
      <text x="20" y="26" fill={slate} fontSize="9" fontWeight="600" letterSpacing="0.08em">
        APPOINTMENTS
      </text>
      <text x="20" y="50" fill={slateDark} fontSize="17" fontWeight="700">
        Services
      </text>
      <text x="20" y="68" fill={slate} fontSize="9">
        Define what guests can book…
      </text>
      <rect x="500" y="36" width="100" height="26" rx="8" fill={brand} />
      <text x="550" y="53" textAnchor="middle" fill="white" fontSize="9" fontWeight="700">
        + Add service
      </text>
      <rect x="20" y="88" width="580" height="92" rx="12" fill={white} stroke={border} />
      <circle cx="44" cy="118" r="8" fill="#c4b5fd" stroke={border} />
      <text x="64" y="114" fill={slateDark} fontSize="12" fontWeight="700">
        Example service
      </text>
      <text x="64" y="130" fill={slate} fontSize="9">
        No online payment · duration pill · calendar pills
      </text>
      <rect x="420" y="102" width="48" height="18" rx="7" fill="#f1f5f9" stroke={border} />
      <text x="444" y="114" textAnchor="middle" fill={slateDark} fontSize="8" fontWeight="700">
        30m
      </text>
      <rect x="64" y="142" width="72" height="16" rx="7" fill="#f1f5f9" stroke={border} />
      <text x="100" y="153" textAnchor="middle" fill={slate} fontSize="7" fontWeight="600">
        Calendar 1
      </text>
      <text x="480" y="154" fill={brand} fontSize="8" fontWeight="600">
        Edit
      </text>
      <text x="530" y="154" fill="#dc2626" fontSize="8" fontWeight="600">
        Delete
      </text>
    </svg>
  );
}

function BookingsListSvg() {
  return (
    <svg viewBox="0 0 660 210" className="h-auto w-full" aria-hidden>
      <text x="22" y="32" fill={slateDark} fontSize="16" fontWeight="700">
        Bookings
      </text>
      <rect x="22" y="44" width="616" height="34" rx="10" fill={white} stroke={border} />
      <rect x="34" y="54" width="36" height="16" rx="6" fill="#f1f5f9" stroke={border} />
      <text x="52" y="65" textAnchor="middle" fill={slateDark} fontSize="7" fontWeight="700">
        Day
      </text>
      <rect x="82" y="54" width="100" height="16" rx="6" fill="#f1f5f9" stroke={border} />
      <text x="132" y="65" textAnchor="middle" fill={slateDark} fontSize="7" fontWeight="600">
        Date
      </text>
      {['Filter', 'Search', 'Export'].map((l, i) => (
        <g key={l}>
          <rect x={200 + i * 68} y="54" width="58" height="16" rx="6" fill="white" stroke={border} />
          <text x={229 + i * 68} y="65" textAnchor="middle" fill={slateDark} fontSize="7" fontWeight="600">
            {l}
          </text>
        </g>
      ))}
      <rect x="420" y="52" width="72" height="20" rx="8" fill={brand} />
      <text x="456" y="66" textAnchor="middle" fill="white" fontSize="8" fontWeight="700">
        + New
      </text>
      <rect x="502" y="52" width="72" height="20" rx="8" fill="#22c55e" />
      <text x="538" y="66" textAnchor="middle" fill="white" fontSize="8" fontWeight="700">
        Walk-in
      </text>
      <rect x="22" y="92" width="616" height="96" rx="12" fill={white} stroke={border} />
      <rect x="38" y="108" width="14" height="14" rx="3" fill="white" stroke={border} />
      <rect x="62" y="106" width="4" height="64" rx="2" fill={brand} />
      <text x="78" y="124" fill={slateDark} fontSize="11" fontWeight="700">
        Guest name
      </text>
      <text x="78" y="142" fill={slate} fontSize="8">
        10:30 · Service · Calendar · status pills
      </text>
      <rect x="520" y="118" width="88" height="22" rx="8" fill="#6366f1" />
      <text x="564" y="133" textAnchor="middle" fill="white" fontSize="8" fontWeight="700">
        Confirm ▾
      </text>
    </svg>
  );
}

function CommunicationsSettingsSvg() {
  return (
    <svg viewBox="0 0 620 220" className="h-auto w-full" aria-hidden>
      <text x="20" y="28" fill={slateDark} fontSize="15" fontWeight="700">
        Settings
      </text>
      {['Profile', 'Plan', 'Communications', 'Staff'].map((t, i) => (
        <g key={t}>
          <rect x={20 + i * 96} y="40" width="88" height="26" rx="8" fill={t === 'Communications' ? white : '#f1f5f9'} stroke={border} />
          <text x={64 + i * 96} y="57" textAnchor="middle" fill={t === 'Communications' ? brand : slateDark} fontSize="8" fontWeight="700">
            {t}
          </text>
        </g>
      ))}
      <text x="20" y="92" fill={slate} fontSize="9" fontWeight="600" letterSpacing="0.06em">
        COMMUNICATIONS
      </text>
      <text x="20" y="112" fill={slateDark} fontSize="12" fontWeight="700">
        Guest communications
      </text>
      <rect x="320" y="86" width="132" height="28" rx="10" fill={brand} />
      <text x="386" y="104" textAnchor="middle" fill="white" fontSize="8" fontWeight="700">
        Appointments &amp; other
      </text>
      <rect x="460" y="86" width="120" height="28" rx="10" fill="#f1f5f9" stroke={border} />
      <text x="520" y="104" textAnchor="middle" fill={slateDark} fontSize="8" fontWeight="700">
        Table bookings
      </text>
      <rect x="20" y="124" width="580" height="72" rx="12" fill={white} stroke={border} />
      <text x="36" y="148" fill={slateDark} fontSize="10" fontWeight="700">
        Booking confirmation
      </text>
      <text x="36" y="164" fill={slate} fontSize="8">
        Sent as soon as the booking is confirmed.
      </text>
      <rect x="360" y="138" width="44" height="16" rx="6" fill={brandLight} stroke={border} />
      <text x="382" y="149" textAnchor="middle" fill={brand} fontSize="7" fontWeight="700">
        email
      </text>
      <rect x="412" y="138" width="36" height="16" rx="6" fill="#ecfdf5" stroke="#bbf7d0" />
      <text x="430" y="149" textAnchor="middle" fill="#047857" fontSize="7" fontWeight="700">
        sms
      </text>
      <rect x="460" y="136" width="52" height="20" rx="8" fill={white} stroke={border} />
      <text x="486" y="150" textAnchor="middle" fill={slateDark} fontSize="7" fontWeight="700">
        Preview
      </text>
    </svg>
  );
}

function ReportsInsightsSvg() {
  return (
    <svg viewBox="0 0 620 260" className="h-auto w-full" aria-hidden>
      <text x="20" y="24" fill={slate} fontSize="8" fontWeight="600" letterSpacing="0.08em">
        USAGE
      </text>
      <rect x="20" y="32" width="580" height="44" rx="12" fill={white} stroke={border} />
      <text x="36" y="52" fill={slateDark} fontSize="10" fontWeight="700">
        SMS segments this period
      </text>
      <text x="36" y="66" fill={slate} fontSize="8">
        Progress bar · included vs used
      </text>
      <text x="20" y="100" fill={slate} fontSize="8" fontWeight="600" letterSpacing="0.08em">
        INSIGHTS
      </text>
      <text x="20" y="120" fill={slateDark} fontSize="14" fontWeight="700">
        Reports
      </text>
      <rect x="400" y="96" width="100" height="22" rx="8" fill="#f1f5f9" stroke={border} />
      <text x="450" y="111" textAnchor="middle" fill={slateDark} fontSize="8" fontWeight="700">
        Overview
      </text>
      <rect x="508" y="96" width="92" height="22" rx="8" fill="white" stroke={border} />
      <text x="554" y="111" textAnchor="middle" fill={slate} fontSize="8" fontWeight="600">
        Clients
      </text>
      <rect x="20" y="130" width="580" height="48" rx="12" fill={white} stroke={border} />
      <text x="36" y="152" fill={slate} fontSize="8" fontWeight="600">
        RANGE · Date range
      </text>
      <rect x="36" y="160" width="88" height="18" rx="6" fill="#f8fafc" stroke={border} />
      <text x="80" y="172" textAnchor="middle" fill={slate} fontSize="7">
        From
      </text>
      <rect x="132" y="160" width="88" height="18" rx="6" fill="#f8fafc" stroke={border} />
      <text x="176" y="172" textAnchor="middle" fill={slate} fontSize="7">
        To
      </text>
      <rect x="230" y="158" width="52" height="22" rx="8" fill={brand} />
      <text x="256" y="173" textAnchor="middle" fill="white" fontSize="8" fontWeight="700">
        Apply
      </text>
      <rect x="20" y="190" width="580" height="58" rx="12" fill={white} stroke={border} />
      <text x="36" y="210" fill={slate} fontSize="8" fontWeight="600">
        REPORT · Appointment activity
      </text>
      <text x="480" y="210" fill={brand} fontSize="8" fontWeight="600">
        Export CSV
      </text>
      <rect x="36" y="218" width="120" height="22" rx="6" fill="#f8fafc" stroke={border} />
      <rect x="168" y="218" width="120" height="22" rx="6" fill="#f8fafc" stroke={border} />
      <rect x="300" y="218" width="120" height="22" rx="6" fill="#ecfdf5" stroke="#bbf7d0" />
    </svg>
  );
}

function WidgetEmbedQrSvg() {
  return (
    <svg viewBox="0 0 620 200" className="h-auto w-full" aria-hidden>
      <text x="20" y="26" fill={slate} fontSize="9" fontWeight="600" letterSpacing="0.06em">
        EMBEDS
      </text>
      <text x="20" y="48" fill={slateDark} fontSize="12" fontWeight="700">
        Booking widget &amp; QR code
      </text>
      <rect x="20" y="60" width="280" height="120" rx="12" fill={white} stroke={border} />
      <text x="36" y="84" fill={slateDark} fontSize="10" fontWeight="700">
        Embed code
      </text>
      <rect x="36" y="94" width="100" height="18" rx="6" fill="#f8fafc" stroke={border} />
      <text x="86" y="106" textAnchor="middle" fill={slate} fontSize="7" fontWeight="600">
        Accent #4F46E5
      </text>
      <rect x="36" y="118" width="248" height="44" rx="8" fill="#f1f5f9" stroke={border} />
      <text x="160" y="138" textAnchor="middle" fill={slate} fontSize="7">
        &lt;iframe …&gt; + resize.js
      </text>
      <rect x="36" y="166" width="88" height="20" rx="8" fill={slateDark} />
      <text x="80" y="180" textAnchor="middle" fill="white" fontSize="8" fontWeight="700">
        Copy code
      </text>
      <rect x="320" y="60" width="280" height="120" rx="12" fill={white} stroke={border} />
      <text x="336" y="84" fill={slateDark} fontSize="10" fontWeight="700">
        QR code
      </text>
      <rect x="400" y="96" width="64" height="64" rx="8" fill="#f8fafc" stroke={border} />
      <text x="432" y="132" textAnchor="middle" fill={slate} fontSize="7">
        QR
      </text>
      <text x="460" y="174" textAnchor="middle" fill={slate} fontSize="8">
        Download QR
      </text>
    </svg>
  );
}

function BookingModelsSettingsSvg() {
  return (
    <svg viewBox="0 0 620 200" className="h-auto w-full" aria-hidden>
      <text x="20" y="26" fill={slate} fontSize="9" fontWeight="600" letterSpacing="0.06em">
        MODELS
      </text>
      <text x="20" y="48" fill={slateDark} fontSize="12" fontWeight="700">
        Booking models
      </text>
      <text x="20" y="64" fill={slate} fontSize="8">
        Settings → Profile · choose what appears on your public page
      </text>
      {[
        'Appointments & services',
        'Ticketed events',
        'Classes & sessions',
        'Resources & facilities',
      ].map((row, i) => (
        <g key={row}>
          <rect x="20" y={78 + i * 26} width="580" height="22" rx="8" fill="#f8fafc" stroke={border} />
          <rect x="32" y={84 + i * 26} width="10" height="10" rx="2" fill={brand} />
          <text x="52" y={93 + i * 26} fill={slateDark} fontSize="9" fontWeight="600">
            {row}
          </text>
          <text x="480" y={93 + i * 26} fill={brand} fontSize="8" fontWeight="700">
            Set up →
          </text>
        </g>
      ))}
    </svg>
  );
}

function StaffTeamSvg() {
  return (
    <svg viewBox="0 0 620 220" className="h-auto w-full" aria-hidden>
      <text x="20" y="28" fill={slateDark} fontSize="15" fontWeight="700">
        Settings
      </text>
      {['Profile', 'Communications', 'Staff', 'Data import'].map((t, i) => (
        <g key={t}>
          <rect x={20 + i * 108} y="40" width="100" height="26" rx="8" fill={t === 'Staff' ? white : '#f1f5f9'} stroke={border} />
          <text x={70 + i * 108} y="57" textAnchor="middle" fill={t === 'Staff' ? brand : slateDark} fontSize="8" fontWeight="700">
            {t}
          </text>
        </g>
      ))}
      <text x="20" y="92" fill={slate} fontSize="9" fontWeight="600" letterSpacing="0.06em">
        TEAM
      </text>
      <text x="20" y="112" fill={slateDark} fontSize="12" fontWeight="700">
        Staff members
      </text>
      <rect x="480" y="96" width="100" height="24" rx="8" fill={brand} />
      <text x="530" y="112" textAnchor="middle" fill="white" fontSize="9" fontWeight="700">
        + Add User
      </text>
      <rect x="20" y="124" width="580" height="72" rx="12" fill={white} stroke={border} />
      <text x="36" y="148" fill={slateDark} fontSize="10" fontWeight="700">
        Team member
      </text>
      <rect x="36" y="156" width="44" height="14" rx="6" fill="#ede9fe" stroke="#c4b5fd" />
      <text x="58" y="166" textAnchor="middle" fill="#5b21b6" fontSize="7" fontWeight="700">
        STAFF
      </text>
      <text x="36" y="182" fill={slate} fontSize="8">
        Calendars they manage
      </text>
      <rect x="36" y="188" width="72" height="14" rx="6" fill="#f1f5f9" stroke={border} />
      <text x="72" y="198" textAnchor="middle" fill={slateDark} fontSize="7" fontWeight="600">
        Calendar 1 ✓
      </text>
    </svg>
  );
}

function PublicBookingPageSvg() {
  return (
    <svg viewBox="0 0 620 200" className="h-auto w-full" aria-hidden>
      <rect x="20" y="20" width="580" height="160" rx="16" fill={white} stroke={border} />
      <rect x="20" y="20" width="580" height="48" rx="16" fill="#e2e8f0" />
      <text x="40" y="48" fill={slateDark} fontSize="12" fontWeight="700">
        Your venue · cover area
      </text>
      <text x="40" y="78" fill={slateDark} fontSize="14" fontWeight="700">
        Venue name
      </text>
      {['Appointment', 'Classes', 'Events', 'Resources'].map((t, i) => (
        <g key={t}>
          <rect x={40 + i * 108} y="92" width="100" height="26" rx="10" fill={i === 0 ? slateDark : '#f1f5f9'} />
          <text x={90 + i * 108} y="109" textAnchor="middle" fill={i === 0 ? white : slateDark} fontSize="9" fontWeight="700">
            {t}
          </text>
        </g>
      ))}
      <rect x="40" y="132" width="520" height="36" rx="10" fill="#f8fafc" stroke={border} />
      <text x="60" y="154" fill={slateDark} fontSize="10" fontWeight="600">
        Book an appointment
      </text>
      <text x="520" y="154" fill={slate} fontSize="10">
        ›
      </text>
    </svg>
  );
}

function EmbedVsPageSvg() {
  return (
    <svg viewBox="0 0 620 190" className="h-auto w-full" aria-hidden>
      <rect x="20" y="28" width="260" height="132" rx="16" fill="white" stroke="#94a3b8" strokeWidth="1.5" />
      <rect x="38" y="48" width="224" height="20" rx="8" fill="#f1f5f9" />
      <text x="150" y="62" textAnchor="middle" fill={slateDark} fontSize="9" fontWeight="700">
        /book/your-slug
      </text>
      <rect x="54" y="86" width="80" height="20" rx="8" fill={brand} />
      <text x="94" y="100" textAnchor="middle" fill="white" fontSize="8" fontWeight="700">
        Appointment
      </text>
      <rect x="146" y="86" width="52" height="20" rx="8" fill="#f1f5f9" />
      <text x="172" y="100" textAnchor="middle" fill={slateDark} fontSize="8" fontWeight="700">
        Classes
      </text>
      <text x="150" y="130" textAnchor="middle" fill={slate} fontSize="10">
        Hosted page · QR often points here
      </text>
      <rect x="340" y="28" width="260" height="132" rx="16" fill="#f8fafc" stroke="#cbd5e1" />
      <rect x="360" y="48" width="220" height="72" rx="10" fill="white" stroke="#e2e8f0" />
      <text x="470" y="70" textAnchor="middle" fill={slateDark} fontSize="9" fontWeight="700">
        &lt;iframe src=&quot;/embed/slug&quot;&gt;
      </text>
      <text x="470" y="92" textAnchor="middle" fill={slate} fontSize="9">
        include /embed/resize.js
      </text>
      <text x="470" y="130" textAnchor="middle" fill={slate} fontSize="10">
        Website embed · accent &amp; tab params
      </text>
    </svg>
  );
}

function ImportStepsSvg() {
  const mid = useId().replace(/:/g, '');
  const markerId = `help-import-arr-${mid}`;
  return (
    <svg viewBox="0 0 520 100" className="h-auto w-full" aria-hidden>
      <defs>
        <marker id={markerId} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="#cbd5e1" />
        </marker>
      </defs>
      <text x="8" y="18" fill={slateDark} fontSize="12" fontWeight="600">
        Import flow (concept)
      </text>
      {['Upload', 'Map', 'Validate', 'Review', 'Run'].map((step, i) => (
        <g key={step}>
          <circle cx={48 + i * 92} cy="58" r="22" fill={i <= 2 ? brand : '#e2e8f0'} />
          <text x={48 + i * 92} y="63" textAnchor="middle" fill={i <= 2 ? '#fff' : slate} fontSize="11" fontWeight="700">
            {i + 1}
          </text>
          <text x={48 + i * 92} y="92" textAnchor="middle" fill={slateDark} fontSize="10" fontWeight="600">
            {step}
          </text>
          {i < 4 ? (
            <path
              d={`M ${70 + i * 92} 58 H ${26 + (i + 1) * 92}`}
              stroke="#cbd5e1"
              strokeWidth="2"
              fill="none"
              markerEnd={`url(#${markerId})`}
            />
          ) : null}
        </g>
      ))}
    </svg>
  );
}

function ScheduleModelsSvg() {
  const rows = [
    ['Class type', 'Weekly timetable', 'Instances', 'Roster'],
    ['Event', 'Ticket types', 'Dates', 'Attendees'],
    ['Resource', 'Durations', 'Timeline', 'Public slots'],
  ] as const;
  return (
    <svg viewBox="0 0 620 190" className="h-auto w-full" aria-hidden>
      <rect x="8" y="12" width="604" height="162" rx="18" fill="#f8fafc" stroke="#e2e8f0" />
      {rows.map((row, i) => (
        <g key={row[0]}>
          <rect x="28" y={34 + i * 46} width="564" height="34" rx="12" fill="white" stroke="#e2e8f0" />
          <rect x="44" y={45 + i * 46} width="70" height="14" rx="7" fill={i === 0 ? brandLight : i === 1 ? '#fef3c7' : '#ecfdf5'} />
          <text x="79" y={55 + i * 46} textAnchor="middle" fill={slateDark} fontSize="8" fontWeight="700">
            {row[0]}
          </text>
          {row.slice(1).map((label, j) => (
            <g key={label}>
              <rect x={148 + j * 126} y={44 + i * 46} width="96" height="16" rx="7" fill="#f8fafc" stroke="#e2e8f0" />
              <text x={196 + j * 126} y={55 + i * 46} textAnchor="middle" fill={slate} fontSize="8" fontWeight="700">
                {label}
              </text>
            </g>
          ))}
        </g>
      ))}
      <text x="310" y="160" textAnchor="middle" fill={slate} fontSize="9">
        Concept: each model ties back to a calendar column
      </text>
    </svg>
  );
}

function PaymentsFlowSvg() {
  return (
    <svg viewBox="0 0 620 180" className="h-auto w-full" aria-hidden>
      <rect x="8" y="12" width="604" height="150" rx="18" fill="#f8fafc" stroke="#e2e8f0" />
      {[
        ['Stripe Connect', 'Settings → Payments'],
        ['Catalogue rule', 'Deposit or full payment'],
        ['Guest checkout', 'Stripe-hosted card fields'],
        ['Confirmation', 'Email / SMS receipt'],
      ].map(([title, sub], i) => (
        <g key={title}>
          <rect x={28 + i * 146} y="50" width="120" height="58" rx="14" fill="white" stroke="#e2e8f0" />
          <circle cx={48 + i * 146} cy="70" r="10" fill={i === 0 ? brand : brandLight} />
          <text x={48 + i * 146} y="74" textAnchor="middle" fill={i === 0 ? '#fff' : brand} fontSize="8" fontWeight="700">
            {i + 1}
          </text>
          <text x={88 + i * 146} y="70" textAnchor="middle" fill={slateDark} fontSize="9" fontWeight="700">
            {title}
          </text>
          <text x={88 + i * 146} y="88" textAnchor="middle" fill={slate} fontSize="8">
            {sub}
          </text>
          {i < 3 ? <path d={`M ${150 + i * 146} 79 H ${170 + i * 146}`} stroke="#cbd5e1" strokeWidth="2" /> : null}
        </g>
      ))}
      <text x="310" y="140" textAnchor="middle" fill={slate} fontSize="9">
        Payments flow (concept): no card data is stored in ResNeo
      </text>
    </svg>
  );
}

const FIGURE_COPY: Record<string, { title: string; caption?: string; node: ReactNode }> = {
  'tier-compare': {
    title: 'Plan limits at a glance',
    caption: 'Exact caps are in Settings → Plan. Upgrade there if you outgrow your tier.',
    node: <TierComparisonSvg />,
  },
  'sidebar-appointments': {
    title: 'Dashboard sidebar (appointments)',
    caption:
      'Links reflect your venue: list label may be Appointments or Bookings; model links (Services, Classes, …) appear after Contacts when enabled.',
    node: <SidebarNavSvg />,
  },
  'calendar-columns': {
    title: 'Appointment Calendar layout',
    caption: 'Each bookable calendar is a column. Use the toolbar for date, view, filters, new booking, and walk-ins.',
    node: <AppointmentCalendarSvg />,
  },
  'availability-tabs': {
    title: 'Calendar Availability',
    caption: 'Four tabs: Calendars first, then weekly Availability, Breaks, and Closures per calendar.',
    node: <CalendarAvailabilitySvg />,
  },
  'service-row': {
    title: 'Services catalogue',
    caption: 'Cards show duration, payment rule, linked calendars, and edit/delete actions.',
    node: <ServicesCatalogSvg />,
  },
  'list-toolbar': {
    title: 'Bookings list',
    caption: 'Filter and search at the top; export, confirm, and walk-in actions stay within reach.',
    node: <BookingsListSvg />,
  },
  'comms-lanes': {
    title: 'Communications (Settings)',
    caption: 'Choose the message lane when your venue has both appointments-style and table templates.',
    node: <CommunicationsSettingsSvg />,
  },
  'embed-vs-book': {
    title: 'Hosted page vs embed (concept)',
    caption: 'Same venue, two entry points: full /book page or iframe /embed for your website.',
    node: <EmbedVsPageSvg />,
  },
  'import-flow': {
    title: 'Import flow (concept)',
    caption: 'After a successful import you have 24 hours to undo from the import hub.',
    node: <ImportStepsSvg />,
  },
  'public-tabs': {
    title: 'Public booking page',
    caption: 'Guests switch tabs when you enable multiple models; deep links use ?tab=…',
    node: <PublicBookingPageSvg />,
  },
  'booking-models': {
    title: 'Booking models (Settings → Profile)',
    caption: 'Turn models on or off; only active ones appear in the sidebar and on your public page.',
    node: <BookingModelsSettingsSvg />,
  },
  'schedule-models': {
    title: 'How classes, events, and resources connect (concept)',
    caption: 'Each line is a simplified map of where to work in the dashboard for that model.',
    node: <ScheduleModelsSvg />,
  },
  'team-access': {
    title: 'Staff & calendar access',
    caption: 'Invite people under Settings → Staff and tick which calendars they manage.',
    node: <StaffTeamSvg />,
  },
  'payments-flow': {
    title: 'Payments flow (concept)',
    caption: 'Connect Stripe first, then set payment rules on each service, class, event, or resource.',
    node: <PaymentsFlowSvg />,
  },
  'reports-dashboard': {
    title: 'Reports (admin)',
    caption: 'SMS usage, date range, then charts and CSV exports for the selected period.',
    node: <ReportsInsightsSvg />,
  },
  'widget-settings': {
    title: 'Widget, embed & QR',
    caption: 'Profile holds the iframe snippet, optional accent colour, and QR download.',
    node: <WidgetEmbedQrSvg />,
  },
};

export function AppointmentsHelpFigure({ id }: { id: string }) {
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
