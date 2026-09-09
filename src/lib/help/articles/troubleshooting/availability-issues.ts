import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: 'availability-issues',
  title: 'Slots not showing or calendar gaps',
  description: 'Why your booking page offers no times: services without a calendar, the two sets of hours, closures, booking rules, and paused billing.',
  tags: ['availability', 'slots', 'calendar'],
  verified: '2026-09-06',
  content: `
# No times showing on your booking page

An empty booking page is almost never a fault. One of the rules below is closing the day. Work through them in order, testing the same date each time.

## 1. The service is not on any calendar

A service only produces times on the calendars you tick. Open **Services**, click **Edit** on the service, and check **Calendars that offer this service**. A service with none saves quite happily and offers nothing.

## 2. The calendar is switched off, or has no hours

Open **Calendar Availability**. On the **Calendars** tab, check **Active (bookable)** is ticked. A paused calendar is marked **Paused, not bookable**. Then on the **Availability** tab, pick that calendar and confirm the day is ticked with real start and finish times.

## 3. Your two sets of hours disagree

Bookable time is the overlap of your venue's opening hours and that calendar's own hours, minus breaks and closures.

- **Settings → Business hours**, the **Weekly opening hours** card: when the business is open.
- **Calendar Availability**, the **Availability** tab: when that person or room works.

A calendar that runs past your venue hours is trimmed, and the **Venue:** line under each day flags the time that is not bookable. Widen whichever of the two is the narrower.

## 4. A closure covers the date

Check both places. **Closures & special days** on **Settings → Business hours** closes the whole venue, and the **Closures & amended hours** tab on **Calendar Availability** takes one person or room off. Multi-day ranges are easy to miss, and a closure saved with both times blank closes the whole day rather than a window.

## 5. The service's own rules

Open the service and look at **Guest booking rules**. **Min booking notice (hours)** hides slots that are too soon, and **Max advance (days)** hides dates too far ahead. **Buffer (mins)** adds tidy-up time after every appointment, which is often enough to lose the last slot of the day. **Active (visible to clients)** must be ticked. The **When guests can book this service online** panel on the same form previews what a client would actually see.

## What your clients see, and what it means

- **No times available on** that date, with **Try a different date above**: one of the rules above closed the day.
- **We could not load times for** that date: a temporary problem on our side, not a full diary. Clients can click **Try again**.
- **Online booking unavailable**: billing, not availability. Public booking pauses when you are on **Appointments Light** and a payment to ResNeo has failed, or when a cancelled subscription has run out of paid time. **Plus** and **Pro** keep their public page while past due. Fix it under **Settings → Plan**. Bookings your own team makes still work throughout.

## Next steps

- [Business & calendar hours](/help/getting-started/business-and-calendar-hours)
- [Your public booking page and embed](/help/getting-started/public-booking-page)
- [Set up your services](/help/getting-started/services)
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
};
