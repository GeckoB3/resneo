import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: "staff-first-booking",
  helpSection: "gs-set-up",
  title: "Let clients choose their person first",
  description: "Swap the order of your booking page so clients pick who they want to see before they pick a service.",
  tags: ["staff-first","booking order","booking page","picker","team photos","who first","practitioner"],
  verified: '2026-09-06',
  content: `# Let clients choose their person first

By default your booking page asks for a service, then who the client wants to see. If your regulars book a person rather than a treatment, you can swap those two steps around with the **Staff-first booking** setting.

> **The one big idea:** only the first two steps change. Everything after them (any options and add-ons, the times, the details, the deposit, the confirmation email) works exactly as it does now.

:::help-figure booking-order

## Is this right for your business?

It usually suits you if clients ring up and ask for a person by name, if your team have their own followings, or if the same treatment costs a different amount depending on who does it.

It usually does not suit you if clients care about the treatment and not who performs it, if everyone charges the same and offers the same list, or if you work alone. With one bookable person the picker still appears, showing a single card, which is a step your clients do not need.

## Turn it on

1. Open **Settings** from the sidebar, then the **Booking Settings** tab.
2. Scroll to **Optional Booking features**.
3. Turn on **Staff-first booking**. It saves on its own and shows **Setting saved.**
4. Open your booking page in a new tab to see it. A page that was already open keeps the old order until it is reloaded, because the order is decided when the page opens.

> **Who can do this:** admin only. If your sidebar shows **Account** rather than **Settings**, ask an admin.

You can turn it off again at any time, and your page goes straight back to asking for a service first. Bookings already in your diary are not affected either way.

## What your clients see

Your booking page still opens on **How would you like to book?**, with **Book an appointment** and **Group appointment**. The change comes next. Instead of **Select a service**, a client who chooses **Book an appointment** lands on **Who would you like to see?**, with a card for each bookable person and the note "Pick a person to see their services and prices." Once they pick someone, the rest of the booking is about that person:

- The service list shows only what that person offers, at that person's own prices. If Ada charges £30 for a cut and Ben charges £45, each client sees the exact figure rather than a "from" price. A service with several options still shows "from" its cheapest option.
- A **Booking with Ada** banner sits at the top of the service step and any options or add-ons steps, so nobody loses track of who they picked before they reach the times.
- **Back** on the service list returns them to the people, so changing their mind is one tap. **Back** on the picker returns to **How would you like to book?**.

If nobody has a bookable calendar with services on it, the picker says **No staff are available to book right now.** (using your own word for staff).

## Make the picker worth looking at

Each card is a photo and a name, nothing more. The photo comes from the profile under **Settings**, then **Booking Page**, then **Meet the team**, where each person has **Add photo** under **Team profiles**. Without one, clients see the person's initial in a circle.

Adding photos is the one job worth doing before you switch this on. A row of grey initials asks clients to choose between strangers. A row of faces does not.

Bios and specialties stay on your **Meet the team** tab, where a client who wants to read about someone can go and read about them. Keeping them off the picker keeps it a quick choice rather than a page of reading.

> **Good to know:** anyone you have unticked from **Show on page** under **Meet the team** still appears in the picker, because they are still bookable. They show as an initial rather than their photo, which is what hiding them asked for. If the **Meet the team** tab itself is switched off, everyone shows as an initial.

## When someone is fully booked

This is the one place the new order can frustrate a client, because they have committed to a person before finding out that person has nothing free. So when there are no times, the **No times available** card ("Try a different date above.") gains a **See someone else** button. It appears as long as you have more than one bookable person and the client did not pick **Any available**.

It takes them back to the people, remembering what they were trying to book. The next person's list pins that service at the top, tagged **You were booking this**, with that person's own price beside it. If the person they pick does not do it at all, a line says so ("Ben does not offer the service you were booking, but here is what they do.") and their normal list follows. Once the client ticks a service, the pin is dropped.

If **Appointment waitlist** is on, the same card also offers to join your waitlist, as it does today.

## If you use "Any available"

When **Any available practitioner** is also on, an **Any available** card ("First available time across the team") sits at the top of the picker whenever more than one person is bookable. Clients who do not mind who they see can take it: they see the whole team's service list with "from" prices, the banner reads **Booking with whoever is available first**, and they get the first free time across the team, exactly as before. **See someone else** is not offered from this route, because it already covered everyone.

On a combined page the card appears only when at least one service is offered on the same terms by every venue. If the client then picks a service that differs by venue, the page asks them to choose a calendar after all, explaining that the service is a little different for each person.

## Group bookings

Group bookings work the same way, one guest at a time. After **Group appointment** and **Who is this appointment for?** (a name or label for that guest), the client is asked **Choose staff** ("Who should see Alex?"), then picks from that person's services at that person's prices, then the times. Two guests can see two different people. There is no **Any available** card in a group booking, the same as before.

## Taking bookings yourself

Your dashboard booking form follows the same setting, so the order your team works in matches the order your clients see. It opens straight on **Who is this appointment with?**, with no single-or-group chooser in front of it, and lists that person's services next.

Two situations still ask for the service first, because the person is already settled:

- You clicked an empty slot on someone's calendar column, so the date, the time and the person all came with the click.
- You are rebooking a client from a past appointment, which already knows what they had last time.

Walk-ins do ask who first, even when you start a walk-in from a calendar column. Someone standing at your desk is as likely to want a particular person as a particular treatment.

## What does not change

- Each person's own booking link, for example \`.../book/your-salon/dave\`, already starts with the person decided. It opens on their services under a **Booking with Dave** banner, as it always has.
- Clients changing an existing booking from their confirmation email keep the person they booked.
- Links that already name a service, such as a waitlist invitation, open on that service. The client has already chosen the what, so they are not sent back a step.

## If you host a combined page

A combined page follows the host venue's setting, because it is presented to clients as one business. Turn it on at the host venue and the combined page swaps over too. On the host's **Linked Accounts** tab, **Manage combined page** lists it under **Settings that follow the host venue**, with whether it is currently on or off. Cards there are a photo and a name, the same as anywhere else. Where two people across the venues share a name, the venue's name is added after it (for example "Andrew · Bright Cuts") so clients can tell them apart.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| I cannot find **Staff-first booking** | You are not an admin, or you are on the wrong tab | Sign in as an admin, open **Settings**, then **Booking Settings**, and scroll to **Optional Booking features** |
| My booking page still asks for a service first | The page was open before you switched it on | Reload the page |
| My dashboard form still asks for a service first | You opened it from a calendar slot, or from a rebook | This is expected, the person is already decided. Start from **New Booking** in the sidebar to get the picker |
| The cards are all grey initials | No photos are added, **Show on page** is unticked, or the **Meet the team** tab is off | Under **Settings**, then **Booking Page**, then **Meet the team**, add photos and tick **Show on page** |
| A hidden team member still shows | Hiding affects your Meet the team tab, not who is bookable | Nothing to fix. To stop them being booked, untick **Active (bookable)** on their calendar under **Calendar Availability**, **Calendars** tab |
| Only one card appears | You have one bookable calendar | Turn the setting off, or add a calendar per person |
| The **Any available** card is missing | Only one person is bookable, or on a combined page no service is offered on the same terms everywhere | Add a second bookable calendar, or check the offerings on the combined page |
| A client says a service vanished | They picked someone who does not offer it | Ask them to go back and pick someone else, or check that service is ticked against the right calendars |
| Prices look different to before | Clients now see one person's price, not the lowest across the team | This is expected. Check each person's prices under **Services** |
| My combined page did not change | The setting follows the host venue | Turn it on at the host venue |

## Next steps

- [Your public booking page and embed](/help/getting-started/public-booking-page)
- [Set up your services](/help/getting-started/services)
- [Add and manage your team](/help/getting-started/staff)`,
};
