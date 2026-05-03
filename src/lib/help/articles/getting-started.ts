import type { HelpCategory } from '../types';
import { RESERVENI_MARKETING_PAYMENTS_AND_NO_HOLD } from '@/lib/booking-funds-copy';

export const gettingStartedCategory: HelpCategory = {
  slug: 'getting-started',
  title: 'Getting started',
  description:
    'First steps after signup: dashboard, profile, Stripe, and your public booking page.',
  plan: 'all',
  articles: [
    {
      slug: 'welcome',
      title: 'Welcome to ReserveNI',
      description: 'What ReserveNI is, who it is for, and how the dashboard fits together.',
      tags: ['overview', 'basics'],
      content: `
# Welcome to ReserveNI

ReserveNI is a booking and guest management platform built for hospitality and appointment businesses in Northern Ireland. You run day-to-day work from the **dashboard**; customers book through your **public booking page** and, if you use it, a **website embed**.

## What you can do

- Take **table reservations**, **appointments**, **classes**, **ticketed events**, or **resource** bookings, depending on your plan and which booking types you turn on.
- Collect **deposits and full payments** with **Stripe Connect**. ${RESERVENI_MARKETING_PAYMENTS_AND_NO_HOLD}
- Automate **email and SMS** (confirmations, reminders, deposit prompts, and more).
- Use **reports**, **exports**, and (on appointment plans) **import** clients and bookings from other systems.

## Plans at a glance

- **Restaurant** or **Founding Partner**: full **dining** experience, including **table management** (floor plan, table grid, dining availability).
- **Appointments Pro, Plus, or Light**: **calendars**, **services**, and schedule tools. **Light** and **Plus** cap how many active calendars and staff accounts you can use. See **Appointments plan** in this help centre for detail.

## Where to go next

1. Finish **onboarding** if the app still prompts you.
2. Open **Settings** and complete **Profile**, **Business hours**, and **Payments** (Stripe Connect) if you take money online.
3. Use the **setup checklist** on **Home** to see what is left before you go live.

If you are stuck, use **Support** in the dashboard sidebar or open **Troubleshooting** in this help centre.
`.trim(),
    },
    {
      slug: 'dashboard-overview',
      title: 'Your dashboard at a glance',
      description: 'Home, navigation, admin vs staff, and how labels change with your booking model.',
      tags: ['dashboard', 'navigation', 'roles'],
      content: `
# Your dashboard at a glance

## Home

**Home** (\`/dashboard\`) shows today’s snapshot: bookings, alerts, and (for admins) a **setup checklist** so you can see what still needs configuration before guests book smoothly.

## Left sidebar

The sidebar lists what you can open in the app. Which links appear depends on:

- Your **role** (**Admin** sees Reports, Dining Availability, and full **Settings** (including the **Data Import** tab for CSV work); **Staff** see a shorter menu and **Account** instead of full Settings).
- Your **booking model** (for example table reservations only, or tables plus appointments).
- Your **plan** (Restaurant or Founding vs Appointments tiers).
- Whether **table management** is on (adds **Table Grid** and **Floor Plan**; **Day Sheet** may redirect when table management is on).

Labels such as **Bookings** vs **Appointments** and **New Booking** vs **New Appointment** update automatically based on what you have enabled.

## Your booking page

When your venue has a **slug**, the sidebar shows **Your Booking Page**: a direct link to the public URL guests use to book online. Share that link on your site, social bios, and printed materials.

## Support

Use **Support** in the dashboard to message the ReserveNI team from inside the app.
`.trim(),
    },
    {
      slug: 'business-profile',
      title: 'Setting up your business profile',
      description: 'Venue name, address, slug, timezone, imagery, and restaurant-specific fields.',
      tags: ['settings', 'profile', 'venue'],
      content: `
# Setting up your business profile

Go to **Settings → Profile** (admins).

## Core venue details

- **Venue name** and **contact details** (phone, email, website).
- **Address**: shown on your public page and used in communications.
- **Venue slug**: becomes your public URL (\`/book/your-slug\`). Choose something short and easy to spell. Changing it later breaks old links, so pick carefully.
- **Timezone**: used for reminders, availability, and what “today” means in the dashboard. Set this to match where you actually operate (UK and Ireland are supported; adjust if your trading hours do not match the default).

## Cover and branding

Upload a **cover image** where offered so your public booking page looks professional and matches your brand.

## Restaurant venues

You may also set **cuisine type**, **price band**, **kitchen email** (operational notifications), and **no-show grace** (how long you wait before treating a late guest as a no-show in the UI). Align these fields with your real house policy.

## Booking types (appointments plans)

On **Appointments** plans you can enable **extra** models (events, classes, resources) from the same profile area so guests see more tabs on your public page. Only enable what you actively sell.

## Booking rules

Depending on your model, **booking rules** (party sizes, notice windows, and similar) may sit under **Profile** or under **Dining Availability**. Use the **Restaurant plan** or **Appointments plan** articles in this help centre for your setup.
`.trim(),
    },
    {
      slug: 'stripe-payments',
      title: 'Connecting Stripe to take payments',
      description: 'Stripe Connect for guest charges vs your ReserveNI subscription.',
      tags: ['stripe', 'payments', 'deposits'],
      content: `
# Connecting Stripe to take payments

There are **two** separate Stripe relationships in ReserveNI. They are easy to mix up, so it helps to know both:

## 1. Your ReserveNI subscription

Under **Settings → Plan** you pay for **ReserveNI itself** (your product subscription). That billing is separate from money your guests pay for bookings.

## 2. Stripe Connect (guest payments)

Under **Settings → Payments**, connect **Stripe Connect** so you can take **deposits** and **online payments** from guests. Onboarding is step by step: business details, bank account, and identity checks if Stripe asks for them.

Until Connect is **ready and enabled**, guests may not be able to pay online even if you have turned on deposits in your rules.

### Tips

- Use a **business** Stripe account that matches the legal entity that should receive guest money.
- If Connect shows **restricted** or **pending**, open the Stripe Dashboard from the in-app links and supply anything Stripe requests.
- Only **admins** can complete Connect; staff will see guidance to ask an admin.

After Connect works, configure **deposit rules** in dining or service settings (see **Deposits** in your plan’s help section).
`.trim(),
    },
    {
      slug: 'public-booking-page',
      title: 'Your public booking page and QR code',
      description: 'How guests book online, tabs for multiple models, embed, and QR from Settings → Widget.',
      tags: ['public', 'embed', 'widget', 'qr'],
      content: `
# Your public booking page and QR code

Guests book at **\`/book/{your-venue-slug}\`**. On some appointment setups they can also use **\`/book/{slug}/{practitioner-slug}\`** to land on a specific calendar.

## What guests see

- Your **branding**, address, phone, and **opening hours** when those are configured.
- If **online booking is paused**, a clear message to contact you by phone or other means.
- If you run **more than one booking type** (for example tables **and** events), **tabs** so they can switch between experiences.

## Dining areas (tables)

With **multiple dining areas**, you choose whether guests pick an area **themselves** or you **merge** availability in the background. Configure that where you manage dining areas and public booking mode.

## Widget and QR

Under **Settings → Widget** (admin):

- Copy the **iframe embed** snippet to put booking on your own website. An optional **accent** colour query string tints buttons and highlights.
- Download a **QR code** that opens your **full booking page** (not the embed URL). Use it on menus, posters, and at reception.

## Source tracking

Bookings created through the embed are tracked so you can see **widget** as a source in reports. That helps you measure marketing and website performance.
`.trim(),
    },
    {
      slug: 'setup-checklist',
      title: 'Completing your setup checklist',
      description: 'The checklist on Home tracks profile, availability, Stripe, first booking, and more.',
      tags: ['checklist', 'onboarding', 'home'],
      content: `
# Completing your setup checklist

On **Home**, admins see a **setup checklist** that tracks practical readiness:

- **Profile** complete (business details, slug, imagery as required).
- **Availability** configured so guests see real bookable slots.
- **Guest booking ready**: the app checks that rules, Stripe (if needed), and your catalogue line up so online booking can work.
- **Stripe Connect** connected when you expect guests to pay online.
- **First booking** (optional milestone).
- Extra prompts if you use **events**, **classes**, or **resources** so those catalogues are not empty.

## Dismissal

You can dismiss the card for the current browser session when steps are done; it also respects completion flags from the server.

## If something stays incomplete

Open each linked area (**Settings**, **Dining Availability**, **Calendar Availability**, **Services**, and so on) and fix the highlighted gap. Typical causes are missing hours, incomplete Connect, or no services or sittings yet.
`.trim(),
    },
  ],
};
