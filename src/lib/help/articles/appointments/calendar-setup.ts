import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: 'calendar-setup',
  helpSection: 'setup',
  title: 'Creating and assigning bookable calendars',
  description:
    'Add calendars on the Calendars tab, choose what can be booked on each one, give them their own booking link, set the column order, and stay inside your plan limit.',
  tags: ['calendars', 'columns', 'booking link', 'entitlements', 'admin'],
  verified: '2026-09-12',
  content: `
# Bookable calendars (your columns)

A calendar is one bookable schedule: usually one person, one room, or one chair. It is a column on your **Calendar**, a choice for guests on your public booking page, and the thing that owns a set of working hours. Almost everything else in ResNeo hangs off one.

**Who can do this:** admins only. Team members do not see the **Calendars** tab at all. They land on **Availability** and can change only the calendars linked to their own login.

**What this covers:** adding a calendar, choosing what can be booked on it, its own booking link, the column order, pausing or removing one, and what your plan allows.

:::help-figure availability-tabs

## Before you start

- Check what your plan allows. **Appointments Light** includes one bookable calendar, **Appointments Plus** up to five, and **Appointments Pro** unlimited. Only calendars that are switched on count towards that, and rooms or equipment added as **resources** do not count at all.
- Have your services to hand if you can. You can tick them while you create the calendar, and you can always come back later. See [Services](/help/appointments/services).

## Step 1: Open the Calendars tab

1. Open **Calendar Availability** from the sidebar (\`/dashboard/calendar-availability\`). The page heading reads **Availability Settings**.
2. Stay on **Calendars**, the first of four tabs: **Calendars**, **Availability**, **Breaks** and **Closures & amended hours**.

The panel is headed **Calendars**, with a pill beside it showing either how many you are using, such as **3 / 5 on plan**, or **Unlimited calendars**.

## What a calendar represents

Each switched-on calendar becomes one column on your **Calendar** and one bookable schedule on your public page. Common patterns:

- One calendar per practitioner, so guests choose who they see.
- One calendar per room, chair or treatment bay, when it does not matter who serves them.
- A mix of the two, whatever matches how you actually work.

:::help-figure calendar-columns

## Step 2: Add a calendar

1. Click **Add calendar** at the top right of the **Calendars** panel.
2. Fill in **Display name**, for example a staff name or a room label. It is required, and guests can see it, so write it the way you would say it out loud.
3. Leave **Active (bookable)** switched on. Switch it off if you are setting the calendar up in advance.
4. Tick what can be booked on this column. Each list only appears when you have items of that kind:
   - **Appointment services**: the services guests can book here. The same service can sit on several columns. Leave it empty when this column is only for classes or resources.
   - **Class types**: the classes that run on this calendar.
   - **Resources on this column**: a resource has to sit on a calendar before anyone can book it. More than one is fine, as long as their weekly hours do not overlap.
   - **Ticketed events**: an event has to sit on a calendar to be bookable. You cannot take an event off a calendar while it has bookings, so cancel or resolve those first.
5. Click **Save**.

> **Good to know:** a class, a resource and a ticketed event can each sit on only one column at a time. Tick one that already belongs somewhere else and ResNeo asks first, naming both calendars, before it moves the item across. Services are the exception: they can sit on as many columns as you like.

> **Warning: a new calendar starts wide open.** Every calendar you add begins at 09:00 to 22:00, seven days a week, as a placeholder. Your business hours trim it, but set its real hours on the **Availability** tab before you share your booking link. See [Working hours, breaks and closures](/help/appointments/working-hours).

To change any of this later, click **Edit** on the calendar's row. The same form opens with **Edit calendar** at the top.

### Stopping a calendar offering a service

Untick a service under **Appointment services** and click **Save**. From that moment the calendar takes no new bookings for it, on your booking page or from your own staff.

If that service already has upcoming bookings on the calendar, ResNeo does not refuse the change. It lists every booking affected, with the date, the time and the client's name, and asks what should happen to them:

- **Leave them on this calendar.** They stay exactly as they are and go ahead as normal. Only new bookings stop.
- **Move them to another calendar.** Choose the calendar from the dropdown. Each booking keeps its date, its time and its length, so nobody is emailed and nothing is cancelled.

This is the way to retire a service on one chair or one room: stop the new bookings today, and let the ones in the diary run out.

Only calendars that are switched on and already offer the service can take the bookings, so the dropdown lists those. When no other calendar offers it, the only choice is to leave the bookings where they are. Add the service to another calendar first if you would rather move them.

If a booking cannot be moved, usually because the other calendar is already busy at that time, ResNeo names it and says why. Pick a different calendar for it, or leave it where it is and save.

## Step 3: Give a calendar its own booking link (optional)

Every calendar card has a **Booking link** strip along the bottom. It creates a direct link to that one person or room, alongside your main booking page.

1. Type a segment in the box after your venue address, usually the person's first name.
2. Click **Save**. Then use **Copy** to put the full link on your clipboard, or **Open page** to view it.
3. Use lowercase letters, numbers and hyphens only, up to 64 characters. Anything else is refused with "Use lowercase letters, numbers, and hyphens only."

Leave the box empty and the calendar simply has no direct link of its own. If you see "Set your venue slug under Venue details first", set your public booking address under **Settings → Booking Page**, then come back.

## What each calendar card shows

- **Active** or **Inactive** beside the name.
- **Conflict**, in amber, when two resources on the same column have overlapping weekly hours. The card then explains the overlap under **Resource availability overlap**, and tells you to adjust the weekly hours or move one of the resources.
- Four summary rows: **Services**, **Classes**, **Resources** and **Events**. A dash means nothing of that kind is assigned. Under **Events** you also see the date of each occurrence, and a switched-off event appears greyed with "paused" after it and the tooltip "Paused, not bookable".
- **Edit**, and a bin icon (**Delete calendar**) once you have more than one calendar.

## Step 4: Put the columns in the order you want

The columns on your **Calendar** appear in the same order as the rows here, so put the people your team looks at most on the left.

1. Drag the grip handle on the left of a row into place. On a phone, use the **Up** and **Down** buttons on the row instead.
2. The order saves on its own. You will see "Saving column order..." while it does.

You need to be an admin with more than one calendar for the handles to appear.

## Plan limits and upgrading

Only switched-on calendars count towards your limit, and resources never do.

- At your limit, the **Add calendar** button is not shown at all. In its place you get a note explaining the cap: on **Appointments Light** it points you to Plus or Pro, and on **Appointments Plus** it offers a choice of switching an existing calendar off or moving to Pro.
- Either way the note links to **Settings → Plan**, where **Calendar usage** shows the same figure.
- If ResNeo cannot fit another calendar at the moment you save, you see **Upgrade to add more calendars**, with your current usage and a **View plans & upgrade** button.

For what each tier costs and includes, see [Appointments Light, Plus, and Pro](/help/appointments/overview).

## Pausing a calendar, or removing it

**To pause one:** click **Edit**, switch **Active (bookable)** off and click **Save**. The card shows **Inactive**, the column disappears from your **Calendar**, guests can no longer book it, and it stops counting towards your plan limit. Nothing is deleted, so you can switch it back on whenever you like. This is the safe option whenever someone is on long leave or a room is out of use.

**To remove one for good:** click the bin icon on the row. ResNeo asks **Remove calendar?** and tells you exactly what happens: the calendar is removed, staff linked to that column are unassigned, existing bookings stay on the diary, and the practitioner on each booking may be cleared. Click **Remove calendar** to confirm, or **Cancel**.

> **Good to know:** you can never remove your last calendar, and the bin icon is hidden while you only have one. Resource calendars are removed from the **Resources** screen, not here.

## What team members see here

- The **Calendars** tab is hidden from anyone who is not an admin, so only you can add, edit, reorder or remove a calendar.
- Team members open the same page on **Availability**, with a note at the top: only their own calendar can be changed here, and admins can adjust everyone. They can still look at anyone's hours for reference.
- An admin decides which calendars a login can change under **Settings → Staff**, using **Calendars they manage** on that person's row. See [Team management](/help/appointments/team-management).

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| There is no **Add calendar** button | You are at your plan's calendar limit | Read the note in its place, switch an unused calendar off, or upgrade under **Settings → Plan** |
| I cannot see the **Calendars** tab at all | Your login is a team member, not an admin | Ask an admin to make the change, or to change your role under **Settings → Staff** |
| Saving the calendar says "Name is required" | **Display name** is empty | Type a name, then click **Save** again |
| A service does not appear for guests on this calendar | The service is not ticked under **Appointment services**, or the calendar is switched off | Click **Edit**, tick the service, and check **Active (bookable)** |
| Unticking a service opens a list of bookings | Those bookings are already in the diary for that service on this calendar | Leave them where they are, or move them to another calendar, then save. Nothing is cancelled either way, and **Cancel** puts the tick back |
| A booking left on a calendar that no longer offers its service | That is how it is meant to work: only new bookings stop | Nothing to do. It can still be dragged, resized and modified as normal |
| A booking would not move to another calendar | That calendar is already booked at the same time | Choose a different calendar for it, or leave it where it is and save |
| The move dropdown offers nowhere to go | No other calendar that is switched on offers that service | Tick the service on another calendar first, then come back |
| A room or piece of equipment cannot be booked | A resource has to sit on a calendar column | Click **Edit** on the calendar and tick it under **Resources on this column** |
| The card shows **Conflict** | Two resources on that column have overlapping weekly hours | Change one resource's hours, or move it to a different calendar |
| Ticking a class or event asks to move it | Classes, resources and events live on one column at a time | Confirm to move it, or cancel and pick a different calendar |
| The booking link will not save | The segment has spaces, capitals or symbols in it | Use lowercase letters, numbers and hyphens only, up to 64 characters |
| The booking link strip says to set a venue slug first | Your public booking address is not set yet | Set it under **Settings → Booking Page** |
| The bin icon is missing | This is your only calendar | Add another one first, or switch this one off instead |
| The new calendar is taking bookings at odd hours | New calendars start at 09:00 to 22:00, seven days | Set real hours on the **Availability** tab |

## Next steps

- [Working hours, breaks and closures](/help/appointments/working-hours)
- [Business & calendar hours](/help/getting-started/business-and-calendar-hours)
- [Set up your services](/help/appointments/services)
- [Using the appointment calendar](/help/appointments/appointment-calendar)
- [Team management](/help/appointments/team-management)
`.trim(),
};
