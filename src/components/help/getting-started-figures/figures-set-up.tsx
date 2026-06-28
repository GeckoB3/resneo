'use client';

import type { ReactNode } from 'react';

/* Auto-assembled figures for the gs-set-up section of the Getting started hub. */

function ProfileFormSvg() {
  return (
    <svg
      viewBox="0 0 560 560"
      className="mx-auto h-auto w-full max-w-[560px]"
      role="img"
      aria-label="The Settings Profile tab: a horizontal tab bar with Profile active above a Business profile card containing Name, an Address group, Phone and Email side by side, Business website and Timezone fields, with a green Venue profile saved banner and a note that edits save automatically."
    >
      {/* tab bar */}
      <rect x="10" y="10" width="540" height="38" rx="10" fill="#f1f5f9" />
      {['Profile', 'Business hours', 'Booking Settings', 'Booking Page'].map((t, i) => {
        const w = 130;
        const tx = 16 + i * 132;
        const active = t === 'Profile';
        return (
          <g key={t}>
            <rect x={tx} y="15" width={w} height="28" rx="8" fill={active ? '#ffffff' : 'transparent'} stroke={active ? '#e2e8f0' : 'transparent'} />
            <text x={tx + w / 2} y="33" textAnchor="middle" fill={active ? '#00305C' : '#64748b'} fontSize="10" fontWeight={active ? '700' : '500'}>
              {t}
            </text>
          </g>
        );
      })}

      {/* saved banner */}
      <rect x="10" y="64" width="200" height="26" rx="9" fill="#dcfce7" stroke="#86efac" />
      <circle cx="28" cy="77" r="6" fill="#059669" />
      <path d="M25 77 l2.4 2.4 l4-4.6" fill="none" stroke="#ffffff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <text x="42" y="81" fill="#059669" fontSize="11" fontWeight="600">Venue profile saved</text>

      {/* Business profile card */}
      <rect x="10" y="104" width="540" height="396" rx="14" fill="#ffffff" stroke="#e2e8f0" />
      <text x="30" y="130" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">VENUE</text>
      <text x="30" y="152" fill="#0f172a" fontSize="16" fontWeight="700">Business profile</text>

      {/* Name */}
      <text x="30" y="178" fill="#64748b" fontSize="9" fontWeight="600">Name</text>
      <rect x="30" y="184" width="500" height="28" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="44" y="202" fill="#0f172a" fontSize="11" fontWeight="500">Riverside Wellness</text>

      {/* Address group */}
      <text x="30" y="234" fill="#64748b" fontSize="9" fontWeight="600">Address</text>
      <rect x="30" y="240" width="500" height="28" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="44" y="258" fill="#94a3b8" fontSize="11">Building / venue name</text>
      <rect x="30" y="272" width="500" height="28" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="44" y="290" fill="#94a3b8" fontSize="11">Street</text>
      <rect x="30" y="304" width="246" height="28" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="44" y="322" fill="#94a3b8" fontSize="11">Town / city</text>
      <rect x="284" y="304" width="246" height="28" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="298" y="322" fill="#94a3b8" fontSize="11">Postcode</text>

      {/* Phone + Email */}
      <text x="30" y="356" fill="#64748b" fontSize="9" fontWeight="600">Phone</text>
      <rect x="30" y="362" width="246" height="28" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="44" y="380" fill="#0f172a" fontSize="11">01234 567890</text>
      <text x="284" y="356" fill="#64748b" fontSize="9" fontWeight="600">Email</text>
      <rect x="284" y="362" width="246" height="28" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="298" y="380" fill="#0f172a" fontSize="11">hello@riverside.co</text>

      {/* Business website */}
      <text x="30" y="412" fill="#64748b" fontSize="9" fontWeight="600">Business website</text>
      <rect x="30" y="418" width="500" height="28" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="44" y="436" fill="#0f172a" fontSize="11">riverside-wellness.co</text>

      {/* Timezone (plain text input) */}
      <text x="30" y="468" fill="#64748b" fontSize="9" fontWeight="600">Timezone</text>
      <rect x="30" y="474" width="500" height="28" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="44" y="492" fill="#0f172a" fontSize="11" fontWeight="500">Europe/London</text>

      {/* helper note */}
      <text x="30" y="528" fill="#64748b" fontSize="10">Edits save automatically after you pause typing.</text>
    </svg>
  );
}

function ProfileSlugSvg() {
  return (
    <svg
      viewBox="0 0 680 300"
      className="h-auto w-full"
      role="img"
      aria-label="A slug input box with a grey /book/ prefix and an editable your-slug area, a green tick reading this address is available, an arrow pointing to the resulting public URL, and an amber warning that changing it breaks links already shared."
    >
      {/* Left: input card */}
      <text x="28" y="40" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">YOUR ADDRESS</text>

      {/* input box */}
      <rect x="28" y="52" width="288" height="44" rx="12" fill="#ffffff" stroke="#e2e8f0" strokeWidth="1.5" />
      {/* grey prefix segment */}
      <path d="M28 64 a12 12 0 0 1 12 -12 h78 v44 h-78 a12 12 0 0 1 -12 -12 Z" fill="#f1f5f9" />
      <line x1="118" y1="52" x2="118" y2="96" stroke="#e2e8f0" strokeWidth="1.5" />
      <text x="72" y="80" textAnchor="middle" fill="#64748b" fontSize="14" fontWeight="600">/book/</text>
      {/* editable area */}
      <text x="132" y="80" fill="#0f172a" fontSize="14" fontWeight="700">your-slug</text>
      {/* caret */}
      <rect x="206" y="64" width="2" height="20" fill="#00A0A4" />

      {/* available tick label */}
      <g>
        <circle cx="40" cy="124" r="9" fill="#059669" />
        <path d="M35.5 124 l3 3 l5.5 -6" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <text x="56" y="128" fill="#059669" fontSize="12" fontWeight="700">This address is available</text>
      </g>

      {/* Arrow */}
      <defs>
        <marker id="slugArrow" markerWidth="9" markerHeight="9" refX="6" refY="4.5" orient="auto">
          <path d="M0 0 L9 4.5 L0 9 Z" fill="#003B6F" />
        </marker>
      </defs>
      <line x1="332" y1="74" x2="392" y2="74" stroke="#003B6F" strokeWidth="2.5" markerEnd="url(#slugArrow)" />

      {/* Right: resulting URL card */}
      <text x="412" y="40" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">PUBLIC LINK</text>
      <rect x="412" y="52" width="240" height="44" rx="12" fill="#E8EFF6" stroke="#003B6F" strokeWidth="1.5" />
      {/* link glyph */}
      <g stroke="#003B6F" strokeWidth="2" fill="none" strokeLinecap="round">
        <path d="M430 70 a7 7 0 0 1 10 0 l3 3 a7 7 0 0 1 0 10" />
        <path d="M446 86 a7 7 0 0 1 -10 0 l-3 -3 a7 7 0 0 1 0 -10" />
      </g>
      <text x="462" y="80" fill="#00305C" fontSize="13" fontWeight="700">/book/your-slug</text>

      {/* Warning callout */}
      <rect x="28" y="166" width="624" height="56" rx="12" fill="#fef3c7" stroke="#d97706" strokeWidth="1.5" />
      {/* warning triangle */}
      <g transform="translate(58 194)">
        <path d="M0 -13 L13 11 L-13 11 Z" fill="#d97706" />
        <rect x="-1.4" y="-6" width="2.8" height="9" rx="1.4" fill="#ffffff" />
        <circle cx="0" cy="7" r="1.6" fill="#ffffff" />
      </g>
      <text x="88" y="190" fill="#0f172a" fontSize="12" fontWeight="700">Heads up</text>
      <text x="88" y="208" fill="#92400e" fontSize="12" fontWeight="600">Changing this breaks links you have already shared.</text>
    </svg>
  );
}

