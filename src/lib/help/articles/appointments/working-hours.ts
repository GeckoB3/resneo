import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: 'working-hours',
  helpSection: 'setup',
  title: 'Working hours, breaks, and closures',
  description:
    'The Availability, Breaks and Closures & amended hours tabs in detail: weekly hours per calendar, recurring breaks, one-off closures, planned hours and rotas, and how they sit inside your business hours.',
  tags: ['hours', 'breaks', 'closures', 'rota', 'availability', 'venue'],
  verified: '2026-09-12',
  content: `
# Keep your availability trustworthy

Hours are set **per calendar**, so each person or room can be different. This article is the detailed reference for the three hours tabs on **Calendar Availability**. For a gentler walkthrough, start with [Business & calendar hours](/help/getting-started/business-and-calendar-hours).

**Who can do this:** admins can change every calendar. Team members can change only the calendars linked to their own login, and can look at the rest.

**What this covers:** the **Availability**, **Breaks** and **Closures & amended hours** tabs, planned hours and rotas, and how all of it sits inside **Settings → Business hours**.

:::help-figure availability-tabs

## How the layers fit together

A time is offered to a guest only when every layer agrees:

1. **Your business hours** are the outer boundary, set once for the whole venue under **Settings → Business hours**.
2. **The calendar's own working hours** sit inside them. Hours you set wider than your business hours are simply not bookable, and days your venue is closed stay closed here too. If you have not set business hours at all, the calendar hours apply on their own.
3. **Breaks** take regular gaps out of a working day, such as lunch.
4. **Closures & amended hours** take out one-off dates, or give one calendar different hours on them. Whole-venue closures live under Settings.
5. **The service's own rules** then decide which of the remaining slots a guest actually sees, through **Min booking notice (hours)** and **Max advance (days)** on the service. See [Services](/help/appointments/services).

You will see this spelled out on screen too: the **Availability** tab opens with a note headed **How calendar hours and business hours work together**.

ResNeo also checks the two against each other whenever you save, on either screen, and says so rather than refusing. Save calendar hours that run outside your business hours and you get a line naming the days, such as "Hannah's hours on Monday and Tuesday run outside your business hours (Monday: calendar 08:00 to 20:00, business 09:00 to 17:00). Guests can only book within business hours, so widen your business hours for those days too." Narrow your business hours under a calendar and the same advice appears there, naming the calendars instead. Nothing is clamped: staff can still book the extra time, guests cannot.

## The Calendar picker

**Availability**, **Breaks** and **Closures & amended hours** all work on one calendar at a time. Pick it from the **Calendar** dropdown at the top of the tab. Admins see every calendar, including resources on the hours tabs. A team member who opens a calendar that is not theirs sees "View only" instead of the save button.

If a tab says "Add calendars first to set their schedule", you have no calendars yet. See [Creating and assigning bookable calendars](/help/appointments/calendar-setup).

## The Availability tab: weekly hours

This is the standard week, and it applies to every date that a planned change does not cover.

1. Tick each day this calendar works. Unticked days are days off. A day you have just ticked starts at 09:00 to 17:00.
2. Set the start and finish time for each ticked day.
3. Under each day you also see **Venue:** and your business hours for that weekday. When the calendar runs outside them, the line turns amber and adds "(hours outside this are not bookable)".
4. To repeat one day across the week, click **Copy to other open days** on that row. Days that are unticked are left alone.
5. For a split day, in at 9, out for the afternoon, back at 5, click **+ Add split** and set the second window. **Remove** takes a window away again, and the last window on a day cannot be removed: untick the day instead. When the final window already runs to the end of the day, ResNeo says so rather than offering another.
6. Click **Save Working Hours**. You will see "Working hours saved".

> **Good to know:** narrowing hours never cancels anything. If upcoming bookings would fall outside the new hours, ResNeo lists them and asks "Save these hours anyway?". Saying yes keeps those bookings and only stops new ones being taken outside the hours.

## Plan hours ahead, or work a rota

Changing the weekly hours above changes every date at once, past and future. To change hours from a date in the future, or to work a pattern that rotates week by week, use **Plan your hours ahead** underneath. Dates before the change keep the hours they have, and breaks, days off and closures still apply throughout.

- **Add a change from a date** opens the form. **New hours from** always starts on a Monday, so any other date snaps back to the Monday of that week, and the exact day is written underneath.
- **Pattern** is either **Same hours every week** or a rota of **2** to **6** weeks. With a rota you get **Week 1**, **Week 2** and so on as tabs, each starting as a copy of the standard weekly hours.
- **Runs** is **Until further notice**, **For** a number of weeks (cycles, with a rota), or **Until** a date. The end date is shown as you choose, and always falls at the end of a week.
- **Add to schedule** saves it. If the change overlaps one you already have, the form warns first under "Saving will adjust what it overlaps:" and says which earlier change is shortened or dropped.

Each change in the list has **Edit** and **Remove**. Removing one sends those dates back to the standard weekly hours. Changes that have ended move behind a link that reads **Show 1 past change**, **Show 2 past changes** and so on.

The planning calendar underneath shows the bookable hours on any date: this calendar's hours inside your business hours and closures, minus days off and leave. Pick a day and the panel beside it names the rule, either "Rule: standard weekly hours." or the change that covers it (with the week of the rota, where there is one), and adds a line when the date is a day off, leave, or a day your venue is closed. From there you can **Change hours from this week** or **Edit this change**.

Admins can also tick other calendars under **Copy this schedule to other calendars** and click **Copy to 2 calendars** (the button counts what you ticked). It copies every change as saved, past ones included. Each calendar keeps its own standard weekly hours, breaks and days off.

> **Good to know:** each calendar holds at most 50 changes, and the form tells you which old one it will drop before you save. Saving a schedule that leaves upcoming bookings outside it asks "Save this schedule anyway?", exactly like a weekly hours change.

## The Breaks tab

A break is a regular gap inside a working day when this calendar takes no bookings. Guests never see those times.

1. On the day's row, click **+ Add break**. It starts at 12:00 to 13:00, so change it to suit. Add as many as you need, and use **Remove** to take one away.
2. For the same break every day, set Monday first and click **Copy Monday to all days**.
3. A day with none reads "No breaks - bookable for the full working-hours window".
4. Click **Save breaks**.

If you look after more than one calendar, **Save to all calendars** appears beside it. It asks you to confirm first, because it replaces the breaks on every other calendar you manage with these ones.

## The Closures & amended hours tab: time off, or different hours, for one calendar

Use this when one person is away or one room is out of use, and the rest of the venue carries on as normal. The same panel also gives one calendar different hours on a date or a range: a longer day, a shorter day, or a day it does not normally work. The panel is headed **Calendar closures and amended hours**.

1. Click the first day on the calendar and then the last to select a range, or type the **Start date** and **End date** in the **New entry** form.
2. Choose **Closed** or **Working different hours** at the top of the form.
3. For **Closed**: leave **Start time (optional)** and **End time (optional)** blank to block the whole day, or fill both in to block just that window on every date in the range. Choose a **Label (optional)**: **Closed**, **Unavailable** or **Other**.
4. For **Working different hours**: enter the **Open** and **Close** times. These replace the calendar's usual hours on every date in the range, so they also open a day the calendar does not normally work. Use **Add another period** for a gap in the middle of the day. Breaks still apply.
5. Add a **Notes (optional)** line such as "Annual leave" or "Late opening for the fair".
6. Admins can tick **Apply to all active calendars** to put the same dates on every active column at once.
7. Click **Add to calendar**.

Saved entries appear under **Upcoming**, marked **All day**, **Part day** or **Amended hours**. Click one, or its date on the calendar, to edit it, then **Save changes** or **Delete**.

Two rules to know about amended hours:

- **A closure wins.** If the calendar is closed all day on any date in the range, the amended hours will not save; the message names the date. Remove the closure first, or shorten the range. A part-day closure inside the range stays blocked, and the form says so.
- **Your business hours still decide what guests see.** If the amended hours fall outside your venue's hours for that date, or your venue is closed that day, the form tells you. Staff can still book, but guests cannot until you also amend the venue's hours under **Settings → Business hours**.

If the new hours are shorter than the old ones and an upcoming booking would fall outside them, ResNeo lists the bookings and asks before saving. They stay in your diary either way.

> **Warning:** a calendar closure will not save on top of an existing booking. You get a message naming the calendar and the date, ending "Move or cancel it before marking the calendar unavailable." Sort the booking out on your **Calendar** first, then add the closure. This is stricter than a venue closure, which saves and leaves the bookings where they are.

If you see a **Legacy blocked dates** note on this tab, some calendars still carry dates from the older per-calendar days-off list. Those dates still block booking. Add anything new here, so full-day unavailability lives in one place.

## Closing the whole venue

Whole-venue closures and amended opening hours belong under **Settings → Business hours**, on the **Closures & special days** card. **Closure** shuts the day (or just a window, if you set times), and **Amended Hours** keeps you open on different hours. Full steps are in [Business & calendar hours](/help/getting-started/business-and-calendar-hours).

> **Warning:** a venue closure only stops new bookings. Anything already in the diary stays there and nobody is told, so open your **Calendar** for those dates and move or cancel each booking yourself.

## Resources work slightly differently

A room or piece of equipment added as a **resource** is a calendar too, and you set its bookable hours on the **Availability** tab like any other. Two things are not offered for it:

- **Breaks.** The tab explains this and points you at the hours instead. To keep a room free at the same time each day, add the break to the staff calendar the room appears on.
- **Plan your hours ahead.** A resource has weekly hours only.

Resources also do not appear on the **Closures & amended hours** tab. See [Resources](/help/appointments/resources).

## Who can change what

- Admins can change hours, breaks and closures on every calendar, and are the only ones who see **Apply to all active calendars** and the copy-to-other-calendars controls.
- Team members can change the calendars linked to their login and view the rest. Other calendars show a "View only" note in place of the save button.
- An admin links a login to a calendar under **Settings → Staff**, using **Calendars they manage**.

## Check it worked

1. Open **Settings → Booking Page** and click **Open booking page in a new tab**.
2. Pick a service and look across the next two weeks. Closed days should show no times, and the first and last slots should match what you set.
3. If a date looks wrong, go back to the **Availability** tab and pick that day on the planning calendar under **Plan your hours ahead**. It tells you the bookable hours for that date and which rule sets them.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| No times at all for one person | The calendar has no working hours, or it is switched off | Set hours on the **Availability** tab, and check **Active (bookable)** under the **Calendars** tab |
| Times stop earlier than the hours I set | The calendar's hours run outside your business hours | Widen them under **Settings → Business hours**. The amber **Venue:** line flags the time that is not bookable |
| A booking sits outside the hours I just saved | Narrowing hours keeps existing bookings on purpose | Move or cancel it on your **Calendar** if you no longer want it |
| Lunch is still bookable | The break is on the wrong calendar, or was not saved | Pick the right calendar, add the break, and click **Save breaks** |
| I cannot add a break to a room | Breaks are not available for resources | Set the room's hours on the **Availability** tab, or add the break to the staff calendar it appears on |
| A calendar closure will not save | That calendar already has a booking in the range | Move or cancel the booking on your **Calendar**, then add the closure again |
| My new hours start on the wrong day | Planned changes always start on a Monday | Check the date written under **New hours from**: it is the Monday of the week you picked |
| An old change disappeared when I saved a new one | The new change overlapped it | The form warns under "Saving will adjust what it overlaps:" before you save. Use **Edit** on a change instead of adding another |
| A day is blocked and I cannot see why | A day off, a calendar closure or a venue closure | Pick that day on the planning calendar under **Plan your hours ahead**. It names the reason |
| Amended hours will not save | The calendar is closed all day on a date in the range | Remove that closure on the **Closures & amended hours** tab first, or shorten the range |
| I amended a calendar's hours but guests cannot book them | The venue's business hours do not cover those hours, or the venue is closed that day | Amend the venue's hours for that date too, under **Settings → Business hours** |
| A team member cannot edit their own hours | Their login is not linked to that calendar | An admin links it under **Settings → Staff**, under **Calendars they manage** |
| Hours look an hour out | The venue timezone is wrong | Check **Timezone** under **Settings → Profile** |

## Next steps

- [Creating and assigning bookable calendars](/help/appointments/calendar-setup)
- [Business & calendar hours](/help/getting-started/business-and-calendar-hours)
- [Set up your services](/help/appointments/services)
- [Using the appointment calendar](/help/appointments/appointment-calendar)
- [When availability looks wrong](/help/troubleshooting/availability-issues)
`.trim(),
};
