'use client';

import type { ReactNode } from 'react';

/* Auto-assembled figures for the gs-catalogue section of the Getting started hub. */

function ServicesEditorSvg() {
  return (
    <svg
      viewBox="0 0 560 720"
      className="mx-auto h-auto w-full max-w-[560px]"
      role="img"
      aria-label="The Add Service dialog: a modal with Name (required), Description, Duration and Buffer in minutes, Price in pounds, an Online payment when booking section with three radio options, a Calendars that offer this service checklist, a Colour swatch row, an Active toggle, and Cancel and Create Service buttons."
    >
      {/* Modal card */}
      <rect x="10" y="10" width="540" height="700" rx="14" fill="#ffffff" stroke="#e2e8f0" />

      {/* Modal header */}
      <rect x="10" y="10" width="540" height="48" rx="14" fill="#f8fafc" />
      <rect x="10" y="44" width="540" height="14" fill="#f8fafc" />
      <text x="30" y="40" fill="#0f172a" fontSize="16" fontWeight="700">Add Service</text>
      <text x="524" y="40" textAnchor="end" fill="#64748b" fontSize="16" fontWeight="600">×</text>
      <line x1="10" y1="58" x2="550" y2="58" stroke="#e2e8f0" strokeWidth="1" />

      {/* Name (required) */}
      <text x="30" y="84" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">NAME <tspan fill="#dc2626">*</tspan></text>
      <rect x="30" y="92" width="500" height="32" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="44" y="112" fill="#0f172a" fontSize="11" fontWeight="500">60 min massage</text>

      {/* Description */}
      <text x="30" y="146" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">DESCRIPTION</text>
      <rect x="30" y="154" width="500" height="52" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="44" y="174" fill="#64748b" fontSize="11">Shown to clients when they choose</text>
      <text x="44" y="190" fill="#64748b" fontSize="11">this service at booking.</text>

      {/* Duration + Buffer row */}
      <text x="30" y="228" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">DURATION (MINS)</text>
      <rect x="30" y="236" width="244" height="32" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="44" y="256" fill="#0f172a" fontSize="11" fontWeight="500">60</text>

      <text x="286" y="228" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">BUFFER (MINS)</text>
      <rect x="286" y="236" width="244" height="32" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="300" y="256" fill="#0f172a" fontSize="11" fontWeight="500">10</text>

      {/* Price */}
      <text x="30" y="290" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">PRICE (£)</text>
      <rect x="30" y="298" width="244" height="32" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <rect x="30" y="298" width="32" height="32" rx="8" fill="#f1f5f9" />
      <line x1="62" y1="298" x2="62" y2="330" stroke="#e2e8f0" strokeWidth="1" />
      <text x="46" y="318" textAnchor="middle" fill="#64748b" fontSize="12" fontWeight="700">£</text>
      <text x="76" y="318" fill="#0f172a" fontSize="11" fontWeight="500">65.00</text>

      {/* Online payment section */}
      <rect x="30" y="350" width="500" height="120" rx="12" fill="#f8fafc" stroke="#e2e8f0" />
      <text x="46" y="374" fill="#0f172a" fontSize="12" fontWeight="700">Online payment when booking</text>

      {/* radio 1 */}
      <circle cx="56" cy="396" r="6" fill="#ffffff" stroke="#cbd5e1" strokeWidth="1.5" />
      <text x="72" y="400" fill="#0f172a" fontSize="11" fontWeight="500">No online payment</text>
      {/* radio 2 selected */}
      <circle cx="56" cy="422" r="6" fill="#ffffff" stroke="#00305C" strokeWidth="1.5" />
      <circle cx="56" cy="422" r="3" fill="#00305C" />
      <text x="72" y="426" fill="#0f172a" fontSize="11" fontWeight="600">Custom deposit</text>
      {/* radio 3 */}
      <circle cx="56" cy="448" r="6" fill="#ffffff" stroke="#cbd5e1" strokeWidth="1.5" />
      <text x="72" y="452" fill="#0f172a" fontSize="11" fontWeight="500">Pay full price online at booking</text>

      {/* Calendars section */}
      <text x="30" y="500" fill="#0f172a" fontSize="12" fontWeight="700">Calendars that offer this service</text>

      {/* checkbox 1 checked */}
      <rect x="30" y="512" width="16" height="16" rx="4" fill="#00305C" />
      <path d="M34 520 l3 3 l5 -6" fill="none" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <text x="56" y="525" fill="#0f172a" fontSize="11" fontWeight="500">Sarah</text>

      {/* checkbox 2 checked */}
      <rect x="30" y="536" width="16" height="16" rx="4" fill="#00305C" />
      <path d="M34 544 l3 3 l5 -6" fill="none" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <text x="56" y="549" fill="#0f172a" fontSize="11" fontWeight="500">James</text>

      {/* checkbox 3 unchecked */}
      <rect x="30" y="560" width="16" height="16" rx="4" fill="#ffffff" stroke="#cbd5e1" strokeWidth="1.5" />
      <text x="56" y="573" fill="#64748b" fontSize="11" fontWeight="500">Room 2</text>

      {/* Add calendar button */}
      <rect x="430" y="510" width="100" height="26" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="480" y="527" textAnchor="middle" fill="#00305C" fontSize="10" fontWeight="600">+ Add calendar</text>

      {/* Colour swatches */}
      <text x="30" y="606" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">COLOUR</text>
      <circle cx="120" cy="602" r="9" fill="#00A0A4" stroke="#0f172a" strokeWidth="2" />
      <circle cx="148" cy="602" r="9" fill="#00305C" />
      <circle cx="176" cy="602" r="9" fill="#059669" />
      <circle cx="204" cy="602" r="9" fill="#d97706" />
      <circle cx="232" cy="602" r="9" fill="#dc2626" />
      <circle cx="260" cy="602" r="9" fill="#64748b" />

      {/* Active toggle */}
      <rect x="30" y="640" width="40" height="20" rx="10" fill="#00A0A4" />
      <circle cx="60" cy="650" r="7" fill="#ffffff" />
      <text x="82" y="654" fill="#0f172a" fontSize="11" fontWeight="600">Active <tspan fill="#64748b" fontWeight="400">(visible to clients)</tspan></text>

      {/* Footer */}
      <line x1="10" y1="676" x2="550" y2="676" stroke="#e2e8f0" strokeWidth="1" />
      <rect x="350" y="684" width="80" height="30" rx="9" fill="#ffffff" stroke="#e2e8f0" />
      <text x="390" y="703" textAnchor="middle" fill="#64748b" fontSize="11" fontWeight="600">Cancel</text>
      <rect x="438" y="684" width="92" height="30" rx="9" fill="#00305C" />
      <text x="484" y="703" textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="600">Create Service</text>
    </svg>
  );
}

