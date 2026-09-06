import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: 'business-hours',
  title: 'Business hours and special closures',
  description: 'The Business hours tab: the weekly grid and its explicit save, and the closures form field by field.',
  tags: ['hours', 'closures', 'exceptions', 'amended hours', 'holiday'],
  verified: '2026-09-06',
  content: `
# Business hours and special closures

**Settings → Business hours** holds two cards: the week you normally trade, and the one-off dates when you do not.

These are venue-wide. Each person or room also has their own working hours under **Calendar Availability**, and a client can only book when both agree. For the full picture across both screens, see [Business & calendar hours](/help/getting-started/business-and-calendar-hours).

## Weekly opening hours

The first card is **Weekly opening hours**.

1. Tick the box beside each day you trade. An unticked day is closed, and its times disappear.
2. For each ticked day, set the opening and closing time. A day you have just ticked starts at 09:00 to 17:00.
3. Trading the same hours most days? Set one day, then click **Copy to other open days** on that row. Days you have left unticked stay closed.
4. Need a gap in the middle of the day, such as closing 15:00 to 17:00? Click **+ Add period** under that day and set the second window. **Remove** takes a period away again. You can add as many periods as fit in the day.
5. Click **Save opening hours**.

Nothing here saves on its own. The button sits in a strip at the bottom of the card so you can look over the whole week first. If the save fails, the reason appears in red under the grid.

> **Good to know:** if upcoming bookings already sit outside the hours you are about to save, ResNeo asks **"Save these hours anyway?"**. Saying yes keeps those bookings exactly where they are. New hours only stop new bookings being made.

> **Good to know:** the last period of a day cannot be removed, because an open day needs at least one. Untick the day instead. And if the last period already runs to the end of the day, **+ Add period** is replaced by a note saying there is no room for another one.

## Closures and special days

The second card is **Closures & special days**, headed **Closures, Amended Hours & Capacity** inside. The heading mentions capacity because table venues get a third option there; on an Appointments plan your **Type** list has two.

1. Click the first date on the month calendar, then the last, to select a range. One click selects a single day, and clicking that same day again clears it. Use the arrows either side of the month name to move to another month.
2. In the **New Block** form below, check **Start date** and **End date**. You can also type them straight in.
3. Choose a **Type**: **Closure** or **Amended Hours**.
4. Fill in the times for that type (below).
5. Add a **Reason (optional)**, such as "Bank Holiday" or "Staff training", so your team knows why.
6. Click **Add to Calendar**. **Clear Selection** starts the dates again.

### Closure

You are shut.

- Leave **Start time (optional, for partial-day)** and **End time (optional)** blank to close the whole day.
- Fill both in to close just that window. Bookings either side of it stay available. The form says the same thing under the two boxes.

### Amended Hours

You are open, but on different hours.

- Enter **Period 1 open** and **Period 1 close**. Both are needed, or the form refuses with **At least one open period is required for amended hours.**
- **Period 2 open (optional)** and **Period 2 close (optional)** add a second window for a split day.

Closing at 15:00 on Christmas Eve is an **Amended Hours** entry with Period 1 of 09:00 to 15:00, not a Closure.

## Changing or removing an entry

Saved entries appear under **Upcoming**, soonest first, each with a coloured **Closure** or **Amended Hours** pill, the dates, any times and the reason.

1. Click the entry. The form heading changes to **Edit Block** and the dates highlight on the calendar.
2. Change what you need, then click **Save Changes**.
3. **Delete** removes it. **Cancel** drops your changes and closes the form.

Dates that have passed move into **Past blocks**, a collapsible list with a small bin icon on each row. Removing an entry there asks **"Remove this block?"** first.

With nothing set up at all, the card reads **No closures, amended hours, or capacity blocks configured.**

## What a closure does not do

> **Warning: a venue closure stops new bookings only.** If clients are already booked in that period, ResNeo asks **"Add this closure anyway?"**. Saying yes keeps every one of those bookings in your diary, and nobody is told. Open your **Calendar** for those dates and move or cancel each booking yourself, so clients hear it from you.

This is the opposite of a **calendar closure**, which you add on **Calendar Availability** to take one person off while the rest of the venue carries on. A calendar closure refuses to save over an existing booking and tells you which calendar and date are in the way, so you have to deal with the booking first.

## Timezone

Closures and amended hours are read against your venue's **Timezone**, which lives on **Settings → Profile** with the rest of your business details. Set that correctly before you rely on hours that run late at night.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| My hours went back to what they were | You did not press **Save opening hours** | The weekly grid never saves on its own. Set the week, then press the button |
| **Add to Calendar** is greyed out | No dates are selected | Click a start and end date on the calendar, or type **Start date** and **End date** |
| **At least one open period is required for amended hours.** | **Period 1 open** or **Period 1 close** is empty | Fill in both. Period 2 is optional |
| A whole day closed when I only meant part of it | The **Closure** was saved with both time boxes blank | Click it under **Upcoming**, set the start and end of the window you meant, then **Save Changes** |
| Clients still have bookings on a day I closed | Venue closures only stop new bookings | Open your **Calendar** for that date and move or cancel each one yourself |
| Times still show on my booking page for a closed day | A calendar's own working hours are separate from venue hours | Check that date on **Calendar Availability**, on the **Availability** tab for that calendar |
| I cannot find the entry I added last year | It has moved to **Past blocks** | Open **Past blocks** below the **Upcoming** list |
| The heading mentions capacity but I have no such option | Reduced capacity is for table bookings only | Nothing to fix. Your **Type** list is **Closure** and **Amended Hours** |

## Next steps

- [Business & calendar hours](/help/getting-started/business-and-calendar-hours)
- [Settings overview](/help/settings/overview)
- [Slots not showing or calendar gaps](/help/troubleshooting/availability-issues)
`.trim(),
  markdownRestaurant: `
# Business hours & closures (Restaurant and Founding Partner)

## Weekly opening hours

**Settings → Business hours → Weekly opening hours** is the same explicit save flow for every plan: edit the week, then press **Save opening hours**.

## Closures & special days

**Closures & special days** uses the shared calendar picker. Restaurant tier venues load extra controls:

- **Closure** and **Amended hours** apply to **all** booking types (copy on screen: closures and amended hours apply venue wide; reduced capacity is table bookings only).
- **Reduced capacity**: caps covers for table service across the selected range. When the editor shows **yield** style numeric fields, they map to optional per block overrides stored with the block.

Service scoped fields appear when the venue loads **venue services** for restaurant availability (the UI fetches \`/api/venue/services\` on those tiers).

## Timezone

Configure under **Settings → Profile** with the rest of the public venue identity.

## Table management link

Floor plan geometry and combinations remain under **Dining Availability → Table Management** (\`/dashboard/availability?tab=table\`), not inside the closures card.

## Practical checks

After closures, verify **table** online booking, and any hybrid schedule tabs, on the affected dates.
`.trim(),
};
