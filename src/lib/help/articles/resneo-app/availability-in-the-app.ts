import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: "availability-in-the-app",
  title: "Hours, breaks, leave and blocks in the app",
  description: "Set weekly working hours, breaks, planned hours and rotas, block out time and book leave from your phone, plus the admin-only Calendars screen.",
  tags: ["app","mobile","availability","working hours","breaks","leave","blocks","rota","calendars"],
  verified: '2026-09-06',
  content: `# Hours, breaks, leave and blocks in the app

Everything about when a calendar can take bookings lives on one screen in the app. Open **More**, then **Calendar availability**, and you land on **Availability**.

## Before you start

- Anyone on your team can open this screen, but you can only change hours, breaks, leave and blocks for the calendars linked to your own account. A colleague's calendar reads as view only, with a line saying so.
- Admins can change every calendar, and only admins see the **Manage calendars** button in the top right.
- Working hours are when a calendar *can* take bookings. A time is only bookable where it also falls inside your venue's opening hours, so to open earlier or later you have to widen **More**, then **Business hours**, as well.
- If your venue has more than one calendar, a row of chips at the top filters the screen. **All** shows everything.

## Step 1: Set a calendar's weekly working hours

Under **Working hours**, each calendar has a row with its name and a plain-English summary of the week, for example Mon–Fri 09:00–17:00 · Sat 10:00–14:00. A calendar with nothing set says **No working hours set**.

1. Tap **Edit hours** on the calendar you want.
2. Each of the seven days has a switch. Turn a day on to open it; turn it off and it reads **Day off**.
3. Set the start and end time for the day. Your venue's hours for that day are shown just underneath, and turn amber with a warning if you set hours outside them.
4. Tap **+ Add split** to add a second period on the same day, for a morning and an afternoon with a gap between. Each extra period gets a **Remove** button.
5. Tap **Copy to other open days** to give every other open day the same hours.
6. Tap **Save hours**.

If narrowing the hours would leave bookings you have already taken outside them, the app does not just save. It asks **Save these hours anyway?** and tells you what falls outside. Tap **Save anyway** to go ahead, or close the sheet and fix the bookings first.

## Step 2: Add breaks

Breaks are lunch and anything else that repeats every week.

1. Tap **Edit breaks** on the calendar.
2. Tap **+ Add** on a day and set the start and end time.
3. **Copy Monday to all days** gives every day Monday's breaks.
4. If you can change more than one calendar, an **Apply to all calendars** switch saves the same breaks to all of them at once. That is usually what you want for a shared lunch break.
5. Tap **Save breaks**.

> **Good to know:** breaks are not offered for a resource. The line on a resource's row explains it: to keep a resource free at the same time each day, add the break on the staff calendar it appears on.

## Step 3: Plan hours ahead, and set a rota

Use this when hours change from a date in the future, or repeat on a pattern, without touching the weeks before it. Tap **Plan hours ahead** on a calendar. (On a colleague's calendar the button reads **View planned hours** and everything is read only.)

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

## Step 4: Block out a one-off slot

Under **Time off & blocks**, tap **Block time**.

1. Pick the calendar. Admins see a chip per calendar; if you are staff with one calendar, it is chosen for you.
2. Set the **Date**, then the **Start** and **End** times with the plus and minus buttons. They step in 15 minutes.
3. Add a **Reason (optional)**.
4. Tap **Save**.

Blocks for the next 90 days appear in the **Time blocks** card, each with **Edit** and **Remove**. **Remove** asks you to tap again to confirm.

## Step 5: Add leave

Leave covers whole days or several days at a time. Tap **Add leave**.

1. Admins creating new leave see **Apply to all practitioners** at the top. Turn it on for a venue-wide closure and the calendar picker disappears.
2. Otherwise pick the calendar.
3. Set **From** and **To**.
4. Choose the type: **Closed**, **Unavailable** or **Other**.
5. Choose **All day**, or **Time window** and then set **Window start** and **Window end** for part of a day.
6. Add **Notes (optional)** and tap **Save**.

Leave shows in the **Leave / Unavailability** card, upcoming first, with anything finished tucked behind a **Past** toggle. Each entry has **Edit** and **Remove**.

> **Good to know:** leave and blocks cannot be saved against a resource, so resources are not offered in either picker.

## The team leave calendar

The **Team leave** card between the buttons and the lists shows the whole team's time off a month at a time. Switch between **Calendar** and **List**, page through the months with the arrows, and read the legend for what each colour means.

Tap a day to see who is off. Tap a second day to build a range, then tap the **Add leave** button that appears to open the leave form with those dates already filled in. **Clear** drops the range, and tapping the same day again clears it too.

## Admin only: Manage calendars

Tap the calendar icon in the top right of **Availability** to open **Calendars**. Staff logins do not see it, and the screen says so if they reach it another way.

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
| I set hours but the times still are not bookable | They fall outside your venue's opening hours | Widen **More**, then **Business hours** as well; the editor shows the venue's hours under each day |
| The save asked **Save these hours anyway?** | Narrowing the hours leaves bookings outside them | Read what falls outside, then either **Save anyway** or move those bookings first |
| **+ Add split** has gone from a day | There is no room left in that day for another period | Shorten the last period first |
| **Edit breaks** is missing on a row | That row is a resource | Add the break on the staff calendar the resource appears on |
| I cannot choose a resource for leave or a block | Leave and blocks cannot be stored against a resource | Use the staff calendar, or change the resource's weekly hours |
| **Remove** did nothing | It arms first and needs a second tap | Tap **Tap to confirm** within a few seconds |
| A planned change starts on the wrong day | Changes always start on a Monday | The app moves your date back to that week's Monday; pick the following Monday if you meant later |
| No **Manage calendars** button | You are signed in as staff, not an admin | Ask an admin |
| **Add calendar** is missing | Your plan's calendars are all in use | Deactivate one, or change your plan under **Settings**, then **Plan**, on the web dashboard |
| Nothing saves and a banner mentions being offline | Your phone has no connection | Reconnect and try again; the app does not queue changes |

## Next steps

- [Clients and contacts in the app](/help/resneo-app/clients-in-the-app)
- [Business hours and calendar hours](/help/getting-started/business-and-calendar-hours)
- [Working hours](/help/appointments/working-hours)
- [Setting up your calendars](/help/appointments/calendar-setup)`,
};