function ServicesFlowSvg() {
  return (
    <svg
      viewBox="0 0 700 300"
      className="h-auto w-full"
      role="img"
      aria-label="A left-to-right flow of three steps: create a service with a name, duration and price; assign it to a calendar that offers the service; and it then appears on your public booking page, but only when the service is Active and the calendar has working hours."
    >
      {/* Box 1 - Create service */}
      <rect x="14" y="40" width="196" height="172" rx="13" fill="#ffffff" stroke="#00305C" strokeWidth="1.5" />
      <text x="32" y="64" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">STEP 1</text>
      <text x="32" y="84" fill="#0f172a" fontSize="13" fontWeight="700">Create a service</text>
      {/* form icon */}
      <rect x="32" y="100" width="160" height="96" rx="9" fill="#f8fafc" stroke="#e2e8f0" />
      <text x="44" y="121" fill="#64748b" fontSize="8" fontWeight="600">NAME</text>
      <rect x="44" y="126" width="136" height="14" rx="4" fill="#E8EFF6" />
      <text x="51" y="136" fill="#00305C" fontSize="9" fontWeight="600">Deep tissue massage</text>
      <text x="44" y="158" fill="#64748b" fontSize="8" fontWeight="600">DURATION</text>
      <rect x="44" y="163" width="64" height="14" rx="4" fill="#C2F4F5" />
      <text x="51" y="173" fill="#00305C" fontSize="9" fontWeight="600">60 min</text>
      <text x="120" y="158" fill="#64748b" fontSize="8" fontWeight="600">PRICE</text>
      <rect x="120" y="163" width="60" height="14" rx="4" fill="#C2F4F5" />
      <text x="127" y="173" fill="#00305C" fontSize="9" fontWeight="600">&#163;75</text>

      {/* Arrow 1 to 2 */}
      <line x1="216" y1="126" x2="246" y2="126" stroke="#00305C" strokeWidth="2" />
      <path d="M244 121 l8 5 l-8 5 z" fill="#00305C" />

      {/* Box 2 - Assign to calendar */}
      <rect x="252" y="40" width="196" height="172" rx="13" fill="#ffffff" stroke="#00305C" strokeWidth="1.5" />
      <text x="270" y="64" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">STEP 2</text>
      <text x="270" y="84" fill="#0f172a" fontSize="13" fontWeight="700">Assign to a calendar</text>
      {/* calendar column icon */}
      <rect x="270" y="100" width="90" height="96" rx="9" fill="#f8fafc" stroke="#e2e8f0" />
      <rect x="270" y="100" width="90" height="20" rx="9" fill="#00305C" />
      <text x="315" y="114" textAnchor="middle" fill="#ffffff" fontSize="9" fontWeight="600">Sarah</text>
      <rect x="280" y="130" width="70" height="14" rx="4" fill="#C2F4F5" />
      <rect x="280" y="150" width="70" height="14" rx="4" fill="#E8EFF6" />
      <rect x="280" y="170" width="70" height="14" rx="4" fill="#E8EFF6" />
      {/* tick badge */}
      <circle cx="352" cy="106" r="9" fill="#059669" />
      <path d="M348 106 l3 3 l5 -6" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <text x="372" y="124" fill="#64748b" fontSize="9" fontWeight="600">Calendars that</text>
      <text x="372" y="138" fill="#64748b" fontSize="9" fontWeight="600">offer this</text>
      <text x="372" y="152" fill="#64748b" fontSize="9" fontWeight="600">service</text>
      <rect x="372" y="166" width="62" height="22" rx="11" fill="#C2F4F5" />
      <text x="403" y="181" textAnchor="middle" fill="#00305C" fontSize="9" fontWeight="700">Sarah</text>

      {/* Arrow 2 to 3 */}
      <line x1="454" y1="126" x2="484" y2="126" stroke="#00305C" strokeWidth="2" />
      <path d="M482 121 l8 5 l-8 5 z" fill="#00305C" />

      {/* Box 3 - Public booking page */}
      <rect x="490" y="40" width="196" height="172" rx="13" fill="#ffffff" stroke="#00305C" strokeWidth="1.5" />
      <text x="508" y="64" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">STEP 3</text>
      <text x="508" y="84" fill="#0f172a" fontSize="13" fontWeight="700">Public booking page</text>
      {/* phone / browser window */}
      <rect x="540" y="98" width="96" height="100" rx="11" fill="#f8fafc" stroke="#00305C" strokeWidth="1.2" />
      <rect x="540" y="98" width="96" height="22" rx="11" fill="#00305C" />
      <text x="588" y="113" textAnchor="middle" fill="#ffffff" fontSize="8" fontWeight="600">/book/your-slug</text>
      <rect x="550" y="130" width="76" height="16" rx="5" fill="#E8EFF6" />
      <text x="557" y="142" fill="#00305C" fontSize="8" fontWeight="600">Deep tissue 60 min</text>
      {/* bookable slot */}
      <rect x="550" y="152" width="76" height="20" rx="6" fill="#00A0A4" />
      <text x="588" y="166" textAnchor="middle" fill="#ffffff" fontSize="9" fontWeight="700">Book 10:00</text>
      <rect x="550" y="176" width="36" height="14" rx="5" fill="#ffffff" stroke="#e2e8f0" />
      <text x="568" y="186" textAnchor="middle" fill="#64748b" fontSize="8">11:00</text>
      <rect x="590" y="176" width="36" height="14" rx="5" fill="#ffffff" stroke="#e2e8f0" />
      <text x="608" y="186" textAnchor="middle" fill="#64748b" fontSize="8">12:00</text>

      {/* Note under box 3 */}
      <rect x="14" y="234" width="672" height="50" rx="12" fill="#fef3c7" stroke="#fde68a" />
      <circle cx="38" cy="259" r="9" fill="#d97706" />
      <text x="38" y="263" textAnchor="middle" fill="#ffffff" fontSize="12" fontWeight="700">!</text>
      <text x="58" y="255" fill="#0f172a" fontSize="11" fontWeight="700">Only shows when both are true</text>
      <text x="58" y="273" fill="#0f172a" fontSize="10">The service is <tspan fontWeight="700">Active</tspan> and the assigned calendar has <tspan fontWeight="700">working hours</tspan> set.</text>
    </svg>
  );
}

function ClassesTypeSvg() {
  return (
    <svg viewBox="0 0 560 384" className="mx-auto h-auto w-full max-w-[560px]" role="img" aria-label="The New class type form with fields for Name, Duration in minutes, Capacity in spots, Calendar, Price and an optional Instructor label, and a Save class type button.">
      <rect x="10" y="10" width="540" height="364" rx="14" fill="#ffffff" stroke="#e2e8f0" />
      <text x="32" y="40" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">CLASSES</text>
      <text x="32" y="60" fill="#0f172a" fontSize="15" fontWeight="700">New class type</text>
      <text x="32" y="78" fill="#64748b" fontSize="10">The template your guests will book.</text>
      <text x="32" y="104" fill="#64748b" fontSize="10" fontWeight="600">Name</text>
      <rect x="32" y="110" width="496" height="28" rx="8" fill="#f8fafc" stroke="#e2e8f0" />
      <text x="44" y="128" fill="#0f172a" fontSize="11">Beginner Yoga</text>
      <text x="32" y="160" fill="#64748b" fontSize="10" fontWeight="600">Duration (minutes)</text>
      <rect x="32" y="166" width="240" height="28" rx="8" fill="#f8fafc" stroke="#e2e8f0" />
      <text x="44" y="184" fill="#0f172a" fontSize="11">60</text>
      <text x="288" y="160" fill="#64748b" fontSize="10" fontWeight="600">Capacity (spots)</text>
      <rect x="288" y="166" width="240" height="28" rx="8" fill="#f8fafc" stroke="#e2e8f0" />
      <text x="300" y="184" fill="#0f172a" fontSize="11">12</text>
      <text x="32" y="216" fill="#64748b" fontSize="10" fontWeight="600">Calendar</text>
      <rect x="32" y="222" width="240" height="28" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="44" y="240" fill="#0f172a" fontSize="11">Studio A</text>
      <text x="258" y="240" fill="#64748b" fontSize="11">&#9662;</text>
      <text x="288" y="216" fill="#64748b" fontSize="10" fontWeight="600">Price</text>
      <rect x="288" y="222" width="240" height="28" rx="8" fill="#f8fafc" stroke="#e2e8f0" />
      <text x="300" y="240" fill="#0f172a" fontSize="11">£12.00</text>
      <text x="32" y="272" fill="#64748b" fontSize="10" fontWeight="600">Instructor label (optional)</text>
      <rect x="32" y="278" width="496" height="28" rx="8" fill="#f8fafc" stroke="#e2e8f0" />
      <text x="44" y="296" fill="#0f172a" fontSize="11">Sam</text>
      <rect x="388" y="324" width="140" height="32" rx="9" fill="#003B6F" />
      <text x="458" y="344" textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="600">Save class type</text>
    </svg>
  );
}