function ProfileModelsSvg() {
  const rows = [
    {
      title: 'Appointments & services',
      desc: 'Bookings against calendars, people or rooms',
      on: true,
    },
    {
      title: 'Ticketed events',
      desc: 'Sell tickets for dated events',
      on: true,
    },
    {
      title: 'Classes & sessions',
      desc: 'Recurring or one-off classes with rosters',
      on: false,
    },
    {
      title: 'Resources & facilities',
      desc: 'Bookable rooms, courts or equipment',
      on: false,
    },
  ];
  const rowH = 64;
  const rowGap = 12;
  const top = 84;
  return (
    <svg
      viewBox="0 0 560 430"
      className="mx-auto h-auto w-full max-w-[560px]"
      role="img"
      aria-label="Booking models card listing four selectable models, with Appointments and services and Ticketed events ticked, each ticked row showing a Set up link, and a note that at least one model must stay active."
    >
      {/* Card */}
      <rect x="8" y="8" width="544" height="414" rx="14" fill="#ffffff" stroke="#e2e8f0" />

      {/* Header */}
      <text x="28" y="38" fill="#64748b" fontSize="11" fontWeight="700" letterSpacing="1">MODELS</text>
      <text x="28" y="62" fill="#0f172a" fontSize="17" fontWeight="700">Booking models</text>
      <line x1="28" y1="74" x2="532" y2="74" stroke="#e2e8f0" strokeWidth="1" />

      {rows.map((r, i) => {
        const y = top + i * (rowH + rowGap);
        const cy = y + rowH / 2;
        return (
          <g key={r.title}>
            {/* Row container */}
            <rect
              x="28"
              y={y}
              width="504"
              height={rowH}
              rx="11"
              fill={r.on ? '#f8fafc' : '#ffffff'}
              stroke={r.on ? '#C2F4F5' : '#e2e8f0'}
            />

            {/* Checkbox */}
            <rect
              x="44"
              y={cy - 11}
              width="22"
              height="22"
              rx="6"
              fill={r.on ? '#00A0A4' : '#ffffff'}
              stroke={r.on ? '#00A0A4' : '#64748b'}
              strokeWidth="1.5"
            />
            {r.on ? (
              <path
                d={`M ${49} ${cy} L ${53} ${cy + 4} L ${61} ${cy - 5}`}
                fill="none"
                stroke="#ffffff"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}

            {/* Title + description */}
            <text x="84" y={cy - 4} fill="#0f172a" fontSize="13" fontWeight="700">{r.title}</text>
            <text x="84" y={cy + 14} fill="#64748b" fontSize="11">{r.desc}</text>

            {/* Set up link on ticked rows */}
            {r.on ? (
              <g>
                <text x="470" y={cy + 4} fill="#00305C" fontSize="11" fontWeight="700">Set up</text>
                <path
                  d={`M ${508} ${cy} l 6 -4 l 0 8 z`}
                  fill="#00305C"
                />
                <line x1="503" y1={cy} x2="510" y2={cy} stroke="#00305C" strokeWidth="1.6" strokeLinecap="round" />
              </g>
            ) : null}
          </g>
        );
      })}

      {/* Note: at least one model must stay active */}
      <circle cx="36" cy="402" r="3" fill="#d97706" />
      <text x="46" y="406" fill="#92400e" fontSize="11" fontWeight="600">Keep at least one model active.</text>
    </svg>
  );
}

function StripePlanVsPaySvg() {
  return (
    <svg
      viewBox="0 0 720 300"
      className="h-auto w-full"
      role="img"
      aria-label="Two separate Settings tabs side by side. Settings, Plan is your ResNeo subscription where your business pays money to ResNeo for the software. Settings, Payments is Stripe Connect for guest cards where guest card money flows to your own bank account. The two systems do not feed each other."
    >
      {/* Left card: Settings, Plan */}
      <rect x="14" y="14" width="316" height="272" rx="14" fill="#ffffff" stroke="#e2e8f0" />
      <rect x="14" y="14" width="316" height="6" rx="3" fill="#00305C" />
      <text x="34" y="46" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">SETTINGS TAB</text>
      <text x="34" y="68" fill="#0f172a" fontSize="15" fontWeight="700">Settings &#8594; Plan</text>
      <text x="34" y="88" fill="#64748b" fontSize="11">Your ResNeo subscription (the software)</text>

      {/* Your business box */}
      <rect x="34" y="116" width="100" height="56" rx="10" fill="#f8fafc" stroke="#e2e8f0" />
      <text x="84" y="142" textAnchor="middle" fill="#0f172a" fontSize="11" fontWeight="700">Your</text>
      <text x="84" y="158" textAnchor="middle" fill="#0f172a" fontSize="11" fontWeight="700">business</text>

      {/* Arrow business to ResNeo */}
      <line x1="138" y1="144" x2="200" y2="144" stroke="#64748b" strokeWidth="2" />
      <path d="M200 144 l-9 -5 l0 10 z" fill="#64748b" />

      {/* ResNeo box */}
      <rect x="206" y="116" width="100" height="56" rx="10" fill="#E8EFF6" stroke="#00305C" />
      <text x="256" y="148" textAnchor="middle" fill="#00305C" fontSize="13" fontWeight="700">ResNeo</text>

      {/* money label */}
      <rect x="120" y="184" width="124" height="22" rx="11" fill="#E8EFF6" />
      <text x="182" y="199" textAnchor="middle" fill="#00305C" fontSize="10" fontWeight="600">money to ResNeo</text>

      {/* footer note */}
      <text x="34" y="240" fill="#64748b" fontSize="10">A monthly fee you pay to use</text>
      <text x="34" y="256" fill="#64748b" fontSize="10">the ResNeo booking platform.</text>

      {/* Divider: vs */}
      <line x1="360" y1="40" x2="360" y2="260" stroke="#e2e8f0" strokeWidth="2" strokeDasharray="5 6" />
      <circle cx="360" cy="150" r="20" fill="#f1f5f9" stroke="#e2e8f0" />
      <text x="360" y="155" textAnchor="middle" fill="#64748b" fontSize="13" fontWeight="700">vs</text>

      {/* Right card: Settings, Payments */}
      <rect x="390" y="14" width="316" height="272" rx="14" fill="#ffffff" stroke="#e2e8f0" />
      <rect x="390" y="14" width="316" height="6" rx="3" fill="#00A0A4" />
      <text x="410" y="46" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">SETTINGS TAB</text>
      <text x="410" y="68" fill="#0f172a" fontSize="15" fontWeight="700">Settings &#8594; Payments</text>
      <text x="410" y="88" fill="#64748b" fontSize="11">Stripe Connect for guest cards</text>

      {/* Guest card box */}
      <rect x="410" y="116" width="100" height="56" rx="10" fill="#f8fafc" stroke="#e2e8f0" />
      <rect x="422" y="130" width="76" height="28" rx="4" fill="#C2F4F5" stroke="#00A0A4" />
      <rect x="422" y="137" width="76" height="6" fill="#00A0A4" />
      <text x="460" y="170" textAnchor="middle" fill="#0f172a" fontSize="10" fontWeight="700">Guest card</text>

      {/* Arrow guest to your bank */}
      <line x1="514" y1="144" x2="576" y2="144" stroke="#00A0A4" strokeWidth="2" />
      <path d="M576 144 l-9 -5 l0 10 z" fill="#00A0A4" />

      {/* Your bank box */}
      <rect x="582" y="116" width="104" height="56" rx="10" fill="#C2F4F5" stroke="#00A0A4" />
      <text x="634" y="142" textAnchor="middle" fill="#00305C" fontSize="11" fontWeight="700">Your bank</text>
      <text x="634" y="158" textAnchor="middle" fill="#00305C" fontSize="11" fontWeight="700">account</text>

      {/* money label */}
      <rect x="494" y="184" width="124" height="22" rx="11" fill="#C2F4F5" />
      <text x="556" y="199" textAnchor="middle" fill="#00305C" fontSize="10" fontWeight="600">guest money to you</text>

      {/* footer note */}
      <text x="410" y="240" fill="#64748b" fontSize="10">Guests&apos; payments land in your</text>
      <text x="410" y="256" fill="#64748b" fontSize="10">own connected Stripe account.</text>
    </svg>
  );
}

function StripeStepsSvg() {
  return (
    <svg
      viewBox="0 0 600 320"
      className="mx-auto h-auto w-full max-w-[600px]"
      role="img"
      aria-label="A two-step Stripe setup stepper: Step 1 Business and bank details with a green check, Step 2 Identity verification with a green check, and a final green status pill reading Stripe connected, charges enabled."
    >
      {/* Card */}
      <rect x="10" y="10" width="580" height="300" rx="14" fill="#ffffff" stroke="#e2e8f0" />
      <text x="30" y="40" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">PAYMENTS SETUP</text>
      <text x="30" y="62" fill="#0f172a" fontSize="16" fontWeight="700">Connect your Stripe account</text>

      {/* Connecting line (completed, green) */}
      <line x1="54" y1="120" x2="54" y2="196" stroke="#059669" strokeWidth="3" />

      {/* Step 1 circle */}
      <circle cx="54" cy="108" r="16" fill="#059669" />
      <path d="M47 108 l5 5 l9 -10" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <text x="86" y="104" fill="#0f172a" fontSize="13" fontWeight="700">Step 1: Business &amp; bank details</text>
      <text x="86" y="122" fill="#64748b" fontSize="11">Provide your business information and</text>
      <text x="86" y="137" fill="#64748b" fontSize="11">bank account details.</text>
      <rect x="490" y="96" width="84" height="22" rx="11" fill="#d1fae5" />
      <text x="532" y="111" textAnchor="middle" fill="#059669" fontSize="10" fontWeight="700">Complete</text>

      {/* Step 2 circle */}
      <circle cx="54" cy="208" r="16" fill="#059669" />
      <path d="M47 208 l5 5 l9 -10" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <text x="86" y="204" fill="#0f172a" fontSize="13" fontWeight="700">Step 2: Identity verification</text>
      <text x="86" y="222" fill="#64748b" fontSize="11">Verify the identity of the account</text>
      <text x="86" y="237" fill="#64748b" fontSize="11">representative.</text>
      <rect x="490" y="196" width="84" height="22" rx="11" fill="#d1fae5" />
      <text x="532" y="211" textAnchor="middle" fill="#059669" fontSize="10" fontWeight="700">Complete</text>

      {/* Final status pill */}
      <rect x="30" y="264" width="540" height="34" rx="10" fill="#d1fae5" stroke="#059669" />
      <circle cx="52" cy="281" r="9" fill="#059669" />
      <path d="M47 281 l4 4 l6 -7" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <text x="70" y="285" fill="#059669" fontSize="12" fontWeight="700">Stripe connected; charges enabled</text>
    </svg>
  );
}

function PublicSurfacesSvg() {
  return (
    <svg
      viewBox="0 0 700 360"
      className="h-auto w-full"
      role="img"
      aria-label="Three browser windows side by side showing the three public booking surfaces: a hosted booking page at slash book slash your-slug, an embedded booking widget inside your own website at slash embed slash your-slug, and a single practitioner page at slash book slash your-slug slash practitioner-slug. All share the same teal booking branding."
    >
      {/* Panel 1: Hosted booking page */}
      <text x="18" y="22" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.07em">HOSTED PAGE</text>
      <rect x="18" y="30" width="208" height="306" rx="13" fill="#ffffff" stroke="#e2e8f0" />
      <rect x="18" y="30" width="208" height="34" rx="13" fill="#f1f5f9" />
      <rect x="18" y="52" width="208" height="12" fill="#f1f5f9" />
      <circle cx="34" cy="47" r="3.5" fill="#dc2626" />
      <circle cx="46" cy="47" r="3.5" fill="#d97706" />
      <circle cx="58" cy="47" r="3.5" fill="#059669" />
      <rect x="72" y="40" width="138" height="16" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="82" y="51" fill="#64748b" fontSize="9">/book/{'{your-slug}'}</text>
      <rect x="30" y="76" width="184" height="50" rx="9" fill="#E8EFF6" />
      <path d="M30 110 L70 90 L104 112 L140 84 L184 110 L214 100 L214 117 a9 9 0 0 1 -9 9 H39 a9 9 0 0 1 -9 -9 Z" fill="#C2F4F5" />
      <circle cx="178" cy="92" r="8" fill="#00A0A4" opacity="0.65" />
      <circle cx="44" cy="146" r="11" fill="#00305C" />
      <text x="44" y="150" textAnchor="middle" fill="#ffffff" fontSize="9" fontWeight="700">RN</text>
      <text x="62" y="143" fill="#0f172a" fontSize="11" fontWeight="700">Your Studio</text>
      <text x="62" y="155" fill="#64748b" fontSize="8.5">Book an appointment</text>
      <text x="30" y="180" fill="#64748b" fontSize="8.5" fontWeight="700" letterSpacing="0.05em">PICK A TIME</text>
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        const sx = 30 + col * 62;
        const sy = 188 + row * 30;
        const sel = i === 4;
        const times = ['9:00', '9:30', '10:00', '10:30', '11:00', '11:30'];
        return (
          <g key={i}>
            <rect x={sx} y={sy} width="54" height="22" rx="7" fill={sel ? '#00A0A4' : '#ffffff'} stroke={sel ? '#00A0A4' : '#e2e8f0'} />
            <text x={sx + 27} y={sy + 14} textAnchor="middle" fill={sel ? '#ffffff' : '#0f172a'} fontSize="9" fontWeight={sel ? '700' : '500'}>{times[i]}</text>
          </g>
        );
      })}
      <rect x="30" y="290" width="184" height="28" rx="9" fill="#00305C" />
      <text x="122" y="308" textAnchor="middle" fill="#ffffff" fontSize="10" fontWeight="600">Continue</text>

      {/* Panel 2: Embed in your website */}
      <text x="246" y="22" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.07em">EMBED IN YOUR SITE</text>
      <rect x="246" y="30" width="208" height="306" rx="13" fill="#ffffff" stroke="#e2e8f0" />
      <rect x="246" y="30" width="208" height="34" rx="13" fill="#f1f5f9" />
      <rect x="246" y="52" width="208" height="12" fill="#f1f5f9" />
      <circle cx="262" cy="47" r="3.5" fill="#dc2626" />
      <circle cx="274" cy="47" r="3.5" fill="#d97706" />
      <circle cx="286" cy="47" r="3.5" fill="#059669" />
      <rect x="300" y="40" width="138" height="16" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="310" y="51" fill="#64748b" fontSize="9">www.yoursite.com</text>
      <text x="258" y="84" fill="#0f172a" fontSize="11" fontWeight="700">YourBrand</text>
      <rect x="338" y="76" width="24" height="9" rx="3" fill="#f1f5f9" />
      <rect x="366" y="76" width="24" height="9" rx="3" fill="#f1f5f9" />
      <rect x="394" y="76" width="24" height="9" rx="3" fill="#f1f5f9" />
      <rect x="422" y="76" width="20" height="9" rx="3" fill="#f1f5f9" />
      <line x1="258" y1="94" x2="442" y2="94" stroke="#e2e8f0" strokeWidth="1" />
      <rect x="258" y="104" width="120" height="7" rx="3.5" fill="#f1f5f9" />
      <rect x="258" y="116" width="184" height="6" rx="3" fill="#f8fafc" />
      <rect x="258" y="126" width="160" height="6" rx="3" fill="#f8fafc" />
      <rect x="258" y="146" width="184" height="142" rx="10" fill="#f8fafc" stroke="#00A0A4" strokeWidth="1.4" strokeDasharray="5 4" />
      <rect x="258" y="146" width="86" height="16" rx="8" fill="#C2F4F5" />
      <text x="266" y="158" fill="#00305C" fontSize="8.5" fontWeight="700">/embed/{'{your-slug}'}</text>
      <text x="270" y="184" fill="#0f172a" fontSize="9.5" fontWeight="700">Book with us</text>
      {[0, 1, 2, 3].map((i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const sx = 270 + col * 82;
        const sy = 194 + row * 30;
        const sel = i === 1;
        const times = ['9:00', '9:30', '10:00', '10:30'];
        return (
          <g key={i}>
            <rect x={sx} y={sy} width="74" height="22" rx="7" fill={sel ? '#00A0A4' : '#ffffff'} stroke={sel ? '#00A0A4' : '#e2e8f0'} />
            <text x={sx + 37} y={sy + 14} textAnchor="middle" fill={sel ? '#ffffff' : '#0f172a'} fontSize="9" fontWeight={sel ? '700' : '500'}>{times[i]}</text>
          </g>
        );
      })}
      <rect x="270" y="258" width="160" height="22" rx="8" fill="#00305C" />
      <text x="350" y="273" textAnchor="middle" fill="#ffffff" fontSize="9.5" fontWeight="600">Continue</text>
      <rect x="258" y="300" width="150" height="6" rx="3" fill="#f8fafc" />
      <rect x="258" y="312" width="120" height="6" rx="3" fill="#f8fafc" />

      {/* Panel 3: Single practitioner link */}
      <text x="474" y="22" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.07em">ONE PRACTITIONER</text>
      <rect x="474" y="30" width="208" height="306" rx="13" fill="#ffffff" stroke="#e2e8f0" />
      <rect x="474" y="30" width="208" height="34" rx="13" fill="#f1f5f9" />
      <rect x="474" y="52" width="208" height="12" fill="#f1f5f9" />
      <circle cx="490" cy="47" r="3.5" fill="#dc2626" />
      <circle cx="502" cy="47" r="3.5" fill="#d97706" />
      <circle cx="514" cy="47" r="3.5" fill="#059669" />
      <rect x="528" y="40" width="146" height="16" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="536" y="51" fill="#64748b" fontSize="8">/book/{'{slug}'}/{'{practitioner}'}</text>
      <rect x="486" y="76" width="184" height="46" rx="10" fill="#E8EFF6" stroke="#bcd2e6" />
      <circle cx="510" cy="99" r="13" fill="#00A0A4" />
      <text x="510" y="103" textAnchor="middle" fill="#ffffff" fontSize="10" fontWeight="700">SC</text>
      <text x="532" y="94" fill="#0f172a" fontSize="11" fontWeight="700">Sarah Chen</text>
      <text x="532" y="107" fill="#64748b" fontSize="8.5">Physiotherapist</text>
      <rect x="486" y="132" width="120" height="18" rx="9" fill="#C2F4F5" />
      <text x="546" y="145" textAnchor="middle" fill="#00305C" fontSize="9" fontWeight="700">Locked to one person</text>
      <text x="486" y="172" fill="#64748b" fontSize="8.5" fontWeight="700" letterSpacing="0.05em">SARAH&apos;S TIMES</text>
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        const sx = 486 + col * 62;
        const sy = 180 + row * 30;
        const sel = i === 2;
        const times = ['9:00', '9:30', '10:00', '11:00', '11:30', '12:00'];
        return (
          <g key={i}>
            <rect x={sx} y={sy} width="54" height="22" rx="7" fill={sel ? '#00A0A4' : '#ffffff'} stroke={sel ? '#00A0A4' : '#e2e8f0'} />
            <text x={sx + 27} y={sy + 14} textAnchor="middle" fill={sel ? '#ffffff' : '#0f172a'} fontSize="9" fontWeight={sel ? '700' : '500'}>{times[i]}</text>
          </g>
        );
      })}
      <rect x="486" y="290" width="184" height="28" rx="9" fill="#00305C" />
      <text x="578" y="308" textAnchor="middle" fill="#ffffff" fontSize="10" fontWeight="600">Book with Sarah</text>
    </svg>
  );
}

