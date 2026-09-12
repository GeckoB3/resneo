import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: "availability-in-the-app",
  title: "Hours, breaks, leave and blocks in the app",
  description: "The four tabs of Availability Settings on your phone: Calendars, Availability, Breaks and Closures & amended hours, plus planned hours, rotas and where one-off blocks live now.",
  tags: ["app","mobile","availability","working hours","breaks","leave","blocks","rota","calendars","amended hours","closures","tabs","availability settings","block time"],
  verified: '2026-09-12',
  content: `# Hours, breaks, leave and blocks in the app

Everything about when a calendar can take bookings lives on one screen in the app. Open **More**, then **Calendar availability**. The screen is headed **Availability Settings** and carries the same four tabs as the web dashboard:

**Calendars** · **Availability** · **Breaks** · **Closures & amended hours**

Admins land on **Calendars**. Everyone else lands on **Availability** and does not see the **Calendars** tab at all.

## Before you start

- Anyone on your team can open this screen, but you can only change hours, breaks and closures for the calendars linked to your own account. A colleague's calendar opens read only, with a line saying so.
- Admins can change every calendar.
- **Availability** and **Breaks** share one calendar picker, so whichever calendar you choose on one tab is the calendar you get on the other.
- Working hours are when a calendar *can* take bookings. A time is only bookable where it also falls inside your venue's opening hours, so to open earlier or later you have to widen **More**, then **Business hours**, as well. Save hours that fall outside your business hours and the app tells you which days, rather than refusing the save.
- **One-off blocks are not on this screen any more.** Block a slot from the **Calendar** tab, where the time is. See the section near the end.

## The Availability tab: weekly working hours

Pick the calendar at the top, then edit the week underneath. Everything is on the tab itself; there is no sheet to open.

1. Each of the seven days has a switch. Turn a day on to open it; turn it off and it reads **Closed**.
2. Set the start and end time for the day. Your venue's hours for that day are shown just underneath, and turn amber with a warning if you set hours outside them.
3. Tap **+ Add split** to add a second period on the same day, for a morning and an afternoon with a gap between. Each extra period gets a **Remove** button.
4. Tap **Copy to other open days** to give every other open day the same hours.
5. Tap **Save Working Hours**.

If narrowing the hours would leave bookings you have already taken outside them, the app does not just save. It asks **Save these hours anyway?** and tells you what falls outside. Tap **Save anyway** to go ahead, or close it and fix the bookings first.

A note headed **How calendar hours and business hours work together** sits on the tab, with a link through to **Business hours**.

## The Breaks tab: lunch and anything else that repeats

1. Check the calendar picker is on the right person.
2. Tap **+ Add** on a day and set the start and end time.
3. **Copy Monday to all days** gives every day Monday's breaks.
4. If you can change more than one calendar, an **Apply to all calendars** switch saves the same breaks to all of them at once. That is usually what you want for a shared lunch break.
5. Tap **Save breaks**.

> **Good to know:** breaks are not offered for a resource. To keep a resource free at the same time each day, add the break on the staff calendar it appears on.

## Plan hours ahead, and set a rota

Use this when hours change from a date in the future, or repeat on a pattern, without touching the weeks before it. It sits under **Plan hours ahead** on the **Availability** tab. (On a colleague's calendar it reads **View planned hours** and everything is read only.)

The sheet has three parts.

**The timeline.** The first row is always **Standard weekly hours**, which apply to every date no change covers. Under it sit the changes you have planned, each with **Edit** and **Remove**. **Remove** asks you to tap it a second time to confirm. Changes that have already ended move behind a **Show past changes** link.

**The planning calendar.** Below the timeline, a month calendar shows the bookable hours for each date: this calendar's hours inside your business hours and closures, minus days off and leave. Page back and forward through the months. Tap a day and the panel underneath says what its hours are and which rule sets them, then offers **Change hours from this week** and, where a planned change already applies, **Edit this change**.

**Adding a change.** Tap **Add a change from a date**, then:

1. Set **New hours from**. Changes always start on a Monday, so the app moves your date back to the Monday of that week.
2. Set **Weeks in the pattern**. Leave it at one for **Same hours every week**, or raise it for a rota. With more than one week you get a tab per week, and you fill in each week separately.
3. Fill in the weekly hours exactly as in step 1, splits and all.
4. Choose how long it **Runs**: **Until further notice**, for a set number of weeks or cycles, or **Until a date**. The app tells you which date the change ends on.
5. If the new change overlaps one you have already saved, an amber panel says exactly what saving will trim or drop.
6. Tap **Add to schedule** (or **Save changes** when you are editing one).

Admins with more than one calendar also get **Copy this schedule to other calendars** at the bottom. Switch on the calendars you want, then tap the copy button. It copies every change as saved, past changes included. Each calendar keeps its own standard weekly hours, breaks and days off.

## The Closures & amended hours tab: days off, or different hours

This tab takes one calendar out for a date or a range, or gives it different hours on those dates.

Chips at the top choose whose entries you are looking at. Admins may look at any calendar; a staff member sees their own. **All** shows everyone.

Tap **New entry**, or tap dates straight on the month grid to select a range and fill the form from there.

1. Choose the kind: **Closed** (all day, or a window each day) or **Working different hours** (open on these dates with these hours).
2. Set the dates.
3. For **Closed**, choose **All day** or **Time window**, then the start and end times. A time window blocks that window on every date in the range.
4. For **Working different hours**, set the periods for those dates. **Add another period** gives a break in the middle of the day.
5. Admins creating a new entry also get **Apply to all active calendars**, which saves the same dates on every column at once.
6. Add **Notes (optional)**, then tap **Add to calendar** (or **Save changes** when editing).

Entries appear under **Upcoming**, with anything finished behind **Past**. Tap one to edit or remove it.

Two rules worth knowing, the same as on the web: amended hours will not save on a date the calendar is closed all day, and if the amended hours fall outside your venue's hours, staff can still book them but guests cannot until you amend the venue's hours too.

> **Good to know:** closures cannot be saved against a resource, so resources are not offered in the picker.

## The team month grid

The month grid on the **Closures & amended hours** tab shows the whole team's time off a month at a time. Page through the months with the arrows, and read the legend for what each colour means.

Tap a day to see who is off. Tap a second day to build a range, then use the form that appears to add an entry with those dates already filled in. Tapping the same day again clears it.

## Blocking a one-off slot

Blocks live on the **Calendar** tab now, not on this screen, because that is where the time is.

1. Open the **Calendar** tab and find the slot.
2. Tap the empty slot and choose **Block time**.
3. Set the start and end times and add a **Reason (optional)**.
4. Save.

Tap the block again later to edit or remove it.

## The Calendars tab (admins only)

The first tab. Staff logins do not see it, and anyone who reaches it another way is sent to **Availability**.

Each calendar is a bookable column on your public page and in the app. Its card gives you:

- An **Active** or **Inactive** pill, and a **Bookable (Active)** switch to change it. An inactive calendar keeps its bookings but takes no new ones.
- Arrows to move the calendar up and down. The order here is the order of the columns on your calendar.
- **Name**, with a **Save name** button that appears once you change it.
- **Booking link**. Fill in **URL segment (optional)** with something like a staff member's name and tap **Save link** to give that calendar its own direct booking address. **Copy URL** copies it and **Open page** opens it. If your venue has no booking address yet, the card tells you to set one under **Settings**, then **Booking page**, on the web dashboard first.
- **On this calendar**, listing the services, classes, resources and events assigned to it. Tap **Edit assignments** to change them: tick the **Appointment services** guests can book on this column, the **Class types** that run on it, the **Resources on this column** and the **Ticketed events**, then tap **Save**.
- A bin icon to delete the calendar. It confirms first, and warns that staff linked to the column are unassigned and the practitioner on existing bookings may be cleared. Bookings themselves stay on the diary.

**Add calendar** at the bottom asks for a **Name** and adds it. A pill near the top shows your allowance, for example 3 / 5 on plan, or **Unlimited calendars**. When you have used them all, **Add calendar** disappears and an amber note explains your plan's limit. **Plan changes have to be made on the web dashboard, under Settings, then Plan.** The app never sells or changes a subscription.

If two resources on the same column offer overlapping slots, a **Conflict** pill and an amber **Resource availability overlap** note appear on that card, telling you what clashes.

> **Good to know:** if an older calendar has blocked dates saved in a retired field, admins see an amber **Legacy blocked dates** note at the top of **Availability**. Those dates still block bookings but cannot be edited here. Re-add them as closures under **Business hours**, or as time blocks, so they stay visible.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| A calendar says **View only** | It is not linked to your account | Ask an admin to change it, or to link the calendar to you |
| I cannot find **Block time** on this screen | Blocks moved to the **Calendar** tab | Open **Calendar**, tap the slot, then **Block time** |
| I set hours but the times still are not bookable | They fall outside your venue's opening hours | Widen **More**, then **Business hours** as well; the editor shows the venue's hours under each day |
| The save asked **Save these hours anyway?** | Narrowing the hours leaves bookings outside them | Read what falls outside, then either **Save anyway** or move those bookings first |
| **+ Add split** has gone from a day | There is no room left in that day for another period | Shorten the last period first |
| The save warned that hours fall outside business hours | The calendar is set to work when the venue is shut | Nothing is lost. Widen **More**, then **Business hours** for those days, or trim the calendar |
| The **Breaks** tab will not let me edit | The calendar picked is a resource, or is not yours | Pick your own calendar; for a resource, add the break on the staff calendar it appears on |
| I cannot choose a resource for a closure | Closures cannot be stored against a resource | Use the staff calendar, or change the resource's weekly hours |
| **Remove** did nothing | It arms first and needs a second tap | Tap **Tap to confirm** within a few seconds |
| A planned change starts on the wrong day | Changes always start on a Monday | The app moves your date back to that week's Monday; pick the following Monday if you meant later |
| No **Calendars** tab | You are signed in as staff, not an admin | Ask an admin |
| **Add calendar** is missing | Your plan's calendars are all in use | Deactivate one, or change your plan under **Settings**, then **Plan**, on the web dashboard |
| Nothing saves and a banner mentions being offline | Your phone has no connection | Reconnect and try again; the app does not queue changes |

## Next steps

- [Clients and contacts in the app](/help/resneo-app/clients-in-the-app)
- [Business hours and calendar hours](/help/getting-started/business-and-calendar-hours)
- [Working hours](/help/appointments/working-hours)
- [Setting up your calendars](/help/appointments/calendar-setup)`,
};