function ClassesScheduleSvg() {
  return (
    <svg viewBox="0 0 560 312" className="mx-auto h-auto w-full max-w-[560px]" role="img" aria-label="The Schedule classes panel with a repeat selector of One date, Weekly and Custom dates, plus class type, start date, start time and repeat until fields, and an Add sessions button.">
      <rect x="10" y="10" width="540" height="292" rx="14" fill="#ffffff" stroke="#e2e8f0" />
      <text x="32" y="44" fill="#0f172a" fontSize="15" fontWeight="700">Schedule classes</text>
      <text x="32" y="62" fill="#64748b" fontSize="10">Put a class type onto real dates.</text>
      <rect x="32" y="78" width="496" height="36" rx="10" fill="#f1f5f9" />
      <rect x="37" y="83" width="162" height="26" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="118" y="100" textAnchor="middle" fill="#64748b" fontSize="11">One date</text>
      <rect x="199" y="83" width="162" height="26" rx="8" fill="#00305C" />
      <text x="280" y="100" textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="700">Weekly</text>
      <rect x="361" y="83" width="162" height="26" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="442" y="100" textAnchor="middle" fill="#64748b" fontSize="11">Custom dates</text>
      <text x="32" y="140" fill="#64748b" fontSize="10" fontWeight="600">Class type</text>
      <rect x="32" y="146" width="240" height="28" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="44" y="164" fill="#0f172a" fontSize="11">Beginner Yoga</text>
      <text x="258" y="164" fill="#64748b" fontSize="11">&#9662;</text>
      <text x="288" y="140" fill="#64748b" fontSize="10" fontWeight="600">Starts</text>
      <rect x="288" y="146" width="240" height="28" rx="8" fill="#f8fafc" stroke="#e2e8f0" />
      <text x="300" y="164" fill="#0f172a" fontSize="11">Mon 6 Jul</text>
      <text x="32" y="194" fill="#64748b" fontSize="10" fontWeight="600">Start time</text>
      <rect x="32" y="200" width="150" height="28" rx="8" fill="#f8fafc" stroke="#e2e8f0" />
      <text x="44" y="218" fill="#0f172a" fontSize="11">18:00</text>
      <text x="200" y="194" fill="#64748b" fontSize="10" fontWeight="600">Repeat until</text>
      <rect x="200" y="200" width="180" height="28" rx="8" fill="#f8fafc" stroke="#e2e8f0" />
      <text x="212" y="218" fill="#0f172a" fontSize="11">31 Aug</text>
      <rect x="388" y="250" width="140" height="32" rx="9" fill="#003B6F" />
      <text x="458" y="270" textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="600">Add sessions</text>
    </svg>
  );
}

function ClassesTimetableSvg() {
  return (
    <svg viewBox="0 0 560 248" className="mx-auto h-auto w-full max-w-[560px]" role="img" aria-label="An Upcoming sessions list showing three scheduled class sessions, each with a date and time, the class name, and a booked-of-capacity count, one of which is full.">
      <rect x="10" y="10" width="540" height="228" rx="14" fill="#ffffff" stroke="#e2e8f0" />
      <text x="32" y="40" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">UPCOMING SESSIONS</text>
      <rect x="28" y="54" width="504" height="48" rx="10" fill="#f8fafc" stroke="#e2e8f0" />
      <text x="44" y="76" fill="#0f172a" fontSize="11" fontWeight="600">Mon 6 Jul, 18:00</text>
      <text x="44" y="92" fill="#64748b" fontSize="10">Beginner Yoga</text>
      <rect x="412" y="66" width="104" height="24" rx="12" fill="#d1fae5" />
      <text x="464" y="82" textAnchor="middle" fill="#059669" fontSize="10" fontWeight="700">8 / 12 booked</text>
      <rect x="28" y="110" width="504" height="48" rx="10" fill="#f8fafc" stroke="#e2e8f0" />
      <text x="44" y="132" fill="#0f172a" fontSize="11" fontWeight="600">Wed 8 Jul, 18:00</text>
      <text x="44" y="148" fill="#64748b" fontSize="10">Beginner Yoga</text>
      <rect x="412" y="122" width="104" height="24" rx="12" fill="#fef3c7" />
      <text x="464" y="138" textAnchor="middle" fill="#d97706" fontSize="10" fontWeight="700">12 / 12 full</text>
      <rect x="28" y="166" width="504" height="48" rx="10" fill="#f8fafc" stroke="#e2e8f0" />
      <text x="44" y="188" fill="#0f172a" fontSize="11" fontWeight="600">Mon 13 Jul, 18:00</text>
      <text x="44" y="204" fill="#64748b" fontSize="10">Beginner Yoga</text>
      <rect x="412" y="178" width="104" height="24" rx="12" fill="#d1fae5" />
      <text x="464" y="194" textAnchor="middle" fill="#059669" fontSize="10" fontWeight="700">3 / 12 booked</text>
    </svg>
  );
}

function EventsEditorSvg() {
  return (
    <svg
      viewBox="0 0 560 638"
      className="mx-auto h-auto w-full max-w-[560px]"
      role="img"
      aria-label="The Create event form: a Schedule box with One date, Weekly, and Custom dates options, a two-column field grid for event name, date, capacity, start and end times, a Ticket types section with two tier rows and an Add ticket type button, and a Save event button."
    >
      {/* Card */}
      <rect x="10" y="10" width="540" height="618" rx="14" fill="#ffffff" stroke="#e2e8f0" />
      <text x="30" y="40" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">EVENTS</text>
      <text x="30" y="62" fill="#0f172a" fontSize="16" fontWeight="700">Create event</text>

      {/* Schedule box */}
      <rect x="30" y="78" width="500" height="86" rx="12" fill="#f8fafc" stroke="#e2e8f0" />
      <text x="46" y="100" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.06em">SCHEDULE</text>

      {/* Option 1 - One date (selected) */}
      <rect x="46" y="114" width="148" height="36" rx="9" fill="#E8EFF6" stroke="#00305C" />
      <circle cx="64" cy="132" r="6" fill="#ffffff" stroke="#00305C" strokeWidth="1.5" />
      <circle cx="64" cy="132" r="3" fill="#00305C" />
      <text x="78" y="136" fill="#00305C" fontSize="11" fontWeight="700">One date</text>

      {/* Option 2 - Weekly */}
      <rect x="202" y="114" width="178" height="36" rx="9" fill="#ffffff" stroke="#e2e8f0" />
      <circle cx="220" cy="132" r="6" fill="#ffffff" stroke="#cbd5e1" strokeWidth="1.5" />
      <text x="234" y="129" fill="#0f172a" fontSize="11" fontWeight="500">Weekly</text>
      <text x="234" y="142" fill="#64748b" fontSize="9">same weekday</text>

      {/* Option 3 - Custom dates */}
      <rect x="388" y="114" width="126" height="36" rx="9" fill="#ffffff" stroke="#e2e8f0" />
      <circle cx="406" cy="132" r="6" fill="#ffffff" stroke="#cbd5e1" strokeWidth="1.5" />
      <text x="420" y="136" fill="#0f172a" fontSize="11" fontWeight="500">Custom dates</text>

      {/* Field grid */}
      {/* Event name (full width) */}
      <text x="30" y="192" fill="#64748b" fontSize="9" fontWeight="600">Event name *</text>
      <rect x="30" y="198" width="500" height="30" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="44" y="217" fill="#94a3b8" fontSize="10">e.g. Seasonal tasting, Workshop</text>

      {/* Date + Capacity */}
      <text x="30" y="252" fill="#64748b" fontSize="9" fontWeight="600">Date *</text>
      <rect x="30" y="258" width="244" height="30" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="44" y="277" fill="#0f172a" fontSize="10" fontWeight="500">14 Aug 2026</text>
      <text x="252" y="277" fill="#64748b" fontSize="11">v</text>

      <text x="286" y="252" fill="#64748b" fontSize="9" fontWeight="600">Capacity *</text>
      <rect x="286" y="258" width="244" height="30" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="300" y="277" fill="#0f172a" fontSize="10" fontWeight="500">40</text>

      {/* Start + End time */}
      <text x="30" y="312" fill="#64748b" fontSize="9" fontWeight="600">Start time *</text>
      <rect x="30" y="318" width="244" height="30" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="44" y="337" fill="#0f172a" fontSize="10" fontWeight="500">18:00</text>

      <text x="286" y="312" fill="#64748b" fontSize="9" fontWeight="600">End time *</text>
      <rect x="286" y="318" width="244" height="30" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="300" y="337" fill="#0f172a" fontSize="10" fontWeight="500">20:00</text>

      {/* Ticket types section */}
      <text x="30" y="386" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.06em">TICKET TYPES</text>

      {/* Tier row 1 */}
      <rect x="30" y="396" width="500" height="58" rx="10" fill="#f1f5f9" stroke="#e2e8f0" />
      <text x="44" y="414" fill="#64748b" fontSize="8" fontWeight="600">Ticket name</text>
      <rect x="44" y="420" width="208" height="24" rx="7" fill="#ffffff" stroke="#e2e8f0" />
      <text x="56" y="436" fill="#0f172a" fontSize="10" fontWeight="500">General Admission</text>
      <text x="264" y="414" fill="#64748b" fontSize="8" fontWeight="600">Price (£)</text>
      <rect x="264" y="420" width="96" height="24" rx="7" fill="#ffffff" stroke="#e2e8f0" />
      <text x="276" y="436" fill="#0f172a" fontSize="10" fontWeight="500">25.00</text>
      <text x="372" y="414" fill="#64748b" fontSize="8" fontWeight="600">Cap (opt.)</text>
      <rect x="372" y="420" width="80" height="24" rx="7" fill="#ffffff" stroke="#e2e8f0" />
      <text x="384" y="436" fill="#94a3b8" fontSize="10">30</text>
      <text x="468" y="436" fill="#dc2626" fontSize="10" fontWeight="600">Remove</text>

      {/* Tier row 2 */}
      <rect x="30" y="462" width="500" height="58" rx="10" fill="#f1f5f9" stroke="#e2e8f0" />
      <text x="44" y="480" fill="#64748b" fontSize="8" fontWeight="600">Ticket name</text>
      <rect x="44" y="486" width="208" height="24" rx="7" fill="#ffffff" stroke="#e2e8f0" />
      <text x="56" y="502" fill="#0f172a" fontSize="10" fontWeight="500">Members</text>
      <text x="264" y="480" fill="#64748b" fontSize="8" fontWeight="600">Price (£)</text>
      <rect x="264" y="486" width="96" height="24" rx="7" fill="#ffffff" stroke="#e2e8f0" />
      <text x="276" y="502" fill="#0f172a" fontSize="10" fontWeight="500">20.00</text>
      <text x="372" y="480" fill="#64748b" fontSize="8" fontWeight="600">Cap (opt.)</text>
      <rect x="372" y="486" width="80" height="24" rx="7" fill="#ffffff" stroke="#e2e8f0" />
      <text x="384" y="502" fill="#94a3b8" fontSize="10">10</text>
      <text x="468" y="502" fill="#dc2626" fontSize="10" fontWeight="600">Remove</text>

      {/* Add ticket type */}
      <text x="30" y="546" fill="#00A0A4" fontSize="11" fontWeight="700">+ Add ticket type</text>

      {/* Save event button */}
      <rect x="30" y="568" width="500" height="38" rx="10" fill="#003B6F" />
      <text x="280" y="592" textAnchor="middle" fill="#ffffff" fontSize="12" fontWeight="700">Save event</text>
    </svg>
  );
}

