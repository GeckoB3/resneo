import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: "services",
  helpSection: "gs-catalogue",
  title: "Set up your services",
  description: "Create the services clients can book: set one fixed length and price or offer several bookable options, add optional extras with add-ons, decide how clients pay, and link them to a calendar.",
  tags: ["services","appointments","duration","deposit","payments","calendar","catalogue","booking","one fixed offering","multiple bookable options","options","variants","add-ons","extras","upsell","card hold","no-show fee","processing time","categories","booking interval","start times","location","online"],
  verified: '2026-09-12',
  content: `# Set up your services

A service is anything a client can book with you: a consultation, a treatment, a session. Get one set up here and it will show on your booking page, ready for clients to choose a time.

> **The one big idea:** a service only appears for clients once it is **Active** and linked to at least one **calendar** that has working hours. Service plus calendar plus hours equals a bookable slot.

> **In a hurry?** Do Step 1, leave Step 2 on **One fixed offering**, then jump to Step 10 to check the calendars and click **Create Service**. That is a bookable service. Options, add-ons, online payment, processing time and booking windows can all wait until tonight.

:::help-video services-setup

## Before you start

- Services live under **Services** in the sidebar. The page has three tabs: **Services**, **Categories** and **Add-ons**.
- Admins set up services for the whole business. Team members can add services too, but only for the calendars an admin has linked to their login (**Settings → Staff**, **Calendars they manage**), and they see a shorter form: name, description, duration, buffer, price, online payment, booking rules, start times, colour and the active switch. Category, options, add-ons, processing time, location, per-calendar overrides and the service's own schedule are admin only.
- If you want clients to pay online, finish connecting Stripe first. See [connect Stripe to take payments](/help/getting-started/stripe-payments).

## Step 1: Name it and set the basics

1. Open **Services** and click **Add service** (an empty list shows **Add your first service** instead). The **Add Service** form opens.
2. Type a **Name** clients will recognise, such as "Cut and finish".
3. Add a short **Description** if it helps clients choose.
4. If you have created categories, choose a **Category**. New services start as **No category**. See "Group services into categories" below.
5. Set **Duration (mins)**, anywhere from 5 to 480. It starts at 30.
6. Set **Buffer (mins)** if you need protected time after the appointment, from 0 to 120.
7. Enter a **Price (£)**.

:::help-figure services-editor

## Step 2: Choose how clients book it

Under **How will clients book this service?** pick one structure:

- **One fixed offering**: one duration, buffer and price. What you set in Step 1 applies to every booking.
- **Multiple bookable options**: clients choose an option, for example short, medium or long hair, before they pick a time. Each option has its own duration, buffer, price, optional description and optional deposit. Step 4 shows how to build them.

Only admins see this choice. Switching a service back to **One fixed offering** removes every option you added, so ResNeo asks you to confirm first.

:::help-figure service-booking-mode

## Step 3: Decide how it is paid online

Scroll to the **Online payment when booking** card and choose one:

1. **No online payment (pay at venue or arrange separately)**: the default. Clients book without paying anything.
2. **Custom deposit (fixed amount online)**: fill in **Deposit amount (£)**. On a service with several options this is called **Default deposit (£)** and is used when an option leaves its own deposit blank.
3. **Pay full price online at booking**: the price from Step 1 is charged as the client books. With several options, every option you offer to clients needs its own price.
4. **Card hold**: no payment is taken when the client books. Their card is stored securely and you can charge a **No-show fee (£)** if they do not attend. The fee must be at least £1. On a service with several options this is called **Default no-show fee (£)**.

> **Warning:** deposits, full payment and card holds need Stripe **fully** finished, not just started. If you began connecting Stripe but Stripe has not enabled charges yet, this form stops warning you, and every client who tries to book sees "Payment setup failed" and their booking is cancelled. Check that **Settings → Payments** shows **Stripe connected; charges enabled** before you turn on online payment.

## Step 4: Offer several versions (optional)

If you chose **Multiple bookable options**, a **Bookable options** panel appears. Build one option at a time:

1. Type an option name, such as "60 minutes" or "Full head".
2. Add an **Optional description (shown when they pick this option)** if it helps clients choose.
3. Set **Duration (mins)**, **Buffer (mins)** and **Price (£)**. If you take deposits, the fourth box, **Deposit (£)**, is optional: leave it blank to use the default from Step 3. With card holds it is called **No-show fee (£)**.
4. Leave **Offer this option to clients** ticked. Untick it to hide an option from clients without deleting it.
5. Click **Add another option** for the next version. It stays greyed out until every option above has a name, a valid duration and, when you charge full payment online, a price. Each option card shows **Ready** or **In progress** so you can see which one needs finishing.

**Remove** deletes an option. You must keep at least one; to drop options altogether, switch back to **One fixed offering**. A service must offer at least one option to clients, or it will not save.

:::help-figure service-variants

## Step 5: Offer optional add-ons (optional)

Add-ons are extras a client can bolt on, such as a beard trim or hot stones. They live in groups: each group asks the client one question and lists the options they can pick from. Only admins can set them up.

In the **Add-ons** card of the service form:

1. Click **+ Add group** to build a new group, or **Use existing group** to pick one you built before.
2. In **Add an add-on group**, type a **Group name** (an internal label) and a **Prompt to client**, the question shown at booking, such as "Would you like any extras?". If the prompt is blank, clients see the group name.
3. Under **Selection**, choose **Pick one** or **Pick multiple**. For pick one, tick **Required (client must choose one)** if the client has to answer. For pick multiple, set a **Minimum** and a **Maximum** (leave **Maximum** blank for no limit).
4. Tick **Hide from online booking page (staff-only)** for extras you only add yourself.
5. Under **Options**, give each extra a name, an optional description, an **Extra price (£)** and **Extra minutes** (up to 240). Click **+ Add option** for more. Untick **Active** to retire an option without deleting it.
6. Click **Add group**. The group is now linked to this service. Use the arrows to change the order groups are asked in, **Edit** to change one, or **Remove** to unlink it from this service.

Groups are shared across your whole business. The **Add-ons** tab on the Services page is your add-on library: it lists every group, shows which services use it under **Used by**, and lets you create (**New add-on group**), **Edit** or **Delete** groups. Tick **Show archived groups** to see ones you have retired. Deleting a group that past bookings used archives it instead of removing it.

:::help-figure service-addons

:::help-figure addon-group-editor

## Step 6: Free up your chair during processing time (optional)

Some services have a wait where the client stays put but you are not needed, such as colour developing. Processing time marks that wait so ResNeo can book someone else into it. Only admins can set it.

Find the **Processing time** card and click **+ Add processing period**. On a service with several options, each option card has its own **Processing time** section instead.

1. The new period starts at the end of the service and runs on after it. Set **Length (min)** to how long the wait lasts, at least 5 minutes.
2. For a wait in the middle of the service, set **Start (min)** to how many minutes into the appointment it begins.

Time after the service is not counted in the service length clients see, but when the client books a second service in the same visit, that service starts once the wait is over. The bar above the rows shows time with the client in blue, processing time in amber and the buffer in grey. Click **Remove** to delete a period.

> **Example:** a colour where you apply for 60 minutes and the client then develops for 30. Set the duration to 60 and add a processing period of 30. On the calendar the colour shows as one hour, the next half hour is free to book someone else into, and a cut and finish booked in the same visit starts after it.

## Step 7: Set your booking window and start times

Scroll to **Guest booking rules**. These decide when clients may book this service online.

1. **Max advance (days)** is how far ahead your diary opens, from 1 to 365. It starts at 90.
2. **Min booking notice (hours)** is the shortest warning you accept, from 0 to 168. It starts at 1, so a client can book a 3pm cut at 2pm.
3. **Cancellation notice (hours)** decides how long before the start a deposit or online payment is still refundable. It starts at 48.
4. **Allow same-day bookings** is on by default.

Just below, **Booking interval & start times** decides when a booking can begin. Choose one of two ways:

- **Repeat every few minutes** (the default): set **Interval (minutes)**, from 1 to 60. It starts at 15, so slots run at :00, :15, :30 and :45. Set it to 30 if you would rather offer only 9:00 and 9:30. To pick the marks yourself, tick **Restrict start times within each hour** and tap the minutes past the hour when bookings can start (**Select all** and **Clear** help).
- **Fixed times of day**: name the exact times, such as 9:20, 11:30 and 3:30, using **+ Add a time**. Each time still has to fit inside your opening hours and the calendar's hours. ResNeo warns you when two times are closer together than the appointment takes.

## Step 8: Say where it happens (optional)

Most services happen at your premises, so you can leave the **Location** card on **At your venue**. Only admins see this card.

- **At the client's address** makes the booking form ask every client for their address, saves it to their contact record, and shows it in their emails instead of your address.
- **Online** lets you add a **Link to the online service** and **Joining information for the client**, both of which go into confirmation and reminder emails.

## Step 9: Colour, then make it live

1. Pick a **Colour** so it stands out on your calendar.
2. Check **Active (visible to clients)** is on. It is on for a new service.

Later, admins can switch a service on or off straight from its card with **Active (visible to guests)**, without opening the form. A switched-off service shows an **Inactive** pill.

## Step 10: Check which calendars offer it, then save

If you are an admin, you will first see **Optional overrides per calendar**. Leave the boxes unticked and every calendar uses the values above.

> **Different price per chair?** Tick **Display name**, **Description**, **Duration**, **Buffer time**, **Price**, **Deposit** or **Colour** under **Optional overrides per calendar** to let the team member on each calendar set their own value for that field. They do it from the service card with **Edit your settings**.

Then scroll to **Calendars that offer this service**.

> **Warning:** when you create a service, **every** calendar is ticked for you. Untick the people or rooms that should not offer it, or it goes on sale for all of them.

1. Untick any calendar that should not offer this service.
2. If you are an admin and need a new column, click **Add calendar**, type a **Display name** and click **Create and assign**. The new calendar starts with hours of 09:00 to 22:00 every day (narrow them under **Calendar Availability**) and is ticked for this service.
3. Click **Create Service** (or **Save Changes** when editing).

> **Warning:** if an admin unticks every calendar, ResNeo still saves the service without complaining. It will look fine in your list and no client will ever see it. Always leave at least one ticked. (A team member must leave at least one of their own calendars ticked, or the form will not save.)

> **Good to know:** your plan sets how many bookable calendars you can have. Light gives you one, Plus five, Pro unlimited. Once they are used up, **Add calendar** is replaced by a message that names your plan and links to **Settings → Plan**.

## How a service reaches your booking page

Once a service is **Active** and linked to a calendar with working hours, clients see it on your booking page. The times they can pick are wherever three things overlap: your venue opening hours, the hours of each calendar you ticked, and this service's own schedule.

Scroll to **When guests can book this service online** to see the result drawn out before you save. Days that no linked calendar works, and days a custom schedule excludes, show as closed. Staff blocks and one-off calendar changes are not previewed here, but they do apply live.

If a service should be bookable for less time than you are open, use **This service's schedule** just below (admins only):

1. Tick **Limit this service to a custom schedule**.
2. Add at least one rule: **Add weekly hours** for the same pattern every week, **Add specific dates** for extra slots on hand-picked days, or **Add date range** for a season with its own weekly pattern. **+ Add another rule** adds more; a time is bookable if any rule allows it.
3. Save. A custom schedule with no rules will not save.

You can also link services from the calendar side: open **Calendar Availability**, choose the **Calendars** tab, click **Edit** on a calendar and tick the services under **Appointment services**.

## Put your services in order

Services appear on your booking page, and in the staff booking form, in the order they sit in your list. Drag the grip handle at the top right of a service card, or use the up and down arrows next to it, to put your most popular one first. If you use categories, you reorder within each category heading.

## Group services into categories

If you offer more than a handful of services, put them into categories so clients find what they want quickly. Categories appear as headings on your booking page and in the staff booking form.

1. On the **Services** page, open the **Categories** tab.
2. Type a name such as Hair, Nails or Massage and click **Add category**.
3. Drag the handle on the left of a category, or use the arrows, to set the order the headings appear in on your booking page.
4. Back on the **Services** tab, open a service and choose its **Category**. The dropdown only appears once you have at least one category. Services without one are listed under **Other services** at the end.

**Rename** changes a heading at any time. **Delete** never deletes a service: ResNeo asks you to confirm (**Delete "Hair"?**, with your category's name) and moves its services to **Other services**. To choose whether categories show as sections with a menu or as collapsible headings, see [your public booking page](/help/getting-started/public-booking-page).

## Edit, pause or delete a service

Each service card shows its duration, price, payment rule, options, add-ons and the calendars that offer it.

- **Edit** opens the same form as **Add Service**, titled **Edit Service**. Click **Save Changes** when you are done.
- **Active (visible to guests)** on the card pauses a service without deleting it (admins only).
- **Delete** asks **Delete this service?**. Confirm with **Delete service**. Calendar links to the service are cleared and this cannot be undone. If you might need it again, switch it off instead.
- If compliance records are turned on for your venue, editing a service also shows its compliance requirements, with **Add compliance requirement**. See [compliance records](/help/getting-started/compliance).

## Team members and services

- A team member sees every service but can only add new ones for the calendars they manage. The **Add service** button only appears once an admin has linked their login to a calendar.
- On each service card, the **Offer on your calendars** box lets them tick or untick the service for each of their calendars. Calendars are labelled **(your calendar)** or **(view only)**.
- When an admin has allowed overrides for a service, **Edit your settings** opens **Your settings:** followed by the service name, where the team member changes only the fields the admin allowed for their calendar. Matching the venue default clears an override.
- Team members cannot edit or delete a saved service, even one they created. Ask an admin.

:::help-figure services-flow

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| My new service is not on the booking page | Every calendar was unticked (this saves silently), it is not **Active**, or a custom schedule is on with rules that never overlap your hours | Open the service, tick at least one calendar under **Calendars that offer this service**, check **Active (visible to clients)**, look at **When guests can book this service online**, and save |
| My service appears for everyone | New services start with every calendar ticked | Open it and untick the calendars that should not offer it |
| The service shows but has no available times | Your venue opening hours are narrower than you think, the calendar's hours do not cover that time, or **Min booking notice (hours)** rules out today | Check **Settings → Business hours**, then the **Availability** tab under **Calendar Availability** for that calendar. A new calendar starts at 09:00 to 22:00 every day, so venue hours are usually what limits it |
| I cannot save the service | **Name** is empty, a deposit is blank or zero, a no-show fee is under £1, full payment is on with no price, an option has no name or price, no option is offered to clients, a custom schedule has no rules, or the online link is not a valid web address | Fill in the missing value the message names, then save again |
| **Add another option** is greyed out | An option above is missing a name, a valid duration, or a required price | Complete every option (unfinished ones are highlighted in amber), then add the next |
| Clients pay nothing even though I set a deposit | Stripe is not fully connected | Finish Stripe under **Settings → Payments** until it shows **Stripe connected; charges enabled** |
| **Add calendar** is missing | You have used every calendar your plan allows | Deactivate a calendar you no longer use, or upgrade under **Settings → Plan** |
| A team member cannot see **Add service** | Their login is not linked to a calendar | Under **Settings → Staff**, set **Calendars they manage** for that person |
| An add-on group will not delete | Past bookings used it, so ResNeo archived it instead | Tick **Show archived groups** on the **Add-ons** tab to see it; archived groups are no longer offered |

## Next steps

- [Business & calendar hours](/help/getting-started/business-and-calendar-hours)
- [Connect Stripe to take payments](/help/getting-started/stripe-payments)
- [Your public booking page and embed](/help/getting-started/public-booking-page)
- [Add your team](/help/getting-started/staff)`,
};
