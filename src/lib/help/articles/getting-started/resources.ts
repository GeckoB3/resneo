import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: "resources",
  helpSection: "gs-catalogue",
  title: "Set up bookable resources",
  description: "Add your rooms, courts, studios, or equipment as bookable resources, then set their hours, prices, and rules so clients can reserve them.",
  tags: ["resources","rooms","courts","equipment","slots","availability","pricing","bookings"],
  verified: '2026-09-06',
  content: `# Set up bookable resources

Got a treatment room, a wash station, a hire chair, a studio, or a piece of kit that clients book by the hour? This page shows you how to add one, set how long it can be booked, price it, and choose when clients can reserve it. Each resource sits on your calendar alongside the rest of your schedule.

> **The one big idea:** a resource is only bookable when it is **Active (bookable by guests)**, it is shown on a calendar column, and its weekly hours sit inside both your venue opening hours and that calendar's hours. Miss any one of those and clients see no times at all.

## Before you start

1. **Turn resources on first.** Open **Settings**, then the **Booking Settings** tab, and find the **Booking models** card. Tick **Resources & facilities**. Your choice saves on its own a moment later. Until you do, there is no **Resources** row in your sidebar. See [optional booking features](/help/getting-started/optional-booking-features).
2. **Know which calendar column it will sit on.** Every resource needs one.
3. **Connect Stripe** if you want a deposit, a full payment, or a card on file. See [connect Stripe to take payments](/help/getting-started/stripe-payments).
4. Sign in as an **admin** to manage every resource. Team members can only manage resources on calendars they control, and they need at least one calendar assigned to them before they can create any.

## Step 1: Add the resource

1. Open **Resources** from the sidebar. The page is headed **Resource timeline**.
2. Click **+ Add resource**. The form opens with six numbered steps.
3. Under **Basics**, fill in **Resource name**, for example "Treatment room 1". This one is required.
4. Add a **Type**, such as "Meeting Room" or "Studio". It is only a label for clients and changes no rules or pricing. Tap one of the quick picks to fill it in.
5. Add a **Description** if you want. It appears under the resource name when clients choose it.
6. Add a **Photo URL** if you want clients to see a picture. This is a web address, not an upload, and you get a preview once you paste a link.

:::help-figure resources-editor

## Step 2: Put it on a calendar

Under **Team calendar**, pick a column in **Show on calendar**. This one is required. A resource with no column has nowhere to appear and will not save.

If you are an admin and need a new column, click **Add calendar**, type a **New calendar name**, and click **Create and select**. It is made and selected for you straight away, and you can fine-tune its hours later under **Calendar Availability**.

> **Good to know:** resources themselves do not count against your plan's calendar limit, but the team calendar column you put them on does. Once your plan's calendars are used up, **Add calendar** is replaced by a message about your plan.

> **Sharing a column?** Two resources can share one calendar column only if their weekly hours never overlap.

## Step 3: Set the booking rules

Under **Booking rules**:

1. **Start times every (minutes)** decides how often a booking can begin, from 5 to 480 minutes. Start times step forward by this many minutes from the beginning of each open period, so 60 means on the hour only and 30 means on the hour and at half past. It is not a gap after a booking: if a booking ends between grid times, that gap can sit empty until the next allowed start.
2. **Longest booking (minutes)** is the most a client can book in one go, from 15 to 1440 minutes.
3. **Shortest booking (minutes)** matches your start-time step on its own. Tick **Advanced: longer minimum than start-time step** only when you want a finer grid but a longer minimum, for example start every 15 minutes but book at least 60. It accepts 15 to 480 minutes and can never be shorter than the start-time step. Whatever you set, the lengths clients can choose count up from here in steps of your start-time step.

Then set **Guest online booking**, which controls what clients can do for themselves:

- **Max advance (days)**: how far ahead they can book, 1 to 365.
- **Min notice (hours)**: how close to the start time they can still book, 0 to 168.
- **Cancellation notice (hours)**: how late they can cancel, 0 to 168.
- **Allow same-day bookings**: on by default. Untick it to stop clients booking today online. You can still book them in yourself.

:::help-figure resources-slots

## Step 4: Price it

Under **Pricing & payment**:

1. Enter a price. The field is named after your grid, for example **Price per 30-minute step (£)**. Leave it blank to make the resource free. Clients are charged per step, so a 90-minute booking on a 30-minute step costs three times this amount.
2. Choose how clients pay: **Pay at venue**, **Deposit online**, **Pay in full**, or **Card hold**.
3. With **Deposit online**, set **Deposit amount (£)**. It must be more than zero and no more than the most a single booking could cost. The balance can be paid at your venue.
4. With **Card hold**, set a **No-show fee (£)** of at least £1. No payment is taken when the client books. Their card is stored securely and you charge the fee only if you mark the booking as a no-show.
5. Tick **Active (bookable by guests)**. This checkbox lives at the bottom of this step, not at the end of the form.

> **Warning:** the editor only warns you when no Stripe account is connected at all. Once you have started Stripe setup the warning goes quiet, even if your account cannot take charges yet. Finish every step under **Settings**, then **Payments**, including **Complete identity verification**, before you switch a resource to **Deposit online**, **Pay in full**, or **Card hold**. Otherwise clients hit a payment error at the last step and no booking is made.

## Step 5: Set weekly hours

**Weekly hours** starts a brand new resource wide open: every day, 09:00 to 22:00. Narrow it to match how you actually trade, because clients can only book where the resource's hours, your venue opening hours, and the host calendar's hours all overlap.

1. Untick any day you do not open, then set the times on the days you do.
2. Click **+ Add period** for a split day, such as 09:00–12:00 and 14:00–18:00.
3. Click **Copy to other open days** on a day to push its times to every other open day.
4. Or click **Match selected calendar hours** to follow the calendar column you chose in step 2. Editing any day by hand switches it back off.

If your hours reach outside the calendar you picked, you get a note saying the resource will only be bookable when venue, calendar, and resource hours all allow it.

Finally, click **Create resource** (or **Save changes** when you are editing one).

## Step 6: Close it for a day

Under **Date exceptions**, tap a day on the calendar to start a range, then tap another day to end it, or use **Apply to calendar selection** for a single day. A range can cover up to 366 days. Choose **Closed (not open)** for a full closure, or **Amended hours (custom times)** to trade different hours that day, for example while a room is being decorated.

## Book a resource yourself

You do not have to wait for a client. On the **Appointment Calendar**, click an empty slot on the column the resource sits on. The menu lists **New appointment** and **Walk-in**, then a **Resources** heading with a **Book [resource name]** button for each resource on that column. That opens the **Book resource** window with the date and time already filled in.

## What your clients see

On your public booking page, the resources tab walks clients through **Book a resource**, then **How long?**, then **Choose a start time**, then **Review your booking**, then payment if you ask for it, and finally their confirmation with a booking reference.

## Check and change a resource later

Pick any resource from the **All resources** list to see it at a glance: **Start-time step**, **Shortest booking**, **Longest booking**, the price per step, and **Guest payment**, followed by **Weekly availability**, its date exceptions, and a **Bookings** panel you can step through day by day. Use **Edit** to change it, or **Delete** to remove it. **Delete this resource?** asks you to confirm and cannot be undone. If the resource still has upcoming bookings, deleting is blocked until you deal with those first.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| There is no **Resources** row in my sidebar | The resources booking model is off | Open **Settings**, then **Booking Settings**, and tick **Resources & facilities** |
| Clients see no times at all | It is not **Active (bookable by guests)**, or its weekly hours sit outside your venue or calendar hours | Turn on **Active (bookable by guests)** and check all three sets of hours line up |
| Bookings appear on the timeline but not the calendar | The resource has no host column, so you see **Not visible on team calendar** | Click **Set host calendar** and choose a column under **Show on calendar** |
| I cannot save: the deposit is too high | The deposit is more than the most a single booking could cost | Lower the deposit, or raise the price or **Longest booking (minutes)** |
| I chose deposit or full payment and it will not save | There is no price to take a percentage of | Set a price per step first, then choose the payment option |
| I cannot save the booking rules | A value is outside its allowed range, or shortest is longer than longest | Check the message and adjust the numbers it names |
| Two resources clash on one column | Their weekly hours overlap | Give one its own column, or change the hours so they do not overlap |
| **Add calendar** is missing | You have used every calendar your plan allows | Upgrade under **Settings**, then **Plan** |
| I cannot create resources at all | You are not an admin and have no calendar assigned to you | Ask an admin to assign you at least one calendar |

## Next steps

- [Business & calendar hours](/help/getting-started/business-and-calendar-hours)
- [Using the calendar](/help/getting-started/calendar)
- [Connect Stripe to take payments](/help/getting-started/stripe-payments)`,
};
