import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: 'resources',
  helpSection: 'operations',
  title: 'Resources and facilities',
  description:
    'Add rooms, courts, studios, or equipment as bookable resources, set the slot grid and price, control the hours three layers deep, and book them yourself from the calendar.',
  tags: ['resources', 'facilities', 'rooms', 'slots', 'availability', 'utilisation'],
  verified: '2026-09-06',
  content: `
# Resources and facilities

A resource is anything clients reserve by the hour rather than by service: a treatment room, a court, a hire chair, a studio, a piece of kit. Each one sits on a calendar column, keeps its own weekly hours, and is priced per slot.

**Who can do this:** admins manage every resource. A team member needs at least one calendar assigned before they can create anything, and can only manage resources whose host column they control. Only admins can add calendar columns.

**What this covers:** switching resources on, the six-step resource form, the three layers of hours, booking one yourself, and where resources appear elsewhere in ResNeo.

:::help-figure schedule-models

## Before you start

1. Switch resources on. Open **Settings → Booking Settings** and, in the **Booking models** card, tick **Resources & facilities**. Until you do there is no **Resources** row in the sidebar. Model links sit just after **Contacts**.
2. Decide which calendar column it will sit on. Every resource needs one, and it will not save without one.
3. Connect Stripe if you want a deposit, a full payment, or a card on file. See [Deposits, full payments, card holds, and refunds](/help/appointments/deposits).

Open **Resources** from the sidebar (\`/dashboard/resource-timeline\`). The page is headed **Resource timeline**, with **All resources** down the left and the selected resource on the right. A note at the top reminds you that resource bookings and free slots appear on the team calendar column you choose under **Show on calendar**.

## The resource form, step by step

Click **+ Add resource**. The form has six numbered steps and a sticky **Create resource** button (**Save changes** when editing).

**1. Basics.** **Resource name** is required. **Type** is a label only, with quick picks, and changes no rules or pricing. **Description** and **Photo URL** are optional; the photo is a web address, not an upload, and shows a **Preview** once it works.

**2. Team calendar.** Pick a column under **Show on calendar**. Admins can click **Add calendar**, type a **New calendar name** and **Create and select** to make one on the spot. Two resources can share a column only if their weekly hours never overlap; when they do, the calendar's card shows a **Conflict** pill.

**3. Booking rules.**

- **Start times every (minutes)**, 5 to 480, starting at 30. Start times step forward by this many minutes from the beginning of each open period, so 60 means on the hour only and 30 means on the hour and at half past. It is not a gap after a booking: when one ends between grid times, that gap can sit empty until the next allowed start.
- **Longest booking (minutes)**, 15 to 1440, starting at 180.
- **Shortest booking (minutes)** matches the start-time step on its own. Tick **Advanced: longer minimum than start-time step** only when you want a finer grid but a longer minimum, for example start every 15 minutes but book at least 60. It takes 15 to 480 minutes and can never be shorter than the step. Whatever you set, the lengths guests can choose count up from there in steps of the start-time step.
- **Guest online booking**: **Max advance (days)** (1 to 365), **Min notice (hours)** (0 to 168), **Cancellation notice (hours)** (0 to 168) and **Allow same-day bookings**, which is on by default. These govern guests only; you can still book anything yourself.

**4. Pricing & payment.** The price field is named after your grid, for example **Price per 30-minute step (£)**. Leave it blank to make the resource free. Guests are charged per step, so 90 minutes on a 30-minute step costs three times this amount. Then pick one of four cards:

- **Pay at venue**, no card required online
- **Deposit online**, with **Deposit amount (£)**, charged when the guest books, balance due at the venue
- **Pay in full**, charged at booking
- **Card hold**, which stores a card, takes nothing at booking, and charges the **No-show fee (£)** (at least £1) only if you mark the booking as a no-show

**Active (bookable by guests)** lives at the bottom of this step, not at the end of the form.

**5. Weekly hours.** A brand new resource starts wide open: every day, 09:00 to 22:00. Narrow it to how you actually trade. Use **+ Add period** for a split day, **Copy to other open days** to push one day's times across, or **Match selected calendar hours** to follow the column you chose in step 2 (editing a day by hand switches that back off).

**6. Date exceptions.** Tap a day on the calendar to start a range and another to end it, or use **Apply to calendar selection** for a single day. Choose **Closed (not open)** or **Amended hours (custom times)** with **From** and **To**. **Remove this day** clears one again.

## The three layers of hours

A guest can only book a slot where all three of these agree:

1. your venue opening hours (**Settings → Business hours**),
2. the host calendar column's working hours (**Calendar Availability**),
3. the resource's own **Weekly hours** and **Date exceptions**.

Set hours wider than the column allows and the form warns you that the resource will only be bookable where all three overlap. That warning is the usual answer to "the room is open but nobody can book it". See [Working hours, breaks, and closures](/help/appointments/working-hours).

## Checking a resource day to day

Pick a resource from **All resources**. The list row shows its calendar, its type, the price per slot and the payment rule, with a green dot when it is active.

The detail panel opens with **+ Book this resource**, an **Active** or **Inactive** pill, and **Edit** and **Delete**. Below that:

- Five tiles: **Start-time step**, **Shortest booking**, **Longest booking**, the price per step, and **Guest payment**.
- **Weekly availability**, one row per day, with **Closed** where you are shut, followed by any **Date exceptions**.
- **Bookings**, one day at a time. Use the arrows, the date box or **Today** to move around. Each row shows the start time, the guest, the finish time and the payment line, with a status pill. Click a row to open the full booking.

If the resource has no column you get a **Not visible on team calendar** warning and a **Set host calendar** button. Until you fix that, bookings only exist here on this page.

**Delete this resource?** warns that upcoming bookings cannot be removed this way and that the deletion cannot be undone. Resolve those bookings first if the delete is blocked. To take a resource off sale without losing anything, untick **Active (bookable by guests)** instead: it disappears from your public page immediately and existing bookings stay.

## Booking a resource yourself

Three routes, all the same window:

- **+ Book this resource** on the resource detail panel.
- On the **Calendar**, click an empty slot on the column the resource sits on. The menu lists **New appointment**, **Walk-in**, then a **Resources** heading with **Book** and the resource name for each one on that column. The **Book resource** window opens with the date and time already filled in.
- **New Booking** in the sidebar, on the **Resources** tab (\`/dashboard/bookings/new?tab=resource\`).

## Where resources appear elsewhere

- **Calendar.** On the day view, free slots appear as mint blocks under the host column and taken slots appear as bookings, so one glance shows what is still available.
- **Your public page.** Guests use the resources tab (\`?tab=resources\`) and walk through **Book a resource**, **How long?**, **Choose a start time**, **Review your booking**, payment if you ask for it, and a confirmation with a **Booking reference**.
- **Reports.** Under **Settings → Reports**, **Resource utilisation** shows each resource's percentage, a bar, and the count of bookings with booked hours against open hours for the date range, plus a CSV of Resource, Bookings, Utilisation %, Booked hours and Available hours. Only active (not cancelled) bookings count towards booked hours. Resources also appear in **By booking type**. The section only shows when there is data, and Reports are admin only.

## Calendar columns and plan limits

Resources themselves do not count against your plan's calendar limit, but the team calendar column each one sits on does.

- **Appointments Light** includes one bookable calendar, **Appointments Plus** up to five, **Appointments Pro** is unlimited. At the cap, **Add calendar** is replaced with a note naming your plan and linking to **Settings → Plan**.
- Because of that, sharing one column between several resources is normal on smaller plans. It is allowed as long as their weekly hours never overlap.
- A resource on a switched-off column cannot be booked, however active the resource itself is.

## Who can do what

| Action | Admin | Team member |
| --- | --- | --- |
| See every resource | Yes | Yes |
| Create a resource | Yes | With a calendar assigned, on a column they manage |
| Edit or delete a resource | Yes | Only on a column they manage |
| Book a resource for a client | Yes | Yes |
| Add a calendar column | Yes | No |
| See Reports | Yes | No |

Assign calendars under **Settings → Staff**; see [Team access, roles, and calendar links](/help/appointments/team-management).

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| There is no **Resources** row in the sidebar | The resources booking model is off | Tick **Resources & facilities** under **Settings → Booking Settings** |
| Guests see no times at all | It is not **Active (bookable by guests)**, or its hours fall outside your venue or column hours | Tick **Active (bookable by guests)** and line up all three sets of hours |
| Bookings show on this page but not the calendar | The resource has no host column, so you see **Not visible on team calendar** | Click **Set host calendar** and choose one under **Show on calendar** |
| The save says the deposit is too high | The deposit is more than the most a single booking could cost | Lower the deposit, or raise the price or **Longest booking (minutes)** |
| Deposit or full payment will not save | There is no price to take it from | Set a price per step first |
| The booking rules will not save | A value is outside its range, or shortest is longer than longest | Read the message and adjust the number it names |
| Two resources clash on one column | Their weekly hours overlap | Change one set of hours, or give one its own column |
| Guests hit a payment error at the last step | Stripe is started but charges are not enabled | Finish setup under **Settings → Payments**, including identity verification |
| A gap shows on the calendar but nobody can book it | The gap is shorter than the next allowed start on the grid | Lower **Start times every (minutes)**, or book it yourself |
| **Add calendar** is replaced by a message | You have used every calendar your plan allows | Switch an unused calendar off, or upgrade under **Settings → Plan** |
| Deleting the resource is blocked | It still has upcoming bookings | Resolve those bookings, or untick **Active (bookable by guests)** instead |
| I cannot create resources at all | You are not an admin and have no calendar assigned | Ask an admin to assign you at least one calendar |

## Next steps

- [Set up bookable resources](/help/getting-started/resources)
- [Creating and assigning bookable calendars](/help/appointments/calendar-setup)
- [Working hours, breaks, and closures](/help/appointments/working-hours)
- [Using the Appointment Calendar](/help/appointments/appointment-calendar)
- [Reports, exports, and the Clients directory](/help/appointments/reports)
`.trim(),
};
