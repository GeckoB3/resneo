import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: "waitlist",
  helpSection: "gs-run",
  title: "Using the waitlist",
  description: "Let fully booked clients add their name to a waitlist so you can offer them the next free slot.",
  tags: ["waitlist","appointments","offers","bookings","availability","settings","notifications"],
  verified: '2026-09-12',
  content: `# Using the waitlist

The waitlist collects clients who want a time you cannot offer yet, so you can fill a gap the moment one appears.

> **Good to know:** clients put themselves on the waitlist from your booking page. There is no way to add someone from your dashboard, so a caller has to join it themselves.

## Before you start

- You need an admin login. The **Booking Settings** tab is hidden from staff logins.
- **Waitlist** only appears in your sidebar once the feature is switched on, under **Contacts**.

## Step 1: Turn the waitlist on

1. Open **Settings**, then the **Booking Settings** tab.
2. Find **Optional Booking features** and turn on the **Appointment waitlist** switch.
3. It saves on its own and confirms that guests are notified by email when a slot opens.

**Waitlist** now appears in your sidebar.

> **Good to know:** if **Appointment waitlist** is not in that list, the waitlist is not available on your account yet. Use the **Support** link in the sidebar and ask us to switch it on.

## Step 2: Choose what happens when a slot opens

Turning the switch on reveals **When a slot opens** just below it. Pick one of three:

- **Staff choose.** Nothing is sent automatically. A **Waitlist** banner appears across the top of your dashboard saying which slot opened and how many waiting clients match, with **Offer appointment**, **View waitlist** and **Dismiss**.
- **First in line.** The first matching client is notified by email and SMS on their own. If they do not book within 30 minutes their invite expires and the next matching client is notified. The slot stays on your public booking page the whole time, so anyone can still take it.
- **Offer to all.** Every matching client is notified at once. The slot stays open and whoever books first gets it.

Your choice saves as soon as you select it.

> **Good to know:** in **First in line** and **Offer to all**, cancelling an appointment is what sets this off, whether you cancel it or the client does. You do not have to do anything else.

## Step 3: Send clients to the waitlist

Clients join from your public booking page.

1. Say you will send them your booking link. It is under **Settings**, then the **Booking Page** tab.
2. Ask them to pick the service and the day they want.
3. When a day has nothing free they see **No times available**, then a **Join waitlist** button.
4. They fill in **Service**, **Preferred date**, **Who would you like to see?** (**Anyone available** or a named person), their name, **Mobile number** and **Email**, then **Any time that day** or **Between specific times**.
5. Their name shows on your **Waitlist** screen as **Waiting**.

> **Tip:** keep your booking link saved in your phone so you can send it in seconds.

## Step 4: Offer a slot by hand

You can do this at any time, in any of the three modes.

1. Open **Waitlist** from the sidebar.
2. Stay on the **Active** tab and find the client.
3. Click **Offer spot**.

ResNeo looks for a free slot that matches their date, service and time window, then emails or texts them a link to your booking page with the date, service and time already filled in. They finish the booking themselves.

:::help-figure waitlist-list

> **Good to know:** the entry turns **Complete** as soon as the invite goes out, and **Complete** entries leave the **Active** tab. Switch to **All** to see it again.

> **Warning:** an invite cannot be taken back once it is sent. If you send it to the wrong person, phone them and explain.

If **Offer spot** is greyed out, a short note beside it explains why: no slots free on that date, none inside their time window, or no calendar offers that service. If it says it could not check availability, the button still works and ResNeo checks again when you click it.

## What each status means

- **Waiting**: they are on the list and nothing has been sent.
- **Complete**: an invite has been sent to them. It does not mean they have booked, so check your calendar for that.
- **Expired**: a timed invite in **First in line** mode ran out after 30 minutes. The next matching client is notified for you.
- **Cancelled**: you clicked **Cancel** on the entry while it was still **Waiting**.

In **First in line** mode a row also shows **Expires** and a time. In the other two modes invites have no time limit.

Use the bin icon on **Expired** and **Cancelled** rows to tidy them away. ResNeo asks "Remove this entry permanently?" first.

## Change the invite wording

1. Open **Settings**, then the **Communications** tab.
2. Scroll down to the **Waitlist invites** section.
3. The **Waitlist invite** card is where you turn invites off, add SMS as well as email, or edit the message.

Invites go by email only until you tick SMS here.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| There is no way to add someone myself | Clients join the waitlist themselves | Send them your booking link and ask them to join from a full day |
| No **Waitlist** link in the sidebar | The waitlist is switched off, or you are on a staff login | Ask an admin to turn on **Appointment waitlist** under **Settings**, then **Booking Settings** |
| A client I offered has disappeared | The entry turned **Complete** and left the **Active** tab | Switch to **All** |
| **Offer spot** is greyed out | No slots free on that date or in their time window, or no calendar offers that service | Read the note beside the button, then check the service and the calendars it is on |
| Nobody was notified when I cancelled | You are in **Staff choose** mode | Use the **Waitlist** banner on your dashboard, or open **Waitlist** and click **Offer spot** |
| An entry says **Complete** but nothing is in my calendar | **Complete** means the invite was sent, not that they booked | Give them time to use the link, or phone them and take the booking yourself |
| The invite went by email and they wanted a text | SMS is off for waitlist invites | Tick SMS on the **Waitlist invite** card under **Settings**, then **Communications** |

## Next steps

- [Taking a booking](/help/getting-started/new-booking)
- [Using the calendar](/help/getting-started/calendar)
- [Guest communications (email and SMS)](/help/getting-started/communications)`,
};