function PublicEmbedSvg() {
  return (
    <svg
      viewBox="0 0 560 560"
      className="mx-auto h-auto w-full max-w-[560px]"
      role="img"
      aria-label="Booking Page settings screen with an Embed code card showing an accent colour picker, a monospace code box with iframe and script lines and a Copy code button, and a QR code card with a downloadable QR image."
    >
      {/* Top card: Embed code */}
      <rect x="16" y="16" width="528" height="282" rx="14" fill="#ffffff" stroke="#e2e8f0" strokeWidth="1.5" />
      <text x="40" y="46" fill="#64748b" fontSize="10" fontWeight="700" letterSpacing="1.2">EMBED CODE</text>
      <text x="40" y="68" fill="#0f172a" fontSize="15" fontWeight="700">Add the booking widget to your site</text>

      {/* Accent colour row */}
      <text x="40" y="100" fill="#64748b" fontSize="10" fontWeight="700" letterSpacing="0.6">ACCENT COLOUR (OPTIONAL)</text>
      <rect x="40" y="110" width="34" height="34" rx="8" fill="#4F46E5" stroke="#e2e8f0" strokeWidth="1.5" />
      <rect x="82" y="110" width="150" height="34" rx="8" fill="#f8fafc" stroke="#e2e8f0" strokeWidth="1.5" />
      <text x="98" y="132" fill="#0f172a" fontSize="13" fontFamily="monospace">#4F46E5</text>
      <text x="250" y="132" fill="#64748b" fontSize="12" fontWeight="600">Reset</text>

      {/* Code box */}
      <rect x="40" y="160" width="480" height="72" rx="10" fill="#f1f5f9" stroke="#e2e8f0" strokeWidth="1.5" />
      <text x="56" y="190" fill="#0f172a" fontSize="11.5" fontFamily="monospace">&lt;iframe src=&quot;.../embed/your-slug&quot;&gt;&lt;/iframe&gt;</text>
      <text x="56" y="214" fill="#0f172a" fontSize="11.5" fontFamily="monospace">&lt;script src=&quot;.../embed/resize.js&quot;&gt;&lt;/script&gt;</text>

      {/* Copy code button */}
      <rect x="40" y="248" width="124" height="34" rx="9" fill="#00305C" />
      <text x="102" y="270" textAnchor="middle" fill="#ffffff" fontSize="12.5" fontWeight="700">Copy code</text>

      {/* Bottom card: QR code */}
      <rect x="16" y="314" width="528" height="230" rx="14" fill="#ffffff" stroke="#e2e8f0" strokeWidth="1.5" />
      <text x="40" y="344" fill="#64748b" fontSize="10" fontWeight="700" letterSpacing="1.2">QR CODE</text>
      <text x="40" y="366" fill="#0f172a" fontSize="15" fontWeight="700">Print or share a scannable code</text>

      {/* QR image group */}
      <g transform="translate(40,384)">
        <rect x="0" y="0" width="120" height="120" rx="8" fill="#ffffff" stroke="#e2e8f0" strokeWidth="1.5" />
        <rect x="12" y="12" width="28" height="28" fill="#0f172a" />
        <rect x="18" y="18" width="16" height="16" fill="#ffffff" />
        <rect x="22" y="22" width="8" height="8" fill="#0f172a" />
        <rect x="80" y="12" width="28" height="28" fill="#0f172a" />
        <rect x="86" y="18" width="16" height="16" fill="#ffffff" />
        <rect x="90" y="22" width="8" height="8" fill="#0f172a" />
        <rect x="12" y="80" width="28" height="28" fill="#0f172a" />
        <rect x="18" y="86" width="16" height="16" fill="#ffffff" />
        <rect x="22" y="90" width="8" height="8" fill="#0f172a" />
        <rect x="52" y="12" width="8" height="8" fill="#0f172a" />
        <rect x="68" y="12" width="8" height="8" fill="#0f172a" />
        <rect x="52" y="28" width="8" height="8" fill="#0f172a" />
        <rect x="60" y="44" width="8" height="8" fill="#0f172a" />
        <rect x="44" y="52" width="8" height="8" fill="#0f172a" />
        <rect x="60" y="52" width="8" height="8" fill="#0f172a" />
        <rect x="76" y="52" width="8" height="8" fill="#0f172a" />
        <rect x="92" y="52" width="8" height="8" fill="#0f172a" />
        <rect x="12" y="52" width="8" height="8" fill="#0f172a" />
        <rect x="28" y="52" width="8" height="8" fill="#0f172a" />
        <rect x="52" y="68" width="8" height="8" fill="#0f172a" />
        <rect x="68" y="68" width="8" height="8" fill="#0f172a" />
        <rect x="84" y="68" width="8" height="8" fill="#0f172a" />
        <rect x="52" y="84" width="8" height="8" fill="#0f172a" />
        <rect x="68" y="84" width="8" height="8" fill="#0f172a" />
        <rect x="92" y="84" width="8" height="8" fill="#0f172a" />
        <rect x="60" y="100" width="8" height="8" fill="#0f172a" />
        <rect x="76" y="100" width="8" height="8" fill="#0f172a" />
        <rect x="92" y="100" width="8" height="8" fill="#0f172a" />
        <text x="60" y="138" textAnchor="middle" fill="#64748b" fontSize="11" fontWeight="600">Resneo Wellness</text>
      </g>

      {/* Download QR button */}
      <rect x="200" y="406" width="172" height="36" rx="9" fill="#00305C" />
      <text x="286" y="429" textAnchor="middle" fill="#ffffff" fontSize="12.5" fontWeight="700">Download QR code</text>
      <text x="200" y="468" fill="#64748b" fontSize="11.5">Great for flyers, windows</text>
      <text x="200" y="486" fill="#64748b" fontSize="11.5">and reception desks.</text>
    </svg>
  );
}

