import type { HelpArticle } from '../../types';
import {
  APPOINTMENTS_LIGHT_PRICE,
  APPOINTMENTS_PLUS_PRICE,
  APPOINTMENTS_PRO_PRICE,
  SMS_OVERAGE_GBP_PER_MESSAGE,
} from '@/lib/pricing-constants';
import { SMS_INCLUDED_APPOINTMENTS, SMS_INCLUDED_LIGHT, SMS_INCLUDED_PLUS } from '@/lib/billing/sms-allowance';

export const article: HelpArticle = {
  slug: "welcome",
  helpSection: "gs-start-here",
  verified: '2026-09-06',
  title: "Welcome to ResNeo",
  description: "A friendly introduction to ResNeo and a clear path to taking your first booking.",
  tags: ["overview","introduction","getting started","first booking","setup","basics"],
  content: `# Welcome to ResNeo

ResNeo is the simple way to take and manage bookings for your appointments business. Your clients book themselves online, day or night, while ResNeo keeps your calendar tidy, sends the reminders, and (if you want) takes payment up front so you get fewer no-shows. This guide takes you from here to your very first booking.

:::help-figure welcome-what

> **The one big idea:** ResNeo calls your business a **venue**, so you will see that word on a few screens. It means your business, whether you are a single chair or a six-room clinic.

## Before you start

Have these to hand before you start:

- Your business name, address, and a phone number clients can call.
- Your opening hours for a normal week, and the hours each person works.
- A list of what you offer, with a length in minutes and a price for each. Ten services is plenty to start. You add these from the dashboard once the setup wizard is done.
- The names of anyone else who takes bookings, plus their email address if you want them to sign in.
- Your logo and a wide photo of your premises, if you have them. You can add these later.
- Your bank details, but only if you want clients to pay online.

## What ResNeo does for you

- **Takes bookings around the clock.** Clients choose a service and a time on your own booking page, even when you are closed.
- **Keeps your day organised.** Every booking lands on one clear calendar, so you always know what is next.
- **Cuts no-shows.** Automatic email and text reminders, plus optional deposits, keep clients turning up.
- **Looks professional.** A booking page with your name, logo, and colours, and tidy confirmation messages.
- **Gets you paid.** Take a deposit or full payment online when clients book, if you choose to.
- **Keeps clients coming back.** Every client's visit history, notes, and contact details live in one place.

## Your first sign-in: the setup wizard

The first time you sign in, ResNeo puts you straight into a short setup wizard. The dashboard does not open until it is finished, but your progress is saved each time you click **Continue**, so you can close the tab and pick up where you left off.

The wizard shows its steps as a progress bar across the top:

1. **Welcome**: a quick summary of what the wizard will ask for.
2. **Business Details**: your business name, address, and contact details.
3. **Opening Hours**: the hours your business is open in a normal week.
4. **Calendars**: one bookable column for each person, chair, or room. Light includes one calendar and Plus includes up to five.
5. **Calendar Availability**: when each calendar can take bookings. Clients only see a time slot when your opening hours and that calendar's working hours both allow it.
6. **Invite Your Team**: the email address and role of anyone else who needs to sign in. Light skips this step because it includes a single sign-in. If there is nobody to invite yet, leave it blank and click **Continue**.
7. **Your Dashboard**: a guided tour of where you will work every day.
8. **Review & Go Live**: a final summary, then a **Go to Dashboard** button.

The wizard does not ask for your services or your payment details. You add those from the dashboard afterwards, and the **What's next** card on **Home** reminds you of each one until it is done. Nothing you enter is permanent: every answer can be changed later in **Settings**.

> **Tip:** use **Back** to change an earlier step. Your entries stay on screen and are saved to your venue when you click **Continue**.

## How it works

You run everything from your **dashboard** once the wizard is done: your services, your calendar, your clients, and your settings. Clients never see the dashboard. They book on your **booking page**, which is a separate public web page with your name and branding on it.

Your booking page link, its QR code, and the code to embed it in your own website all live in one place. Open **Settings**, then **Booking Page**.

> **Tip:** click **Your Booking Page** in the sidebar any time to see exactly what your clients see. If you share a combined booking page with another venue, the sidebar shows a link ending in **(combined)** instead.

## Getting up and running

Once the wizard is done, work through these in order:

1. **Check your details.** Confirm your business name, address, and contact details in [your business profile](/help/getting-started/business-profile).
2. **Set your hours.** Confirm when you are open and when each person works in [business and calendar hours](/help/getting-started/business-and-calendar-hours).
3. **Build what you sell.** Add or refine your [services](/help/getting-started/services). A service only becomes bookable once it is **Active** and linked to a calendar that has working hours.
4. **Turn on payments (optional).** [Connect Stripe](/help/getting-started/stripe-payments) if you want clients to pay a deposit or in full when they book.
5. **Open your doors.** Share [your booking page](/help/getting-started/public-booking-page) and take your first booking.

:::help-figure welcome-steps

> **Good to know:** classes, ticketed events, and bookable resources each have their own sidebar link, and it only appears once that booking model is switched on. You may have chosen some at signup. To change them later, open **Settings**, then **Booking Settings**, and look for **Booking models**. See [set up your classes](/help/getting-started/classes), [set up ticketed events](/help/getting-started/events), and [set up bookable resources](/help/getting-started/resources).

> **You are not on your own.** If you are an admin, your **Home** screen shows a **What's next** card listing whatever setup is still outstanding. See [your go-live checklist](/help/getting-started/setup-checklist).

## Which plan do I need?

Your plan sets how many calendars you can run, how many people can sign in, and how many texts are included each month. In **Settings**, then **Plan**, the names appear in full as Appointments Light, Appointments Plus, and Appointments Pro.

| Plan | Price a month | Calendars | People who can sign in | Texts included |
| --- | --- | --- | --- | --- |
| Appointments Light | £${APPOINTMENTS_LIGHT_PRICE} | 1 | 1 | ${SMS_INCLUDED_LIGHT} |
| Appointments Plus | £${APPOINTMENTS_PLUS_PRICE} | Up to 5 | Up to 5 | ${SMS_INCLUDED_PLUS} |
| Appointments Pro | £${APPOINTMENTS_PRO_PRICE} | Unlimited | Unlimited | ${SMS_INCLUDED_APPOINTMENTS} |

One calendar means one bookable column, usually one person, one chair, or one room. A two-chair barbershop needs two calendars, so Light is not enough even if you are the only person who signs in. Texts beyond your allowance cost ${Math.round(SMS_OVERAGE_GBP_PER_MESSAGE * 100)}p each, and a long message can count as more than one text. On Light, texts only go out once you have a card on file: until then ResNeo sends the email and skips the text.

> **Good to know:** you start on a free trial. To see exactly where it stands, open **Settings**, then **Plan**. If a payment fails (or, on Light, your free period ends with no card on file), a red **Billing** strip appears across the top of your dashboard. While it shows, you cannot save changes in the dashboard on any plan. On Appointments Light your booking page also stops taking bookings straight away; on Plus and Pro it keeps taking bookings while you sort the payment out. If the subscription ends altogether, an amber **Subscription ended** strip appears and both editing and online booking pause on every plan until you click **Resubscribe**. Keep a card on file to avoid the interruption.

## Common questions

| Question | Answer |
| --- | --- |
| Do I have to take payments online? | No. It is completely optional. You can take bookings without it and handle payment in person. |
| Where do my clients book? | On your booking page. Share the link or QR code, or add it to your website. Click **Your Booking Page** in the sidebar to see it. |
| I only see **Account**, not **Settings**. Why? | You are signed in as a team member. Admins see the full **Settings**; team members see their own **Account**. See [add and manage your team](/help/getting-started/staff). |
| Can my team sign in too? | Yes, on Plus and Pro. Light includes a single sign-in. Add team members in **Settings**, then **Staff**. |
| Why does ResNeo say "guest" in places? | Guest and client mean the same thing here. Appointments venues usually say client, and a few shared screens still say guest. |
| Where do I get help later? | Use the **Support** link in the sidebar, or browse the rest of this Getting started guide. |

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| Signing in keeps sending me to a setup wizard | The wizard is not finished, and the dashboard stays locked until it is | Work through to **Review & Go Live** and click **Go to Dashboard**. Your answers are saved as you go |
| I cannot add a second calendar | You are on Light, which includes one calendar | Open **Settings**, then **Plan**, and move to Plus or Pro |
| My booking page shows nothing to book | No service is both **Active** and linked to a calendar with working hours | Open **Services** and check the service is **Active (visible to clients)** and offered on at least one calendar. Then check that calendar has working hours under **Calendar Availability** |
| My booking page has stopped taking bookings | The subscription ended or a payment failed | Open **Settings**, then **Plan**, and update your billing |

## Next steps

- [A tour of your dashboard](/help/getting-started/dashboard-overview)
- [Set up your services](/help/getting-started/services)
- [Your go-live checklist](/help/getting-started/setup-checklist)`,
};