function EventsAttendeesSvg() {
  const rows = [
    {
      name: 'Maya Patel',
      email: 'maya.patel@email.com',
      phone: '07700 900142',
      ticket: 'General Admission',
      qty: '2',
      status: 'Confirmed',
      time: '18:42',
      action: 'Clear',
    },
    {
      name: 'Tom Reyes',
      email: 'tom.reyes@email.com',
      phone: '07700 900318',
      ticket: 'VIP Table',
      qty: '4',
      status: 'Confirmed',
      time: '-',
      action: 'Arrived',
    },
    {
      name: 'Aisha Khan',
      email: 'aisha.khan@email.com',
      phone: '07700 900077',
      ticket: 'General Admission',
      qty: '1',
      status: 'Pending',
      time: '-',
      action: 'Arrived',
    },
  ];
  const rowY = (i: number) => 252 + i * 70;
  return (
    <svg
      viewBox="0 0 600 510"
      className="mx-auto h-auto w-full max-w-[600px]"
      role="img"
      aria-label="An event detail card with a Sales and capacity panel of four stat tiles and a capacity bar, then an Attendees list with status pills and Arrived check-in buttons, plus an Export CSV button."
    >
      {/* Sales & capacity panel */}
      <rect x="10" y="10" width="580" height="180" rx="14" fill="#ffffff" stroke="#e2e8f0" />
      <text x="30" y="36" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">EVENT</text>
      <text x="30" y="58" fill="#0f172a" fontSize="16" fontWeight="700">Sales &amp; capacity</text>

      {/* Four stat tiles */}
      <rect x="30" y="72" width="128" height="58" rx="10" fill="#f8fafc" stroke="#e2e8f0" />
      <text x="44" y="92" fill="#64748b" fontSize="9" fontWeight="600">Tickets sold</text>
      <text x="44" y="116" fill="#0f172a" fontSize="18" fontWeight="700">128</text>

      <rect x="166" y="72" width="128" height="58" rx="10" fill="#f8fafc" stroke="#e2e8f0" />
      <text x="180" y="92" fill="#64748b" fontSize="9" fontWeight="600">Revenue</text>
      <text x="180" y="116" fill="#00305C" fontSize="18" fontWeight="700">&#163;3,840</text>

      <rect x="302" y="72" width="128" height="58" rx="10" fill="#f8fafc" stroke="#e2e8f0" />
      <text x="316" y="92" fill="#64748b" fontSize="9" fontWeight="600">Seats taken</text>
      <text x="316" y="116" fill="#0f172a" fontSize="18" fontWeight="700">128<tspan fill="#64748b" fontSize="12" fontWeight="600"> / 150</tspan></text>

      <rect x="438" y="72" width="128" height="58" rx="10" fill="#f8fafc" stroke="#e2e8f0" />
      <text x="452" y="92" fill="#64748b" fontSize="9" fontWeight="600">Fill</text>
      <text x="452" y="116" fill="#00A0A4" fontSize="18" fontWeight="700">85%</text>

      {/* Capacity progress bar */}
      <rect x="30" y="150" width="536" height="10" rx="5" fill="#f1f5f9" />
      <rect x="30" y="150" width="456" height="10" rx="5" fill="#00305C" />
      <text x="30" y="180" fill="#64748b" fontSize="9">Capacity used</text>
      <text x="566" y="180" textAnchor="end" fill="#64748b" fontSize="9">128 of 150 seats</text>

      {/* Attendees header + Export CSV */}
      <text x="14" y="218" fill="#0f172a" fontSize="15" fontWeight="700">Attendees</text>
      <rect x="466" y="202" width="124" height="26" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="528" y="219" textAnchor="middle" fill="#0f172a" fontSize="11" fontWeight="600">Export CSV</text>

      {/* Attendee rows */}
      {rows.map((r, i) => {
        const y = rowY(i);
        const ok = r.status === 'Confirmed';
        const pillFill = ok ? '#059669' : '#d97706';
        const pillW = ok ? 70 : 62;
        const checkedIn = r.action === 'Clear';
        return (
          <g key={r.name}>
            <rect x="10" y={y} width="580" height="58" rx="12" fill="#ffffff" stroke="#e2e8f0" />

            {/* guest identity */}
            <text x="28" y={y + 22} fill="#0f172a" fontSize="12" fontWeight="700">{r.name}</text>
            <text x="28" y={y + 38} fill="#64748b" fontSize="9.5">{r.email}</text>
            <text x="28" y={y + 50} fill="#64748b" fontSize="9.5">{r.phone}</text>

            {/* ticket type + qty */}
            <text x="232" y={y + 26} fill="#0f172a" fontSize="10.5" fontWeight="600">{r.ticket}</text>
            <text x="232" y={y + 42} fill="#64748b" fontSize="9.5">{'x' + r.qty}</text>

            {/* quantity number */}
            <rect x={360} y={y + 16} width="26" height="26" rx="7" fill="#f1f5f9" />
            <text x={373} y={y + 33} textAnchor="middle" fill="#0f172a" fontSize="12" fontWeight="700">{r.qty}</text>

            {/* status pill */}
            <rect x={398} y={y + 17} width={pillW} height="22" rx="11" fill={ok ? '#ecfdf5' : '#fef3c7'} />
            <circle cx={410} cy={y + 28} r="3.5" fill={pillFill} />
            <text x={419} y={y + 32} fill={pillFill} fontSize="10" fontWeight="600">{r.status}</text>

            {/* arrived time / dash */}
            <text x={482} y={y + 32} fill={r.time === '-' ? '#64748b' : '#0f172a'} fontSize="10" fontWeight={r.time === '-' ? '400' : '600'}>{r.time}</text>

            {/* action button */}
            {checkedIn ? (
              <g>
                <rect x={520} y={y + 16} width="56" height="26" rx="8" fill="#ffffff" stroke="#e2e8f0" />
                <text x={548} y={y + 33} textAnchor="middle" fill="#64748b" fontSize="11" fontWeight="600">Clear</text>
              </g>
            ) : (
              <g>
                <rect x={520} y={y + 16} width="56" height="26" rx="8" fill="#d97706" />
                <text x={548} y={y + 33} textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="600">Arrived</text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function ResourcesEditorSvg() {
  return (
    <svg
      viewBox="0 0 560 760"
      className="mx-auto h-auto w-full max-w-[560px]"
      role="img"
      aria-label="The Add a bookable resource form in four numbered sections: Basics with a Resource name and Type field, Team calendar with a Show on calendar dropdown, Booking rules with start times, longest and shortest booking inputs, and Pricing and payment with a price field and three payment cards, ending in a Create resource button."
    >
      <text x="10" y="26" fill="#0f172a" fontSize="17" fontWeight="700">Add a bookable resource</text>

      {/* Section 1 - Basics */}
      <rect x="10" y="42" width="540" height="142" rx="14" fill="#ffffff" stroke="#e2e8f0" />
      <circle cx="34" cy="70" r="13" fill="#00305C" />
      <text x="34" y="74" textAnchor="middle" fill="#ffffff" fontSize="12" fontWeight="700">1</text>
      <text x="56" y="68" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">STEP 1</text>
      <text x="56" y="84" fill="#0f172a" fontSize="14" fontWeight="700">Basics</text>

      <text x="30" y="110" fill="#0f172a" fontSize="11" fontWeight="700">Resource name *</text>
      <rect x="30" y="116" width="500" height="30" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="44" y="135" fill="#94a3b8" fontSize="11">e.g. Court 1, Studio A</text>

      <text x="30" y="160" fill="#0f172a" fontSize="11" fontWeight="700">Type</text>
      <rect x="30" y="166" width="240" height="12" rx="6" fill="#f1f5f9" />

      {/* Section 2 - Team calendar */}
      <rect x="10" y="196" width="540" height="116" rx="14" fill="#ffffff" stroke="#e2e8f0" />
      <circle cx="34" cy="224" r="13" fill="#00305C" />
      <text x="34" y="228" textAnchor="middle" fill="#ffffff" fontSize="12" fontWeight="700">2</text>
      <text x="56" y="222" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">STEP 2</text>
      <text x="56" y="238" fill="#0f172a" fontSize="14" fontWeight="700">Team calendar</text>

      <text x="30" y="264" fill="#0f172a" fontSize="11" fontWeight="700">Show on calendar *</text>
      <rect x="30" y="270" width="500" height="30" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="44" y="289" fill="#94a3b8" fontSize="11">Select a calendar column</text>
      <text x="512" y="289" fill="#64748b" fontSize="11">▾</text>

      {/* Section 3 - Booking rules */}
      <rect x="10" y="324" width="540" height="186" rx="14" fill="#ffffff" stroke="#e2e8f0" />
      <circle cx="34" cy="352" r="13" fill="#00305C" />
      <text x="34" y="356" textAnchor="middle" fill="#ffffff" fontSize="12" fontWeight="700">3</text>
      <text x="56" y="350" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">STEP 3</text>
      <text x="56" y="366" fill="#0f172a" fontSize="14" fontWeight="700">Booking rules</text>

      <text x="30" y="392" fill="#0f172a" fontSize="11" fontWeight="700">Start times every (minutes)</text>
      <rect x="30" y="398" width="245" height="30" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="44" y="417" fill="#0f172a" fontSize="11" fontWeight="500">30</text>

      <text x="285" y="392" fill="#0f172a" fontSize="11" fontWeight="700">Longest booking (minutes)</text>
      <rect x="285" y="398" width="245" height="30" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="299" y="417" fill="#0f172a" fontSize="11" fontWeight="500">120</text>

      <text x="30" y="452" fill="#0f172a" fontSize="11" fontWeight="700">Shortest booking (minutes)</text>
      <rect x="30" y="458" width="245" height="30" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="44" y="477" fill="#0f172a" fontSize="11" fontWeight="500">60</text>

      <rect x="299" y="461" width="16" height="16" rx="4" fill="#ffffff" stroke="#cbd5e1" />
      <path d="M302 469 l3 3 l5 -6" fill="none" stroke="#00A0A4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <text x="324" y="473" fill="#0f172a" fontSize="11" fontWeight="600">Advanced</text>

      {/* Section 4 - Pricing & payment */}
      <rect x="10" y="522" width="540" height="186" rx="14" fill="#ffffff" stroke="#e2e8f0" />
      <circle cx="34" cy="550" r="13" fill="#00305C" />
      <text x="34" y="554" textAnchor="middle" fill="#ffffff" fontSize="12" fontWeight="700">4</text>
      <text x="56" y="548" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">STEP 4</text>
      <text x="56" y="564" fill="#0f172a" fontSize="14" fontWeight="700">Pricing &amp; payment</text>

      <text x="30" y="590" fill="#0f172a" fontSize="11" fontWeight="700">Price per 30-minute step</text>
      <rect x="30" y="596" width="180" height="30" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="44" y="615" fill="#0f172a" fontSize="11" fontWeight="500">£12.00</text>

      {/* three payment cards */}
      <rect x="30" y="636" width="160" height="36" rx="9" fill="#E8EFF6" stroke="#00305C" strokeWidth="1.5" />
      <text x="110" y="658" textAnchor="middle" fill="#00305C" fontSize="11" fontWeight="700">Pay at venue</text>

      <rect x="200" y="636" width="160" height="36" rx="9" fill="#ffffff" stroke="#e2e8f0" />
      <text x="280" y="658" textAnchor="middle" fill="#0f172a" fontSize="11" fontWeight="500">Deposit online</text>

      <rect x="370" y="636" width="160" height="36" rx="9" fill="#ffffff" stroke="#e2e8f0" />
      <text x="450" y="658" textAnchor="middle" fill="#0f172a" fontSize="11" fontWeight="500">Pay in full</text>

      <rect x="30" y="684" width="16" height="16" rx="4" fill="#00A0A4" />
      <path d="M33 692 l3 3 l5 -6" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <text x="55" y="696" fill="#0f172a" fontSize="11" fontWeight="600">Active (bookable by guests)</text>

      {/* Create resource button */}
      <rect x="368" y="722" width="182" height="34" rx="10" fill="#003B6F" />
      <text x="459" y="744" textAnchor="middle" fill="#ffffff" fontSize="12" fontWeight="700">Create resource</text>
    </svg>
  );
}

function ResourcesSlotsSvg() {
  const x = (m: number) => 70 + (m - 540) * (560 / 180); // 540min=09:00 to 720min=12:00 across 560px
  const ticks = [540, 570, 600, 630, 660, 690, 720];
  const label = (m: number) => {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${String(h).padStart(2, '0')}:${mm === 0 ? '00' : '30'}`;
  };
  const rulerY = 70;
  const barY = 132;
  const barH = 30;
  const bookStart = 600; // 10:00
  const bookEnd = 690; // 11:30 (3 steps)
  const coinSteps = [600, 630, 660]; // start of each covered step
  return (
    <svg
      viewBox="0 0 700 360"
      className="h-auto w-full"
      role="img"
      aria-label="A time ruler from 09:00 to 12:00 with start-time steps every 30 minutes. A shaded booking bar spans three steps. A short bracket shows the shortest allowed booking and a longer bracket shows the longest. A coin sits on each step the booking covers, charged per step."
    >
      {/* eyebrow + title */}
      <text x="20" y="28" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">SLOT RULES</text>
      <text x="20" y="48" fill="#0f172a" fontSize="15" fontWeight="700">How slot rules fit together</text>

      {/* Start-time step ruler */}
      <text x="20" y={rulerY - 8} fill="#64748b" fontSize="10" fontWeight="600">Start-time step (every 30 min)</text>
      <line x1={x(540)} y1={rulerY} x2={x(720)} y2={rulerY} stroke="#e2e8f0" strokeWidth="2" />
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} y1={rulerY - 6} x2={x(t)} y2={rulerY + 6} stroke="#94a3b8" strokeWidth="1.5" />
          <line x1={x(t)} y1={rulerY + 6} x2={x(t)} y2={barY - 6} stroke="#e2e8f0" strokeWidth="1" strokeDasharray="3 4" />
          <text x={x(t)} y={rulerY - 12} textAnchor="middle" fill="#64748b" fontSize="9">{label(t)}</text>
        </g>
      ))}

      {/* empty grid track (muted) */}
      <rect x={x(540)} y={barY} width={x(720) - x(540)} height={barH} rx="8" fill="#f1f5f9" stroke="#e2e8f0" />

      {/* booking bar (accent) */}
      <rect x={x(bookStart)} y={barY} width={x(bookEnd) - x(bookStart)} height={barH} rx="8" fill="#00A0A4" />
      <text x={(x(bookStart) + x(bookEnd)) / 2} y={barY + 20} textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="700">Booking 10:00 to 11:30</text>

      {/* coins on each covered step */}
      {coinSteps.map((s) => {
        const cx = (x(s) + x(s + 30)) / 2;
        return (
          <g key={s}>
            <circle cx={cx} cy={barY - 18} r="9" fill="#fef3c7" stroke="#d97706" strokeWidth="1.5" />
            <text x={cx} y={barY - 14} textAnchor="middle" fill="#d97706" fontSize="10" fontWeight="700">&#163;</text>
          </g>
        );
      })}

      {/* price caption */}
      <path d={`M ${x(615) - 3} ${barY - 32} L ${x(615)} ${barY - 27} L ${x(615) + 3} ${barY - 32} Z`} fill="#d97706" />
      <line x1={x(615)} y1={barY - 40} x2={x(615)} y2={barY - 29} stroke="#d97706" strokeWidth="1.5" />
      <rect x={x(615) - 90} y={barY - 60} width="200" height="20" rx="10" fill="#fef3c7" />
      <text x={x(615) + 10} y={barY - 46} textAnchor="middle" fill="#d97706" fontSize="10" fontWeight="600">Price is charged per step, not per booking</text>

      {/* Shortest booking bracket (1 step, under 09:00-09:30) */}
      {(() => {
        const sx = x(540);
        const ex = x(570);
        const by = barY + barH + 26;
        return (
          <g>
            <path d={`M ${sx} ${by - 6} L ${sx} ${by} L ${ex} ${by} L ${ex} ${by - 6}`} fill="none" stroke="#64748b" strokeWidth="1.5" />
            <rect x={sx} y={by + 6} width={ex - sx} height="18" rx="6" fill="#C2F4F5" />
            <text x={(sx + ex) / 2} y={by + 19} textAnchor="middle" fill="#00305C" fontSize="9" fontWeight="700">1 step</text>
            <text x={sx} y={by + 44} fill="#0f172a" fontSize="10" fontWeight="600">Shortest booking (minimum length)</text>
          </g>
        );
      })()}

      {/* Longest booking bracket (4 steps, under 10:30-12:00) */}
      {(() => {
        const sx = x(630);
        const ex = x(720);
        const by = barY + barH + 90;
        return (
          <g>
            <path d={`M ${sx} ${by - 6} L ${sx} ${by} L ${ex} ${by} L ${ex} ${by - 6}`} fill="none" stroke="#64748b" strokeWidth="1.5" />
            <rect x={sx} y={by + 6} width={ex - sx} height="18" rx="6" fill="#E8EFF6" />
            <text x={(sx + ex) / 2} y={by + 19} textAnchor="middle" fill="#00305C" fontSize="9" fontWeight="700">up to 4 steps</text>
            <text x={ex} y={by + 44} textAnchor="end" fill="#0f172a" fontSize="10" fontWeight="600">Longest booking (maximum length)</text>
          </g>
        );
      })()}
    </svg>
  );
}

function ServiceBookingModeSvg() {
  return (
    <svg
      viewBox="0 0 560 296"
      className="mx-auto h-auto w-full max-w-[560px]"
      role="img"
      aria-label="The 'How will clients book this service?' card with two choices. One fixed offering is selected, for one duration, buffer and price on every booking. Multiple bookable options lets guests pick a version, such as a length or style, before choosing a time."
    >
      {/* Outer card */}
      <rect x="10" y="10" width="540" height="276" rx="14" fill="#ffffff" stroke="#e2e8f0" />

      {/* Title + sub */}
      <text x="30" y="42" fill="#0f172a" fontSize="13" fontWeight="700">How will clients book this service?</text>
      <text x="30" y="62" fill="#64748b" fontSize="10">Choose one structure. Use multiple options when guests must pick a tier</text>
      <text x="30" y="76" fill="#64748b" fontSize="10">first (e.g. duration or style). Use one fixed offering when every booking is the same.</text>

      {/* Card A - One fixed offering (selected) */}
      <rect x="30" y="92" width="500" height="60" rx="12" fill="#eff6fc" stroke="#00305C" strokeWidth="1.5" />
      <circle cx="52" cy="122" r="7" fill="#ffffff" stroke="#00305C" strokeWidth="1.5" />
      <circle cx="52" cy="122" r="3.5" fill="#00305C" />
      <text x="72" y="117" fill="#0f172a" fontSize="12" fontWeight="700">One fixed offering</text>
      <text x="72" y="137" fill="#64748b" fontSize="10">One duration, buffer, and price. What you set above applies to every booking.</text>

      {/* Card B - Multiple bookable options (unselected) */}
      <rect x="30" y="164" width="500" height="106" rx="12" fill="#ffffff" stroke="#e2e8f0" />
      <circle cx="52" cy="192" r="7" fill="#ffffff" stroke="#cbd5e1" strokeWidth="1.5" />
      <text x="72" y="196" fill="#0f172a" fontSize="12" fontWeight="700">Multiple bookable options</text>
      <text x="72" y="216" fill="#64748b" fontSize="10">Guests choose an option before picking a time. Set up one option at a time,</text>
      <text x="72" y="232" fill="#64748b" fontSize="10">then add the next. Each option has its own duration, buffer, price, optional</text>
      <text x="72" y="248" fill="#64748b" fontSize="10">description, and optional deposit override.</text>
    </svg>
  );
}

function ServiceVariantsSvg() {
  const cols = [
    { x: 40, label: 'Duration *', value: '60' },
    { x: 162, label: 'Buffer', value: '10' },
    { x: 284, label: 'Price (£)', value: '65.00' },
    { x: 406, label: 'Deposit (£)', value: '10.00' },
  ];
  return (
    <svg
      viewBox="0 0 560 548"
      className="mx-auto h-auto w-full max-w-[560px]"
      role="img"
      aria-label="The Bookable options editor. Option 1 is complete and marked Ready, with a name, optional description, duration, buffer, price and deposit, plus an Offer this option to clients checkbox. Option 2 is In progress because its price is empty, which is required for an option you offer online when you charge full payment, so the Add another option button is greyed out until it is finished."
    >
      {/* Outer panel */}
      <rect x="10" y="10" width="540" height="528" rx="14" fill="#ffffff" stroke="#e2e8f0" />

      {/* Header */}
      <text x="30" y="40" fill="#0f172a" fontSize="13" fontWeight="700">Bookable options</text>
      <rect x="156" y="28" width="74" height="18" rx="9" fill="#E8EFF6" stroke="#cdddec" />
      <text x="193" y="41" textAnchor="middle" fill="#00305C" fontSize="10" fontWeight="700">2 options</text>
      <text x="30" y="60" fill="#64748b" fontSize="10">Add another once an option has a name, a valid duration, and a price for options you offer online.</text>

      {/* Option 1 card - Ready */}
      <rect x="26" y="76" width="508" height="224" rx="12" fill="#ffffff" stroke="#e2e8f0" />
      <rect x="40" y="90" width="62" height="18" rx="5" fill="#f1f5f9" />
      <text x="71" y="103" textAnchor="middle" fill="#334155" fontSize="10" fontWeight="700">Option 1</text>
      <text x="112" y="103" fill="#059669" fontSize="10" fontWeight="600">Ready</text>
      <rect x="462" y="89" width="56" height="22" rx="7" fill="#ffffff" stroke="#e2e8f0" />
      <text x="490" y="104" textAnchor="middle" fill="#64748b" fontSize="10" fontWeight="600">Remove</text>
      <line x1="40" y1="118" x2="518" y2="118" stroke="#f1f5f9" strokeWidth="1" />

      {/* Option 1 name */}
      <rect x="40" y="126" width="478" height="30" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="54" y="145" fill="#0f172a" fontSize="11" fontWeight="500">60 minutes</text>

      {/* Option 1 description */}
      <text x="40" y="172" fill="#64748b" fontSize="9" fontWeight="600">Optional description (shown when they pick this option)</text>
      <rect x="40" y="178" width="478" height="30" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="54" y="197" fill="#64748b" fontSize="10">Includes a warm towel and short consultation.</text>

      {/* Option 1 grid */}
      {cols.map((c) => (
        <g key={c.label}>
          <text x={c.x} y="228" fill="#64748b" fontSize="9" fontWeight="600">{c.label}</text>
          <rect x={c.x} y="234" width="110" height="28" rx="8" fill="#ffffff" stroke="#e2e8f0" />
          <text x={c.x + 12} y="253" fill="#0f172a" fontSize="11" fontWeight="500">{c.value}</text>
        </g>
      ))}

      {/* Option 1 offer checkbox */}
      <rect x="40" y="276" width="14" height="14" rx="4" fill="#00305C" />
      <path d="M44 283 l3 3 l5 -6" fill="none" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <text x="62" y="287" fill="#334155" fontSize="10" fontWeight="500">Offer this option to clients</text>

      {/* Option 2 card - In progress */}
      <rect x="26" y="312" width="508" height="152" rx="12" fill="#ffffff" stroke="#fbbf24" strokeWidth="1.5" />
      <rect x="40" y="326" width="62" height="18" rx="5" fill="#f1f5f9" />
      <text x="71" y="339" textAnchor="middle" fill="#334155" fontSize="10" fontWeight="700">Option 2</text>
      <text x="112" y="339" fill="#d97706" fontSize="10" fontWeight="600">In progress</text>
      <rect x="462" y="325" width="56" height="22" rx="7" fill="#ffffff" stroke="#e2e8f0" />
      <text x="490" y="340" textAnchor="middle" fill="#64748b" fontSize="10" fontWeight="600">Remove</text>
      <line x1="40" y1="354" x2="518" y2="354" stroke="#f1f5f9" strokeWidth="1" />
      <rect x="40" y="362" width="478" height="30" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="54" y="381" fill="#0f172a" fontSize="11" fontWeight="500">90 minutes</text>
      {[
        { x: 40, label: 'Duration *', value: '90', empty: false },
        { x: 162, label: 'Buffer', value: '10', empty: false },
        { x: 284, label: 'Price (£)', value: '', empty: true },
        { x: 406, label: 'Deposit (£)', value: '', empty: false },
      ].map((c) => (
        <g key={`o2-${c.label}`}>
          <text x={c.x} y="408" fill="#64748b" fontSize="9" fontWeight="600">{c.label}</text>
          <rect x={c.x} y="414" width="110" height="28" rx="8" fill={c.empty ? '#fffbeb' : '#ffffff'} stroke={c.empty ? '#f59e0b' : '#e2e8f0'} />
          {c.empty ? (
            <text x={c.x + 12} y="433" fill="#cbd5e1" fontSize="11">0.00</text>
          ) : (
            <text x={c.x + 12} y="433" fill="#0f172a" fontSize="11" fontWeight="500">{c.value}</text>
          )}
        </g>
      ))}

      {/* Add another option (disabled) + hint */}
      <text x="30" y="492" fill="#64748b" fontSize="10">Complete every option above to unlock adding another.</text>
      <rect x="356" y="476" width="178" height="32" rx="9" fill="#f1f5f9" stroke="#e2e8f0" />
      <text x="445" y="496" textAnchor="middle" fill="#94a3b8" fontSize="11" fontWeight="700">+ Add another option</text>
    </svg>
  );
}

function ServiceAddonsSvg() {
  const options = [
    { name: 'Hot stones', extra: '+£15.00 · +15 min' },
    { name: 'Scalp massage', extra: '+£10.00' },
    { name: 'Aromatherapy oils', extra: '+£5.00' },
  ];
  return (
    <svg
      viewBox="0 0 560 256"
      className="mx-auto h-auto w-full max-w-[560px]"
      role="img"
      aria-label="The Add-ons card in the service editor, with Use existing group and Add group buttons, and one linked group called Optional extras set to pick any with a maximum of two. The group lists three options, each with an extra price and some with extra minutes, plus reorder, Edit and Remove controls."
    >
      {/* Outer card */}
      <rect x="10" y="10" width="540" height="234" rx="14" fill="#ffffff" stroke="#e2e8f0" />

      {/* Header */}
      <text x="30" y="40" fill="#0f172a" fontSize="13" fontWeight="700">Add-ons</text>
      <text x="30" y="58" fill="#64748b" fontSize="10">Optional extras a client can add at booking time. Each group sets its own</text>
      <text x="30" y="72" fill="#64748b" fontSize="10">rules: pick one, pick many, required, or optional.</text>

      {/* Buttons */}
      <rect x="296" y="26" width="124" height="26" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="358" y="43" textAnchor="middle" fill="#334155" fontSize="10" fontWeight="600">Use existing group</text>
      <rect x="428" y="26" width="92" height="26" rx="8" fill="#00305C" />
      <text x="474" y="43" textAnchor="middle" fill="#ffffff" fontSize="10" fontWeight="600">+ Add group</text>

      {/* Linked group row */}
      <rect x="30" y="90" width="500" height="140" rx="12" fill="#ffffff" stroke="#e2e8f0" />
      <text x="46" y="114" fill="#0f172a" fontSize="12" fontWeight="700">Optional extras</text>
      <text x="46" y="132" fill="#64748b" fontSize="10">Pick any, max 2 · 3 options</text>

      {/* Controls */}
      <text x="350" y="119" fill="#94a3b8" fontSize="13">↑</text>
      <text x="372" y="119" fill="#94a3b8" fontSize="13">↓</text>
      <rect x="392" y="102" width="52" height="24" rx="7" fill="#ffffff" stroke="#e2e8f0" />
      <text x="418" y="118" textAnchor="middle" fill="#334155" fontSize="10" fontWeight="600">Edit</text>
      <rect x="452" y="102" width="68" height="24" rx="7" fill="#ffffff" stroke="#fecaca" />
      <text x="486" y="118" textAnchor="middle" fill="#b91c1c" fontSize="10" fontWeight="600">Remove</text>

      {/* Option list */}
      {options.map((o, i) => {
        const y = 160 + i * 24;
        return (
          <g key={o.name}>
            <text x="46" y={y} fill="#334155" fontSize="10.5">{o.name}</text>
            <text x="514" y={y} textAnchor="end" fill="#0f172a" fontSize="10" fontWeight="500">{o.extra}</text>
          </g>
        );
      })}
    </svg>
  );
}

function AddonGroupEditorSvg() {
  return (
    <svg
      viewBox="0 0 560 632"
      className="mx-auto h-auto w-full max-w-[560px]"
      role="img"
      aria-label="The Add an add-on group dialog: a Group name, a Prompt to client question, a Selection choice of Pick one or Pick multiple with Minimum and Maximum, a Hide from online booking page checkbox, and an Options list where each extra has a name, description, an extra price, extra minutes and an Active toggle, ending in Cancel and Add group buttons."
    >
      {/* Modal */}
      <rect x="10" y="10" width="540" height="612" rx="14" fill="#ffffff" stroke="#e2e8f0" />
      <rect x="10" y="10" width="540" height="46" rx="14" fill="#f8fafc" />
      <rect x="10" y="42" width="540" height="14" fill="#f8fafc" />
      <text x="30" y="40" fill="#0f172a" fontSize="15" fontWeight="700">Add an add-on group</text>
      <text x="522" y="40" textAnchor="end" fill="#64748b" fontSize="16" fontWeight="600">×</text>
      <line x1="10" y1="56" x2="550" y2="56" stroke="#e2e8f0" strokeWidth="1" />

      {/* Group name */}
      <text x="30" y="80" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">GROUP NAME <tspan fill="#dc2626">*</tspan></text>
      <rect x="30" y="88" width="500" height="30" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="44" y="108" fill="#0f172a" fontSize="11" fontWeight="500">Optional extras</text>
      <text x="30" y="132" fill="#94a3b8" fontSize="9">Internal label. Shown to clients only if the prompt is blank.</text>

      {/* Prompt to client */}
      <text x="30" y="156" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">PROMPT TO CLIENT</text>
      <rect x="30" y="164" width="500" height="30" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="44" y="184" fill="#0f172a" fontSize="11" fontWeight="500">Would you like any extras?</text>
      <text x="30" y="208" fill="#94a3b8" fontSize="9">Shown above the options at booking. Falls back to the group name.</text>

      {/* Selection */}
      <text x="30" y="234" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">SELECTION</text>
      <circle cx="46" cy="252" r="6" fill="#ffffff" stroke="#cbd5e1" strokeWidth="1.5" />
      <text x="60" y="256" fill="#0f172a" fontSize="11">Pick one</text>
      <circle cx="148" cy="252" r="6" fill="#ffffff" stroke="#00305C" strokeWidth="1.5" />
      <circle cx="148" cy="252" r="3" fill="#00305C" />
      <text x="162" y="256" fill="#0f172a" fontSize="11" fontWeight="600">Pick multiple</text>

      {/* Min / Max */}
      <text x="30" y="291" fill="#64748b" fontSize="10">Minimum</text>
      <rect x="96" y="277" width="50" height="24" rx="7" fill="#ffffff" stroke="#e2e8f0" />
      <text x="121" y="294" textAnchor="middle" fill="#0f172a" fontSize="11">0</text>
      <text x="166" y="291" fill="#64748b" fontSize="10">Maximum</text>
      <rect x="236" y="277" width="50" height="24" rx="7" fill="#ffffff" stroke="#e2e8f0" />
      <text x="261" y="294" textAnchor="middle" fill="#0f172a" fontSize="11">2</text>

      {/* Hide from online */}
      <rect x="30" y="314" width="14" height="14" rx="4" fill="#ffffff" stroke="#cbd5e1" strokeWidth="1.5" />
      <text x="52" y="325" fill="#334155" fontSize="10">Hide from online booking page (staff-only)</text>
      <line x1="30" y1="348" x2="530" y2="348" stroke="#f1f5f9" strokeWidth="1" />

      {/* Options header */}
      <text x="30" y="370" fill="#64748b" fontSize="9" fontWeight="700" letterSpacing="0.08em">OPTIONS</text>
      <rect x="436" y="356" width="94" height="24" rx="7" fill="#ffffff" stroke="#e2e8f0" />
      <text x="483" y="372" textAnchor="middle" fill="#334155" fontSize="10" fontWeight="600">+ Add option</text>

      {/* Option row 1 */}
      <rect x="30" y="386" width="500" height="104" rx="10" fill="#ffffff" stroke="#e2e8f0" />
      <rect x="44" y="396" width="360" height="24" rx="7" fill="#ffffff" stroke="#e2e8f0" />
      <text x="56" y="412" fill="#0f172a" fontSize="10.5" fontWeight="500">Hot stones</text>
      <rect x="44" y="424" width="360" height="24" rx="7" fill="#ffffff" stroke="#e2e8f0" />
      <text x="56" y="440" fill="#64748b" fontSize="10">Smooth heated stones across the back.</text>
      <text x="44" y="466" fill="#64748b" fontSize="9">Extra price (£)</text>
      <rect x="132" y="454" width="56" height="20" rx="6" fill="#ffffff" stroke="#e2e8f0" />
      <text x="140" y="468" fill="#0f172a" fontSize="10">15.00</text>
      <text x="202" y="466" fill="#64748b" fontSize="9">Extra minutes</text>
      <rect x="284" y="454" width="44" height="20" rx="6" fill="#ffffff" stroke="#e2e8f0" />
      <text x="292" y="468" fill="#0f172a" fontSize="10">15</text>
      <rect x="342" y="454" width="14" height="14" rx="4" fill="#00A0A4" />
      <path d="M346 461 l3 3 l5 -6" fill="none" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <text x="362" y="466" fill="#334155" fontSize="10">Active</text>
      <text x="512" y="410" fill="#94a3b8" fontSize="14">×</text>

      {/* Option row 2 */}
      <rect x="30" y="500" width="500" height="72" rx="10" fill="#ffffff" stroke="#e2e8f0" />
      <rect x="44" y="510" width="360" height="24" rx="7" fill="#ffffff" stroke="#e2e8f0" />
      <text x="56" y="526" fill="#0f172a" fontSize="10.5" fontWeight="500">Aromatherapy oils</text>
      <text x="44" y="556" fill="#64748b" fontSize="9">Extra price (£)</text>
      <rect x="132" y="544" width="56" height="20" rx="6" fill="#ffffff" stroke="#e2e8f0" />
      <text x="140" y="558" fill="#0f172a" fontSize="10">5.00</text>
      <text x="202" y="556" fill="#64748b" fontSize="9">Extra minutes</text>
      <rect x="284" y="544" width="44" height="20" rx="6" fill="#ffffff" stroke="#e2e8f0" />
      <text x="292" y="558" fill="#0f172a" fontSize="10">0</text>
      <rect x="342" y="544" width="14" height="14" rx="4" fill="#00A0A4" />
      <path d="M346 551 l3 3 l5 -6" fill="none" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <text x="362" y="556" fill="#334155" fontSize="10">Active</text>
      <text x="512" y="524" fill="#94a3b8" fontSize="14">×</text>

      {/* Footer */}
      <line x1="10" y1="582" x2="550" y2="582" stroke="#e2e8f0" strokeWidth="1" />
      <rect x="346" y="590" width="80" height="28" rx="8" fill="#ffffff" stroke="#e2e8f0" />
      <text x="386" y="608" textAnchor="middle" fill="#64748b" fontSize="11" fontWeight="600">Cancel</text>
      <rect x="434" y="590" width="96" height="28" rx="8" fill="#00305C" />
      <text x="482" y="608" textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="600">Add group</text>
    </svg>
  );
}

export const CATALOGUE_FIGURES: Record<string, { title: string; caption: string; node: ReactNode }> = {
  "services-editor": { title: "Add Service form", caption: "The service editor showing the core fields a guest booking depends on.", node: <ServicesEditorSvg /> },
  "services-flow": { title: "From service to booking page", caption: "How a service becomes bookable for guests in three steps.", node: <ServicesFlowSvg /> },
  "service-booking-mode": { title: "How will clients book this service?", caption: "Pick one fixed offering for an identical booking every time, or multiple bookable options to let clients choose a version first.", node: <ServiceBookingModeSvg /> },
  "service-variants": { title: "Bookable options", caption: "Build each option in turn (name, duration, buffer, price), then add the next. Add another unlocks once the current option is complete.", node: <ServiceVariantsSvg /> },
  "service-addons": { title: "Add-ons", caption: "Optional extras grouped by question. Each group can be pick one or pick multiple, required or optional, with its own price and extra time.", node: <ServiceAddonsSvg /> },
  "addon-group-editor": { title: "Add an add-on group", caption: "Name the group, ask the client a prompt, choose how many they can pick, then list each option with an extra price and extra minutes.", node: <AddonGroupEditorSvg /> },
  "classes-type": { title: "New class type", caption: "Create the template guests book: name, duration, capacity, calendar, and price.", node: <ClassesTypeSvg /> },
  "classes-schedule": { title: "Schedule classes", caption: "Put a class type onto real dates: one date, weekly, or custom dates.", node: <ClassesScheduleSvg /> },
  "classes-timetable": { title: "Upcoming sessions", caption: "Each scheduled session shows a booked-of-capacity count so you can see how full it is.", node: <ClassesTimetableSvg /> },
  "events-editor": { title: "Create event form", caption: "The Create event form with schedule mode, capacity, ticket types, and the Add ticket type button.", node: <EventsEditorSvg /> },
  "events-attendees": { title: "Event detail: attendees", caption: "An event's attendee list with the Arrived check-in action and an Export CSV button.", node: <EventsAttendeesSvg /> },
  "resources-editor": { title: "Add a bookable resource", caption: "The resource form, showing the key fields from name through to pricing and payment.", node: <ResourcesEditorSvg /> },
  "resources-slots": { title: "How slot rules fit together", caption: "Start-time step sets when a booking can begin, shortest and longest set its length, and price is charged per step.", node: <ResourcesSlotsSvg /> },
};