function StaffListSvg() {
  return (
    <svg
      viewBox="0 0 560 540"
      className="mx-auto h-auto w-full max-w-[560px]"
      role="img"
      aria-label="The Settings Staff screen: a Staff members card listing an Admin and a Staff team member with avatars, emails, role badges, the calendars they manage, and per-row icon buttons, plus an Add User button, above a Security settings card with an Auto-Logout Timer dropdown and a Save button."
    >
      {/* Card 1: Staff members */}
      <rect x="10" y="10" width="540" height="384" rx="14" fill="#ffffff" stroke="#e2e8f0" />
      <text x="30" y="36" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">TEAM</text>
      <text x="30" y="58" fill="#0f172a" fontSize="16" fontWeight="700">Staff members</text>

      {/* Add User button */}
      <rect x="410" y="34" width="120" height="30" rx="9" fill="#00305C" />
      <line x1="430" y1="49" x2="442" y2="49" stroke="#ffffff" strokeWidth="2" />
      <line x1="436" y1="43" x2="436" y2="55" stroke="#ffffff" strokeWidth="2" />
      <text x="490" y="53" textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="600">Add User</text>

      {/* Row 1: Admin */}
      <rect x="30" y="78" width="500" height="70" rx="12" fill="#f8fafc" stroke="#e2e8f0" />
      <circle cx="62" cy="113" r="18" fill="#E8EFF6" stroke="#00305C" />
      <text x="62" y="118" textAnchor="middle" fill="#00305C" fontSize="14" fontWeight="700">S</text>
      <text x="92" y="106" fill="#0f172a" fontSize="12" fontWeight="700">Sarah Bennett</text>
      <text x="92" y="124" fill="#64748b" fontSize="10">sarah@venue.com</text>
      {/* Admin badge */}
      <rect x="92" y="132" width="56" height="18" rx="9" fill="#ede9fe" />
      <text x="120" y="145" textAnchor="middle" fill="#6d28d9" fontSize="9" fontWeight="700">Admin</text>
      {/* icon buttons */}
      <g>
        {/* shield */}
        <rect x="360" y="100" width="28" height="26" rx="7" fill="#ffffff" stroke="#e2e8f0" />
        <path d="M374 105 l8 3 v6 a8 8 0 0 1 -8 7 a8 8 0 0 1 -8 -7 v-6 z" fill="#E8EFF6" stroke="#00305C" strokeWidth="1" />
        {/* key */}
        <rect x="394" y="100" width="28" height="26" rx="7" fill="#ffffff" stroke="#e2e8f0" />
        <circle cx="404" cy="111" r="4" fill="none" stroke="#64748b" strokeWidth="1.5" />
        <line x1="407" y1="113" x2="414" y2="118" stroke="#64748b" strokeWidth="1.5" />
        {/* envelope */}
        <rect x="428" y="100" width="28" height="26" rx="7" fill="#ffffff" stroke="#e2e8f0" />
        <rect x="435" y="106" width="14" height="11" rx="2" fill="none" stroke="#64748b" strokeWidth="1.3" />
        <path d="M435 107 l7 5 l7 -5" fill="none" stroke="#64748b" strokeWidth="1.3" />
        {/* trash */}
        <rect x="462" y="100" width="28" height="26" rx="7" fill="#ffffff" stroke="#fecaca" />
        <rect x="470" y="109" width="12" height="9" rx="1.5" fill="none" stroke="#dc2626" strokeWidth="1.3" />
        <line x1="468" y1="107" x2="484" y2="107" stroke="#dc2626" strokeWidth="1.3" />
        <line x1="474" y1="104" x2="478" y2="104" stroke="#dc2626" strokeWidth="1.3" />
      </g>

      {/* Row 2: Staff */}
      <rect x="30" y="158" width="500" height="130" rx="12" fill="#f8fafc" stroke="#e2e8f0" />
      <circle cx="62" cy="193" r="18" fill="#C2F4F5" stroke="#00A0A4" />
      <text x="62" y="198" textAnchor="middle" fill="#00305C" fontSize="14" fontWeight="700">J</text>
      <text x="92" y="186" fill="#0f172a" fontSize="12" fontWeight="700">James Cole</text>
      <text x="92" y="204" fill="#64748b" fontSize="10">james@venue.com</text>
      {/* Staff badge */}
      <rect x="92" y="212" width="50" height="18" rx="9" fill="#f1f5f9" />
      <text x="117" y="225" textAnchor="middle" fill="#64748b" fontSize="9" fontWeight="700">Staff</text>
      {/* icon buttons */}
      <g>
        <rect x="360" y="180" width="28" height="26" rx="7" fill="#ffffff" stroke="#e2e8f0" />
        <path d="M374 185 l8 3 v6 a8 8 0 0 1 -8 7 a8 8 0 0 1 -8 -7 v-6 z" fill="#E8EFF6" stroke="#00305C" strokeWidth="1" />
        <rect x="394" y="180" width="28" height="26" rx="7" fill="#ffffff" stroke="#e2e8f0" />
        <circle cx="404" cy="191" r="4" fill="none" stroke="#64748b" strokeWidth="1.5" />
        <line x1="407" y1="193" x2="414" y2="198" stroke="#64748b" strokeWidth="1.5" />
        <rect x="428" y="180" width="28" height="26" rx="7" fill="#ffffff" stroke="#e2e8f0" />
        <rect x="435" y="186" width="14" height="11" rx="2" fill="none" stroke="#64748b" strokeWidth="1.3" />
        <path d="M435 187 l7 5 l7 -5" fill="none" stroke="#64748b" strokeWidth="1.3" />
        <rect x="462" y="180" width="28" height="26" rx="7" fill="#ffffff" stroke="#fecaca" />
        <rect x="470" y="189" width="12" height="9" rx="1.5" fill="none" stroke="#dc2626" strokeWidth="1.3" />
        <line x1="468" y1="187" x2="484" y2="187" stroke="#dc2626" strokeWidth="1.3" />
        <line x1="474" y1="184" x2="478" y2="184" stroke="#dc2626" strokeWidth="1.3" />
      </g>
      {/* Calendars they manage box */}
      <rect x="92" y="238" width="300" height="42" rx="9" fill="#ffffff" stroke="#e2e8f0" />
      <text x="104" y="252" fill="#64748b" fontSize="8" fontWeight="700" letterSpacing="0.06em">CALENDARS THEY MANAGE</text>
      <rect x="104" y="258" width="13" height="13" rx="3" fill="#00A0A4" />
      <path d="M107 264 l2.5 2.5 l4 -4.5" fill="none" stroke="#ffffff" strokeWidth="1.6" />
      <text x="123" y="269" fill="#0f172a" fontSize="10">Sarah</text>
      <rect x="190" y="258" width="13" height="13" rx="3" fill="#00A0A4" />
      <path d="M193 264 l2.5 2.5 l4 -4.5" fill="none" stroke="#ffffff" strokeWidth="1.6" />
      <text x="209" y="269" fill="#0f172a" fontSize="10">Treatment Room</text>

      {/* hint line */}
      <text x="30" y="316" fill="#64748b" fontSize="10">Admins manage all settings. Staff see only the calendars assigned to them.</text>
      <line x1="30" y1="332" x2="530" y2="332" stroke="#e2e8f0" strokeWidth="1" />
      <text x="30" y="356" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.06em">PER-ROW ACTIONS</text>
      <text x="30" y="378" fill="#0f172a" fontSize="10">Shield: role. Key: reset password. Envelope: resend invite. Trash: remove.</text>

      {/* Card 2: Security settings */}
      <rect x="10" y="410" width="540" height="120" rx="14" fill="#ffffff" stroke="#e2e8f0" />
      <text x="30" y="436" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">SECURITY</text>
      <text x="30" y="458" fill="#0f172a" fontSize="16" fontWeight="700">Security settings</text>
      <text x="30" y="488" fill="#0f172a" fontSize="11" fontWeight="500">Auto-Logout Timer</text>
      {/* dropdown */}
      <rect x="30" y="498" width="150" height="30" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="44" y="517" fill="#0f172a" fontSize="11" fontWeight="500">8 hours</text>
      <text x="166" y="517" fill="#64748b" fontSize="11">v</text>
      {/* Save button */}
      <rect x="450" y="498" width="80" height="30" rx="9" fill="#003B6F" />
      <text x="490" y="517" textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="600">Save</text>
    </svg>
  );
}

