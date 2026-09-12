import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: 'business-and-calendar-hours',
  helpSection: 'gs-set-up',
  verified: '2026-09-12',
  title: 'Business & calendar hours',
  description: 'How your venue’s opening hours and each calendar’s own hours work together to decide when guests can book, plus breaks, closures, and one-off changes.',
  tags: ['hours', 'opening hours', 'availability', 'closures', 'breaks', 'calendar', 'closed', 'holiday'],
  content: `# Business & calendar hours

Your hours decide exactly which times clients can book. There are two layers: when your business is open, and when each person or room is available inside those hours.

> **The one big idea:** your business hours are the outer boundary. Each calendar's own working hours sit inside them. A client can only book when both agree, minus any breaks and closures.

:::help-figure hours-stack

## Before you start

- Sign in as an **admin**. Business hours, venue closures and adding calendars are admin only. Team members can open **Calendar Availability**, but can only change the calendars linked to their own login.
- Add a calendar for every person or chair that takes bookings first. Hours are set per calendar, so with no calendar there is nothing to set hours on.
- Check what your plan allows: **Appointments Light** includes one bookable calendar, **Appointments Plus** up to five, **Appointments Pro** unlimited. A two-chair shop needs at least Plus. See **Settings**, then **Plan**.

## Step 1: Set your business opening hours

Open **Settings** from the sidebar, then the **Business hours** tab.

:::help-figure business-hours-screen

1. Find the **Weekly opening hours** card.
2. Tick the box beside each day you trade. Unticked days are closed.
3. For each ticked day, set the opening and closing time. A newly ticked day starts at 09:00 to 17:00.
4. Same hours most days? Set one day, then click **Copy to other open days** on that row. Closed days stay closed.
5. Need a midday gap, such as closing 15:00 to 17:00? Click **+ Add period** under that day and set the second window. Click **Remove** beside a period to take it away again.
6. Click **Save opening hours**.

> **Good to know:** if some upcoming bookings already sit outside your new hours, ResNeo asks "Save these hours anyway?". Saving keeps those bookings. It only stops new ones being made outside the hours.

> **Good to know:** ResNeo also checks your business hours against your calendars' hours whenever you save, on either screen, and tells you when they disagree, naming the calendars and days. It never refuses the save and never trims anything. Guests can only book inside your business hours, so treat it as a nudge to widen these hours or trim that calendar.

## Step 2: Set each calendar's working hours

Open **Calendar Availability** from the sidebar. The page heading reads **Availability Settings**, and the weekly hours live on its **Availability** tab. Same screen, three names.

:::help-figure availability-tabs

1. Admins add calendars on the **Calendars** tab. Team members do not see that tab.
2. Go to the **Availability** tab and pick a person or room from the **Calendar** dropdown.
3. Tick each day this person works. Unticked days are days off, so a barber who never works Mondays simply stays unticked.
4. For each ticked day, set the start and finish time. Newly ticked days start at 09:00 to 17:00, so change them to suit. Under each day you will also see your venue's hours for that day (**Venue:**), with a warning if the calendar's hours fall outside them, because that extra time is not bookable.
5. If most days are the same, set one day, then click **Copy to other open days**. Days off are left alone.
6. Splitting a day, in at 9, out for the afternoon, back at 5? Click **+ Add split** on that day and set the second window.
7. Click **Save Working Hours**.

> **Warning: every new calendar starts wide open.** A calendar added after your initial setup begins at 09:00 to 22:00, every day, as a placeholder. Your business hours will trim it, but if you have not set business hours it goes on sale exactly as it stands. Always set real working hours on a new calendar before you share your link.

> **Good to know:** team members can view anyone's hours, but can only edit calendars linked to their own login. Other calendars show as view only. Saving hours that leave upcoming bookings outside them asks "Save these hours anyway?" and keeps those bookings.

## Step 3: Add breaks

Breaks are the regular gaps inside a working day, such as lunch. Clients cannot book during a break.

1. On **Calendar Availability**, open the **Breaks** tab.
2. Pick the calendar from the **Calendar** dropdown.
3. On the day's row, click **+ Add break**. A new break starts as 12:00 to 13:00, so change the times to suit. Add more than one on a day if you need to, and click **Remove** to take one away.
4. Repeating the same lunch every day? Set Monday, then click **Copy Monday to all days**.
5. Click **Save breaks**. If you look after more than one calendar, **Save to all calendars** writes the same breaks to every one of them. It asks you to confirm first, because it replaces their existing breaks.

> **Good to know:** breaks are not available for a resource such as a room. Set the hours a room can be booked on the **Availability** tab instead, and add the break to the staff calendar the room appears on.

## Step 4: Close for a day or a holiday

Closures are one-off dates for the whole business.

:::help-figure closures-form

1. Open **Settings**, then the **Business hours** tab, and find the **Closures & special days** card (headed **Closures, Amended Hours & Capacity** inside).
2. Click the first date on the calendar, then the last date, to select a range. One click selects a single day, and clicking that day again clears it. You can also type the **Start date** and **End date** in the **New Block** form below the calendar.
3. Choose a **Type**: **Closure** or **Amended Hours**.
4. Add a **Reason (optional)** so your team knows why.
5. Click **Add to Calendar**.

Your two options behave very differently:

- **Closure**: closed. Leave **Start time (optional, for partial-day)** and **End time (optional)** blank to close the whole day, or fill both in to close just that window.
- **Amended Hours**: open, but on different hours. Enter **Period 1 open** and **Period 1 close**, and fill in **Period 2 open (optional)** and **Period 2 close (optional)** for a split day.

> **Good to know:** leave the times blank and a **Closure** shuts the whole day. Fill them in and it closes just that window, so bookings either side of it stay available. To change the hours you trade rather than close a gap, use **Amended Hours**: closing at 15:00 on Christmas Eve means an Amended Hours entry with Period 1 of 09:00 to 15:00.

Saved entries appear under **Upcoming**. Click one to change it, then click **Save Changes**, or **Delete** to remove it. Dates that have passed move under **Past blocks**.

> **Warning:** closing a date stops new bookings only. If bookings already sit in that period, ResNeo asks "Add this closure anyway?". Saying yes keeps them in your diary, and nobody is told. Open your **Calendar** for those dates and move or cancel each booking yourself, so clients hear it from you.

:::help-figure two-closures

## Taking one person off, not the whole business

If one barber is on holiday but the shop is open, do not use a venue closure. Add a calendar closure instead.

1. Open **Calendar Availability** from the sidebar, then the **Closures & amended hours** tab. The panel is headed **Calendar closures and amended hours**.
2. Admins pick the person or room from the **Calendar** dropdown. Team members see their own calendar.
3. Click the first day they are away, then the last day, or type the **Start date** and **End date** in the **New entry** form.
4. Leave **Closed** selected. Leave **Start time (optional)** and **End time (optional)** blank to block the whole day, or fill both in to block just that window on every date in the range.
5. Pick a **Label (optional)**: **Closed**, **Unavailable** or **Other**. Your calendar shows it on the shaded band, and **Other** reads "On leave". Add a note under **Notes (optional)**, such as "Annual leave".
6. Admins can tick **Apply to all active calendars** to put the same dates and times on every active calendar at once.
7. Click **Add to calendar**.

Everyone else stays bookable as normal. The entry appears under **Upcoming**, marked **All day** or **Part day**. Click it, or its date on the calendar, to edit it, then **Save changes** or **Delete**.

> **Warning:** unlike a venue closure, a calendar closure will not save over an existing booking. If that person already has a booking in the range, you will see a message naming the calendar and the date that ends "Move or cancel it before marking the calendar unavailable." Deal with the booking in your **Calendar** first, then add the closure.

## Giving one person different hours on a date

The same panel does the opposite of a closure. If one stylist wants to work a Saturday they normally have off, or stay late for one evening, do not change their weekly hours.

1. On the **Closures & amended hours** tab, select the date or range on the calendar.
2. Choose **Working different hours**, then enter the **Open** and **Close** times. These replace the calendar's usual hours on those dates only.
3. Add a note if you like, then click **Add to calendar**. The entry appears under **Upcoming** marked **Amended hours**.

Your business hours are still the outer boundary: if the venue is closed that day, or closes earlier, the form tells you, and guests cannot book the extra time until you amend the venue's hours for that date too (see above). A closure on the same date wins, so remove it first if there is one.

## Plan your hours ahead, or work a rotating pattern

Changing the weekly hours above changes every date at once. To change hours from a date in the future, or to work a pattern that rotates week by week (say Monday, Tuesday and Saturday morning one week and Tuesday to Friday the next), add a change to the schedule instead. Dates before it keep the hours they have.

1. On **Calendar Availability**, open the **Availability** tab and pick the calendar. Scroll below the weekly hours to **Plan your hours ahead**.
2. Click **Add a change from a date**. Or pick a day on the planning calendar and click **Change hours from this week** in the panel beside it.
3. Set **New hours from**. Changes always start on a Monday, so any other date snaps back to the Monday of that week. The exact day is shown underneath.
4. Choose a **Pattern**: **Same hours every week**, or a **2-week rota** up to a **6-week rota**. With a rota, use the **Week 1**, **Week 2** tabs to set each week's hours. Every week starts as a copy of the standard weekly hours.
5. Under **Runs**, choose **Until further notice**, **For** a number of weeks (cycles, for a rota), or **Until** a date. The end date is shown as you choose, and always falls at the end of a week.
6. Click **Add to schedule**. If the new change overlaps an earlier one, the form says so first under **Saving will adjust what it overlaps**: the earlier change is shortened, moved, split or replaced.

The list under **Plan your hours ahead** shows the changes running now or still to come, each with **Edit** and **Remove**. Removing a change sends those dates back to the standard weekly hours. A change that has ended stays on the planning calendar and moves behind a link that reads **Show 1 past change**, **Show 2 past changes** and so on.

The planning calendar below the list shows the bookable hours on any date, as far back or as far ahead as you like: this calendar's hours inside your business hours and closures, minus days off and leave, tinted by the change that sets them. Pick a day to see which rule applies, then use **Change hours from this week** or **Edit this change** from there. Breaks, days off and closures still apply during a change.

To give the same schedule to other calendars, admins tick them under **Copy this schedule to other calendars** and click **Copy to 2 calendars** (the button counts the calendars you ticked). Each calendar keeps its own standard weekly hours, breaks and days off.

> **Good to know:** a resource such as a room has weekly hours only, with no **Plan your hours ahead** section. Each calendar keeps up to 50 changes; when the list is full, the form tells you which old change it will drop before you save.

## Check it worked

1. Open **Settings**, then **Booking Page**, and click **Open booking page in a new tab**.
2. Pick a service and look at the next two weeks. Days you are closed should show no times, and your first and last slots should match what you just set.
3. If a day looks wrong, check that day on both screens: **Settings**, then **Business hours**, and then that calendar's **Availability** tab. The planning calendar under **Plan your hours ahead** shows the bookable hours for any date and says which rule sets them.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| No times at all on my booking page | The calendar has no working hours, or it is switched off | Set hours on the **Availability** tab, and check **Active (bookable)** on the calendar under the **Calendars** tab |
| Times stop earlier than the calendar's hours | The calendar's hours run past your business hours | Widen your hours under **Settings**, then **Business hours**. The **Venue:** note under each day on the **Availability** tab flags time that is not bookable |
| A whole day vanished when I only meant to close part of it | You saved the **Closure** with both times blank, which closes all day | Click it under **Upcoming**, set the start and end of the window you meant to close, then click **Save Changes** |
| Clients still have bookings on a day I closed | Venue closures only stop new bookings | Open your **Calendar** for that date and move or cancel each one yourself |
| A calendar closure will not save | That person already has a booking in the range | Move or cancel the booking in your **Calendar**, then add the closure again |
| A new calendar is taking bookings at odd hours | New calendars start at 09:00 to 22:00, seven days | Set its real working hours on the **Availability** tab |
| Amended hours will not save | One or both Period 1 boxes are empty, so you see **At least one open period is required for amended hours.** | Fill in both **Period 1 open** and **Period 1 close** |
| **Add to Calendar** is greyed out | No dates are selected | Click a start and end date on the calendar, or type the **Start date** and **End date** |
| My new hours start on the wrong day | Schedule changes always start on a Monday | Check the date shown under **New hours from**: it is the Monday of the week you picked |
| A team member cannot edit their hours | Their login is not linked to that calendar | An admin links it under **Settings**, then **Staff**, under **Calendars they manage**, or edits the hours for them |

## Next steps

- [Set up your services](/help/getting-started/services)
- [Add and manage your team](/help/getting-started/staff)
- [Your public booking page and embed](/help/getting-started/public-booking-page)`,
};
