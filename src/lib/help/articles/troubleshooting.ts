import type { HelpCategory } from '../types';
import { SMS_INCLUDED_APPOINTMENTS, SMS_INCLUDED_LIGHT, SMS_INCLUDED_PLUS } from '@/lib/billing/sms-allowance';
import { SMS_OVERAGE_GBP_PER_MESSAGE } from '@/lib/pricing-constants';

export const troubleshootingCategory: HelpCategory = {
  slug: 'troubleshooting',
  title: 'Troubleshooting',
  description:
    'Stripe Connect, SMS, availability, CSV imports, and access problems. What differs by Appointments vs Restaurant plans.',
  plan: 'all',
  articles: [
    {
      slug: 'stripe-issues',
      title: 'Stripe and payment problems',
      description: 'Connect onboarding, guest declines, subscription vs Connect, and embed quirks.',
      tags: ['stripe', 'payments', 'errors'],
      content: `
# Stripe and payment problems

## Guest card payments (Stripe Connect)

Guest money is charged on your **Stripe Connect** account (direct charges). Resneo never holds the deposit.

1. Open **Settings → Payments** and finish every Connect step (business details, bank account, then identity where Stripe asks).
2. If Stripe shows **restricted** or **pending requirements**, open the **Stripe Dashboard** from the links in app and clear every task.
3. When Connect is not **active**, the dashboard warns you and guests may be blocked from paying online.

## Guest checkout fails even though Connect looks fine

- Confirm the **booking** still exists and is in a state that allows payment (for example not already cancelled).
- Try another test card to rule out issuer declines (Stripe test cards in test mode).
- For **embedded** booking flows, check the browser is not blocking third party cookies or scripts aggressively.

## Wrong legal entity on Connect

Connect the **venue** that should receive funds. Changing entity later means going through Stripe disconnect and reconnect flows. Talk to **Support** (\`/dashboard/support\`) before doing that on a live venue with history.

## Resneo subscription vs Stripe Connect

These are separate:

- **Settings → Plan** is your **Resneo** subscription (Light, Plus, Pro, Restaurant, Founding Partner). If that is **past due** or fully ended, **dashboard writes** can be blocked and **public online booking** may be paused depending on tier (see the availability troubleshooting article).
- **Settings → Payments** is **Connect** for **guest** card charges.

Fix the side that matches the banner you see, then retest guest payment in a clean browser session.
`.trim(),
      markdownAppointments: `
# Stripe and payment problems (Appointments plans)

## Connect must be complete

On Appointments SKUs you still take guest card payments through **Stripe Connect** at **Settings → Payments**. The section walks through the same two step pattern (business and bank, then representative verification when required).

Until Connect reaches the **active** state shown in app, assume guests cannot complete card steps even if your **Resneo** subscription is healthy.

## Appointments Light and SMS meter (not Connect)

**Appointments Light** shows a banner under **Settings → Communications** when there is **no** Stripe subscription on file: you must add a card under **Settings → Plan** before SMS sends. Light includes **${SMS_INCLUDED_LIGHT}** segments per month, then **£0.06** overage per segment. That is separate from Connect, but teams often confuse the two when troubleshooting “nothing sends”.

## Guest payment failures

1. Open the booking in the dashboard and confirm status allows payment or capture.
2. If the guest used the **public** page or **embed**, retry outside strict privacy modes or another device.
3. For **deposits** or **full payment** rules, confirm the service or policy still matches what the guest selected.

## Subscription side effects on your dashboard

When **Plan** is **past due**, **venue write APIs** are blocked for every tier, so you may not be able to save changes until billing is fixed in the Stripe Customer Portal (**Manage Billing** on **Settings → Plan**).

**Public** online booking is only auto paused for **Light + past_due** and for venues whose subscription has **fully ended** (cancelled with no remaining paid period). **Plus** and **Pro** can still show the public page while past due, but you should treat past due as urgent because staff workflows that mutate data will fail.

## Still stuck

Use **Support** from the sidebar (\`/dashboard/support\`) with the booking id, approximate time, and whether the failure was on **Plan**, **Connect**, or **guest checkout**.
`.trim(),
      markdownRestaurant: `
# Stripe and payment problems (Restaurant and Founding Partner)

## Connect for guest charges

**Restaurant** and **Founding Partner** venues use the same **Settings → Payments** Connect onboarding as other plans. Complete Stripe tasks until the in app state reads **active**.

## Table service and deposits

Deposits and card captures still run on your **connected** account. If **Reports** deposit totals look wrong, first confirm bookings reached the expected payment state, then review Stripe payout and charge logs for the same window.

## Availability engine vs Connect

A **503** style response from \`/api/booking/availability\` with text about **no active dining service** means dining configuration, not card rails. Fix **Dining Availability** (\`/dashboard/availability\`) services before debugging Stripe again.

## Subscription vs Connect

**Settings → Plan** covers your **Resneo** subscription. **Past due** blocks **dashboard mutations** for all tiers. **Public** booking is paused when the subscription has **fully ended** (and for **Appointments Light** combined with **past due**, which is not your tier, but listed here so you understand mixed documentation if you ever downgrade test venues).

## Wrong account or reconnect

Reconnecting Connect on a busy production venue needs care. Use **Support** (\`/dashboard/support\`) before disconnecting accounts with live guest history.
`.trim(),
    },
    {
      slug: 'sms-issues',
      title: 'SMS messages not sending',
      description: 'Light card banner, template toggles, allowances, overage, and where to read errors.',
      tags: ['sms', 'twilio', 'communications'],
      content: `
# SMS messages not sending

## 1. Template lane and channel toggles

Open **Settings → Communications**. Choose the correct **lane** when more than one exists, then each **message card**. Ensure **SMS** is enabled for the events you expect (booking created, reminders, and so on).

## 2. Guest phone numbers

SMS needs a normalised **mobile** number. Missing or invalid numbers simply skip SMS for that guest while email may still send.

## 3. Appointments Light and billing

On **Appointments Light**, if Stripe shows **no** subscription yet, Communications displays a banner: you must add a card under **Settings → Plan** before outbound SMS is allowed. Once billing is active, Light includes **${SMS_INCLUDED_LIGHT}** SMS segments per month with **£0.06** overage beyond that.

## 4. Included bundles and overage

**Light**, **Plus**, and **Pro** (and Restaurant tiers) use included monthly segments with metered **overage** billed per segment at **£0.06** beyond the bundle unless you are on complimentary access (then sends stop at the allowance).

## 5. Read the booking timeline

Open the booking and inspect the **communication** timeline. Failed sends usually surface provider style error text there.

## 6. Escalate with context

Contact **Support** (\`/dashboard/support\`) with venue id, booking id, timestamp, and which template lane you were testing.
`.trim(),
      markdownAppointments: `
# SMS not sending (Appointments plans)

## Communications toggles

Go to **Settings → Communications**:

1. Pick the right **lane** (appointments vs other bundles when both exist).
2. For each **message card**, confirm **SMS** is checked for the lifecycle events you care about.
3. Watch the auto save indicator; if it errors, fix the underlying field and retry.

## Phone numbers on the guest profile

Outbound SMS needs a valid mobile on the guest record. Email may still deliver when SMS cannot.

## Appointments Light card requirement

On **Appointments Light**, if Stripe has **no** subscription yet, the blue banner at the top of Communications explains that you must add a card under **Settings → Plan** before SMS sends. Once active, Light includes **${SMS_INCLUDED_LIGHT}** segments per month with **£0.06** overage beyond that. This is independent of Stripe Connect for guests.

## Light, Plus, and Pro allowances

**Light** includes **${SMS_INCLUDED_LIGHT}** SMS segments per month; **Plus** includes **${SMS_INCLUDED_PLUS}**; **Appointments Pro** includes **${SMS_INCLUDED_APPOINTMENTS}**, with **£0.06** per extra segment unless you are on complimentary access (then sends stop at the cap). The **Plan** tab shows used versus included and a progress bar.

## Light with a subscription

Once Light has a Stripe subscription, SMS can send and meter. Usage may follow the **Stripe billing period** (the Plan tab notes when that applies).

## Diagnose from a booking

Open the booking detail sheet and read the **timeline** for the message attempt. Copy any error string into your Support ticket.

## Plan past due

When **Plan** is **past due**, **dashboard mutations** are blocked for **all** tiers, so you might not be able to save Communications changes until **Manage Billing** fixes the card. **Public** booking pause rules differ by tier; SMS saving is still tied to that mutation guard.
`.trim(),
      markdownRestaurant: `
# SMS not sending (Restaurant and Founding Partner)

## Communications

**Settings → Communications** uses the same lane and per message **SMS** toggles as on Appointments venues. Enable SMS only where you intend to text guests.

## Allowances

Restaurant tiers use the bundled SMS model with **£0.06** overage per segment beyond the included monthly count (see **Settings → Plan** for live figures). **Complimentary** venues cap sends without paid overage.

## Light banner does not apply

The **Appointments Light** “add a card before SMS” banner only appears for venues on that tier. Standard **Restaurant** and **Founding** tiers will not see that exact banner.

## Phone numbers and templates

Confirm the guest record has a mobile and that the relevant template still has **SMS** checked.

## Booking timeline

Inspect the booking **communication** timeline for failure reasons before escalating.

## Past due subscription

**Past due** blocks saving many venue settings, including Communications, until billing is repaired in the Stripe portal. Fix **Plan** first, then retest SMS.
`.trim(),
    },
    {
      slug: 'availability-issues',
      title: 'Slots not showing or calendar gaps',
      description: 'Hours vs calendars, services, dining engine, closures, and subscription paused booking.',
      tags: ['availability', 'slots', 'calendar'],
      content: `
# Slots not showing or calendar gaps

## Two different “hours” concepts

**Settings → Business hours** sets venue wide opening and weekly defaults. **Calendar Availability** at \`/dashboard/calendar-availability\` sets per calendar working hours, breaks, and similar for schedule backed models. If calendar hours are narrower than venue hours, online slots shrink.

## Services must attach to working calendars

For unified scheduling, each **service** needs to be linked to calendar columns that are actually **open** on the day you test. A practitioner on **leave** or a calendar with no working hours that day produces empty grids.

## Buffers, duration, and variants

Long **buffers**, long **durations**, or **variant** rules can remove most apparent slots. Temporarily reduce buffers in the service editor to confirm that was the cause.

## Closures and exceptions

**Settings → Business hours → Closures & special days** edits venue wide blocks. Restaurant tiers can add **Reduced capacity** for table bookings. Always check the test date for overlapping blocks.

## Dining tables need the service engine

When the primary model is **table_reservation** and the venue uses the **service** availability engine, \`/api/booking/availability\` returns **503** with a message that you need at least one **active dining service** under **Dining Availability** (\`/dashboard/availability\`). Until that exists, guests see no slots even if opening hours look fine.

## Public booking paused by billing

The public page shows **Online booking unavailable** when billing rules block public booking APIs: **Appointments Light** while **Plan** is **past_due**, or **any** tier once the subscription has **fully ended** (cancelled with no remaining paid access).

Complimentary venues from superuser free billing are **not** blocked here. Fixing **Settings → Plan** (card, resubscribe, or invoice) clears the pause when the underlying status updates.

## Overlapping rules

If a single calendar column mixes conflicting weekly patterns, simplify to one clear pattern, save, then reload the public page.
`.trim(),
      markdownAppointments: `
# Slots not showing (Appointments plans)

## Calendar Availability vs Business hours

1. **Settings → Business hours** controls venue wide weekly hours and **Closures & special days** (closures and amended hours on Appointments tiers).
2. **Calendar Availability** (\`/dashboard/calendar-availability\`) configures each **bookable calendar** column: weekly pattern, breaks, and per calendar logic.

If guests see blank days, compare both screens for the same weekday.

## Services and calendars

In **Appointment services** (\`/dashboard/appointment-services\`), each bookable service must reference calendars that are open on the test date. Staff assigned only to one column will not create slots on another.

## Buffers, duration, min notice

Service level **buffers**, **durations**, **min notice**, and online booking windows can all remove slots that look “missing”. Reduce buffers temporarily to prove the hypothesis, then tune properly.

## Venue exceptions

Use **Closures & special days** for bank holidays. Do not forget multi day ranges: a closure that spans your test weekend blocks everything inside it.

## Subscription paused public booking

Guests see **Online booking unavailable** when:

- You are on **Appointments Light** and **Plan** status is **past_due**, or
- **Plan** is **cancelled** with no remaining paid access window.

**Plus** and **Pro** still show **past_due** problems inside the dashboard (mutations blocked) but **public** booking uses the rules above, so Light teams hit public pause sooner. Always read the **Plan** tab and Stripe portal together.

## API errors while testing

If the browser network tab shows **403** with **Online booking is temporarily unavailable for this venue**, that is the same subscription guard, not a slot math bug.

## Hybrid venues (tables plus schedule)

If your venue also enables table booking, you may need **Dining Availability** in addition to calendar tools. See Restaurant troubleshooting for the dining service engine message.
`.trim(),
      markdownRestaurant: `
# Slots not showing (Restaurant and Founding Partner)

## Dining service engine requirement

Table venues using the **service** availability engine must maintain at least one **active dining service** under **Dining Availability** (\`/dashboard/availability\`). If the API returns **No active dining service is configured**, guests will never see slots until services exist, regardless of **Business hours**.

## Opening hours and closures

**Settings → Business hours** still sets the weekly template. **Closures & special days** adds **Reduced capacity** blocks in addition to closures and amended hours. Reduced capacity only affects **table** bookings.

## Areas and party size

When multiple **dining areas** are enabled, confirm the guest UI is using the intended area and that **party size** is within configured limits merged from restrictions.

## Calendar add ons

If **Calendar Availability** appears because you run classes, events, or unified scheduling alongside tables, treat schedule gaps separately from dining gaps. Each model has its own routes and editors.

## Public booking paused

Guests see **Online booking unavailable** when the subscription has fully ended (cancelled without a remaining paid period). **Restaurant** tiers are not subject to the **Light + past_due** public pause rule, but **past_due** still blocks **dashboard** mutations until billing is fixed.

## Turn times and capacity

Fixed interval dining with **turn times** can make late slots look unavailable because spanning slots consume multiple intervals. Inspect capacity in **Dining Availability** tools and the booking grid.

## Still empty

After services, hours, closures, and billing checks, capture the exact date, party size, area, and any **503** message text, then open **Support** (\`/dashboard/support\`).
`.trim(),
    },
    {
      slug: 'import-issues',
      title: 'Data import problems',
      description: 'Validation, mapping, the 24 hour undo window, partial runs, and Support bundles.',
      tags: ['import', 'csv', 'errors'],
      content: `
# Data import problems

## Validation step errors

Open **Settings → Data import** (\`/dashboard/import\`), run **Validate** on your CSV, and read each row error. Typical fixes: date formats, missing required emails, illegal status strings, wrong phone country codes.

## Column mapping

Map each source column to the correct Resneo field. Double check **timezone** interpretation for datetime columns if your export was generated in UTC.

## Execute and partial success

If **Execute** finishes with **failed**, read the session summary and download the **report CSV**. Often some rows still imported while others were skipped.

## Undo window

Successful imports keep **Undo** available until **24 hours** after completion (the import hub shows the exact local timestamp). After that moment, **Undo** is rejected and you must correct data manually or run a compensating import. Contact **Support** (\`/dashboard/support\`) before attempting large manual deletes you are unsure about.

## What to send Support

Attach the import **report CSV** and a small redacted sample of the source file, plus the session id shown in the hub.
`.trim(),
      markdownAppointments: `
# Data import problems (Appointments plans)

## Same importer, schedule heavy CSVs

Appointments venues often import **clients** and **bookings** that reference services or calendars. Validation will fail if practitioner or service ids from the old system do not map cleanly to Resneo ids. Use the mapper UI carefully.

## Validate before execute

1. Upload the CSV.
2. Complete mapping.
3. Run **Validate** and fix every reported row. Re-upload if needed.

## Undo within 24 hours

After **Execute** reaches **complete**, you can tap **Undo** from the import hub until **24 hours** elapse. The hub lists the exact deadline. After that time, undo is no longer available; plan manual cleanup or a follow up import.

## Failed sessions

Statuses such as **failed** still expose a **report CSV** when the job wrote one. Download it before you start a new session so you can compare row counts.

## Staff cannot access imports

Only **admins** see **Settings → Data import**. Staff must ask an admin to run or undo imports.

## Support

Use **Support** (\`/dashboard/support\`) with the session id from \`/dashboard/import\` and attach the report CSV.
`.trim(),
      markdownRestaurant: `
# Data import problems (Restaurant and Founding Partner)

## Table bookings in CSVs

Restaurant imports often need table or area identifiers to line up with your current floor plan. Treat validation errors about unknown tables seriously; importing anyway can attach bookings to the wrong capacity.

## Validate, execute, report

The flow matches Appointments venues: **Validate**, fix rows, **Execute**, then read the **report CSV** for skipped lines or warnings.

## 24 hour undo

Completed imports keep **Undo** available until **24 hours** after completion. After that, use manual tools or a carefully planned second import.

## Admin only

**Data import** remains under **Settings** for **admins** only.

## Support

Send **Support** (\`/dashboard/support\`) the session id, report CSV, and a redacted sample of the source export.
`.trim(),
    },
    {
      slug: 'access-issues',
      title: 'Login, staff access and permissions',
      description: 'Password reset, admin vs staff routes, onboarding, session timeout, and subscription locks.',
      tags: ['login', 'access', 'auth'],
      content: `
# Login, staff access, and permissions

## Password reset

From \`/login\`, use the password reset flow and check spam folders for Supabase auth mail.

## Staff versus admin

- **Admins** see **Reports**, full **Settings** tabs, and **Dining Availability** when your tier includes it.
- **Staff** use the same base URL for **Account** (\`/dashboard/settings\` shows only personal fields) and cannot open admin only routes (the app redirects or hides items).

## Session timeout

Admins configure optional **session timeout** under **Settings → Staff**. Shared tablets will log users out after idle time; signing back in is expected.

## Subscription locks

When **Plan** is **past_due** or the subscription has **fully ended**, many **venue mutation APIs** return errors. Staff may think permissions broke when billing actually needs attention on **Settings → Plan**.

## Onboarding loops

If you are repeatedly sent to **onboarding**, finish each required step. If a step looks complete but the router still loops, contact **Support** (\`/dashboard/support\`) with the venue id.

## Superuser routes

Internal **superuser** tools under \`/super\` are not the venue dashboard. Venue staff should live under \`/dashboard\`.
`.trim(),
      markdownAppointments: `
# Access issues (Appointments plans)

## Staff expectations

**Staff** can use **Contacts**, booking calendars, and operational tools, but visiting \`/dashboard/settings\` only shows **Account** fields. **Reports**, **Data import**, and venue **Settings** tabs are **admin** only.

If someone needs those areas, promote them to **admin** under **Settings → Staff** (subject to your **team login** cap on Light or Plus).

## Password and email

Use the public **login** page reset link. Ask an admin to verify the staff email on the invite if mail never arrives.

## Session timeout

Configured in **Settings → Staff** for the whole team. Increase the timeout if legitimate work is interrupted on front desk tablets.

## Past due blocks writes

**Past due** subscription status blocks **POST**, **PUT**, **PATCH**, and **DELETE** on \`/api/venue/*\` (except billing exempt paths). Symptom: buttons error even though the user is an admin. Fix **Manage Billing** on **Settings → Plan**, then retry.

## Public booking pause

**Light + past_due** and **fully expired** subscriptions set the public booking pause flag. Guests see **Online booking unavailable**. This is billing, not a staff permission toggle.

## Support

\`/dashboard/support\` from the sidebar is the right escalation when access looks wrong after billing is healthy.
`.trim(),
      markdownRestaurant: `
# Access issues (Restaurant and Founding Partner)

## Roles

**Admins** manage **Dining Availability**, **Reports**, imports, communications, and Connect. **Staff** take bookings and use **Account** settings only on \`/dashboard/settings\`.

## Password reset

Same **login** page flow as other plans.

## Session timeout

Use **Settings → Staff** to tune logout behaviour for shared hardware on the floor.

## Past due

**Past due** still blocks **venue mutation APIs** for Restaurant tiers until Stripe billing is healthy. Unlike **Appointments Light**, **past_due** alone does not trigger the **public** booking pause helper, but you should still treat it as blocking because staff cannot save fixes.

## Fully expired subscription

When access ends, public booking pauses and admins must **Resubscribe** from **Settings → Plan**.

## Floor plan access

Table layout tools live under **Dining Availability**, not under staff **Account** pages.

## Support

Use \`/dashboard/support\` with screenshots of any unexpected **403** responses from dashboard saves.
`.trim(),
    },
  ],
};