function StaffRolesSvg() {
  return (
    <svg
      viewBox="0 0 620 372"
      className="h-auto w-full"
      role="img"
      aria-label="A two-column comparison of role capabilities. The Admin column can change all venue settings, manage staff and roles, set the auto-logout timer, view reports, and see all calendars and bookings. The Staff column can change only their own account and password and work the day-to-day schedule, but cannot change venue settings or manage staff."
    >
      {/* Left card: Admin */}
      <rect x="14" y="14" width="288" height="344" rx="14" fill="#ffffff" stroke="#e2e8f0" />
      <rect x="14" y="14" width="288" height="6" rx="3" fill="#7c3aed" />
      <text x="34" y="46" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">ROLE</text>
      <rect x="34" y="56" width="74" height="22" rx="11" fill="#ede9fe" />
      <text x="71" y="71" textAnchor="middle" fill="#6d28d9" fontSize="11" fontWeight="700">Admin</text>
      <text x="118" y="71" fill="#64748b" fontSize="10">Full control</text>

      {/* Admin capabilities */}
      {[
        'Change all venue settings',
        'Manage staff and roles',
        'Set the auto-logout timer',
        'View reports',
        'See all calendars and bookings',
      ].map((label, i) => {
        const y = 104 + i * 44;
        return (
          <g key={i}>
            <rect x="30" y={y} width="256" height="34" rx="9" fill="#f8fafc" stroke="#e2e8f0" />
            <circle cx="50" cy={y + 17} r="9" fill="#d1fae5" />
            <path
              d={`M45 ${y + 17} l3.4 3.4 l6.2 -7`}
              fill="none"
              stroke="#059669"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <text x="68" y={y + 21} fill="#0f172a" fontSize="11" fontWeight="500">{label}</text>
          </g>
        );
      })}

      {/* Right card: Staff */}
      <rect x="318" y="14" width="288" height="344" rx="14" fill="#ffffff" stroke="#e2e8f0" />
      <rect x="318" y="14" width="288" height="6" rx="3" fill="#94a3b8" />
      <text x="338" y="46" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">ROLE</text>
      <rect x="338" y="56" width="70" height="22" rx="11" fill="#f1f5f9" />
      <text x="373" y="71" textAnchor="middle" fill="#475569" fontSize="11" fontWeight="700">Staff</text>
      <text x="416" y="71" fill="#64748b" fontSize="10">Day-to-day</text>

      {/* Staff capabilities */}
      {/* 1: own account (allowed) */}
      <g>
        <rect x="334" y="104" width="256" height="34" rx="9" fill="#f8fafc" stroke="#e2e8f0" />
        <circle cx="354" cy="121" r="9" fill="#d1fae5" />
        <path d="M349 121 l3.4 3.4 l6.2 -7" fill="none" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <text x="372" y="125" fill="#0f172a" fontSize="11" fontWeight="500">Own account and password</text>
      </g>
      {/* 2: schedule and bookings (allowed) */}
      <g>
        <rect x="334" y="148" width="256" height="34" rx="9" fill="#f8fafc" stroke="#e2e8f0" />
        <circle cx="354" cy="165" r="9" fill="#d1fae5" />
        <path d="M349 165 l3.4 3.4 l6.2 -7" fill="none" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <text x="372" y="169" fill="#0f172a" fontSize="11" fontWeight="500">Daily schedule and bookings</text>
      </g>
      {/* 3: assigned calendars (allowed) */}
      <g>
        <rect x="334" y="192" width="256" height="34" rx="9" fill="#f8fafc" stroke="#e2e8f0" />
        <circle cx="354" cy="209" r="9" fill="#d1fae5" />
        <path d="M349 209 l3.4 3.4 l6.2 -7" fill="none" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <text x="372" y="213" fill="#0f172a" fontSize="11" fontWeight="500">Only assigned calendars</text>
      </g>
      {/* 4: venue settings (blocked, lock icon) */}
      <g>
        <rect x="334" y="236" width="256" height="34" rx="9" fill="#fef2f2" stroke="#fecaca" />
        <circle cx="354" cy="253" r="9" fill="#fee2e2" />
        <rect x="350" y="252" width="8" height="6" rx="1.4" fill="none" stroke="#dc2626" strokeWidth="1.6" />
        <path d="M351.4 252 v-1.6 a2.6 2.6 0 0 1 5.2 0 v1.6" fill="none" stroke="#dc2626" strokeWidth="1.6" />
        <text x="372" y="251" fill="#0f172a" fontSize="11" fontWeight="500">Venue settings</text>
        <text x="372" y="264" fill="#dc2626" fontSize="9" fontWeight="600">Cannot change</text>
      </g>
      {/* 5: staff and roles (blocked) */}
      <g>
        <rect x="334" y="280" width="256" height="34" rx="9" fill="#fef2f2" stroke="#fecaca" />
        <circle cx="354" cy="297" r="9" fill="#fee2e2" />
        <path d="M350 293 l8 8 M358 293 l-8 8" fill="none" stroke="#dc2626" strokeWidth="1.8" strokeLinecap="round" />
        <text x="372" y="295" fill="#0f172a" fontSize="11" fontWeight="500">Staff, roles and reports</text>
        <text x="372" y="308" fill="#dc2626" fontSize="9" fontWeight="600">Admin only</text>
      </g>

      {/* Footer legend */}
      <circle cx="50" cy="340" r="7" fill="#d1fae5" />
      <path d="M46 340 l2.8 2.8 l5 -5.6" fill="none" stroke="#059669" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <text x="64" y="344" fill="#64748b" fontSize="10">Can do</text>
      <circle cx="148" cy="340" r="7" fill="#fee2e2" />
      <path d="M145 337 l6 6 M151 337 l-6 6" fill="none" stroke="#dc2626" strokeWidth="1.6" strokeLinecap="round" />
      <text x="162" y="344" fill="#64748b" fontSize="10">Cannot</text>
    </svg>
  );
}

export const SET_UP_FIGURES: Record<string, { title: string; caption: string; node: ReactNode }> = {
  "profile-form": { title: "Settings, Profile tab", caption: "The Business profile card on the Profile tab, where venue details save automatically.", node: <ProfileFormSvg /> },
  "profile-slug": { title: "Booking page address", caption: "Your chosen slug becomes the friendly end of your public booking link.", node: <ProfileSlugSvg /> },
  "profile-models": { title: "Booking models", caption: "Tick the booking models you want active, keeping at least one switched on.", node: <ProfileModelsSvg /> },
  "stripe-plan-vs-pay": { title: "Settings, Plan vs Settings, Payments", caption: "Two separate Settings tabs: Plan is what you pay ResNeo, Payments is guest card money flowing to your own account.", node: <StripePlanVsPaySvg /> },
  "stripe-steps": { title: "Stripe setup: two steps to ready", caption: "A two-step stepper moving from business and bank details, through identity verification, to a connected state.", node: <StripeStepsSvg /> },
  "public-surfaces": { title: "Three ways guests can book", caption: "The hosted page, an embed inside your website, and a direct practitioner link all share the same booking flow.", node: <PublicSurfacesSvg /> },
  "public-embed": { title: "Booking Page tab: Embed code and QR code", caption: "The Embed code card holds the snippet and accent picker; the QR code card has a downloadable code.", node: <PublicEmbedSvg /> },
  "staff-list": { title: "Settings, Staff tab", caption: "The Staff members list with each person's role and assigned calendars, plus the Add User button, above a Security settings card with the Auto-Logout Timer.", node: <StaffListSvg /> },
  "staff-roles": { title: "Admin vs Staff", caption: "What an Admin can do compared with a Staff member, side by side.", node: <StaffRolesSvg /> },
};
