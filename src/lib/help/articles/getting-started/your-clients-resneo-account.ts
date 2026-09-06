import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: "your-clients-resneo-account",
  helpSection: "gs-run",
  title: "Your clients' ResNeo account",
  description: "What a client can see and do at resneo.com/account, and what that means for your venue.",
  tags: ["customer portal","account","clients","marketing consent","saved cards","gdpr","self service","bookings"],
  verified: '2026-09-06',
  content: `# Your clients' ResNeo account

Anyone who books with you can have a free ResNeo account of their own at **resneo.com/account**. It is where they find their bookings, their passes, their receipts and their contact details, without ringing you.

You do not switch this on and you cannot switch it off. It is worth knowing anyway, because half the calls you take are questions the account already answers.

## Before you start

- Nothing to set up, and nothing to pay for. It is the same account for every venue they book with.
- A client only needs one, however many ResNeo venues they use.
- You have no way in. You cannot sign in as a client, set their password, or add a booking to their account by hand.

## How a client gets in

They sign in at **resneo.com/login**, with a password or with a one-time link sent to their email.

The important part for you: **their bookings are matched by email address**. When somebody signs in for the first time, every booking already held under that email, including ones you took by phone or imported, is linked to their new account. If they book with one email and sign in with another, they will see nothing, and the fix is for them to sign in with the email on the booking.

On their first few visits a banner offers **Set a password to get straight back in**, with a **Set a password** button. They can dismiss it and carry on using email links.

Once in, the header says **Customer portal**, then **My account**, with their email address and a sign out button. Four items run underneath: **Bookings**, **Passes and plans**, **Profile** and **Help**.

## The overview

The first screen greets them by name (**Welcome back, Ada**) and leads with their next booking. If there is nothing booked, they see **No upcoming bookings** and a **See your booking history** button.

Below that, only when they apply:

- A panel saying **One booking still has something to pay**, listing the venue, the date and the balance, with the note "You pay the venue directly for these, when you go." The account cannot take that money, and does not pretend to.
- **Also coming up**, a short list of their other upcoming bookings, each with a **Details** link.
- A line telling them one of their other bookings has a form to complete.
- **Your venues**, "Everywhere you have booked, most recent first", one card per venue with the number of bookings, the deposits they have paid there, when they are next in, and **View booking** and **Book again** links. **Book again** goes straight to your booking page.

## Bookings

**Your bookings** is headed "Reservations and visits linked to your account. Open a booking for details or use the venue manage link where available."

- **Waitlists** sits at the top, listing places they are waiting for, marked **A place is open** when one has come up, each with **Leave waitlist**.
- Two rows of filters: **All**, **Upcoming**, **Past**, and then **All types** with **Appointments**, **Classes**, **Events**, **Resources** and **Tables**. A type only appears if they have that kind of booking, so a salon client never sees an events filter.
- **Details** opens the booking. That page carries the same controls as the link in their confirmation email: **Change appointment** and **Cancel appointment** (or a **Need a different time?** note when you do not allow online changes), **Get directions**, forms still outstanding, **Add to Google Calendar** and **Download for other calendars**. It also adds **Payments for this booking**, which the emailed page does not have.
- A past visit shows **Book again**.

## Passes and plans

Four tabs: **Credits**, **Courses**, **Memberships** and **Recurring**. This screen only has anything in it if you sell class packs, courses or memberships, which needs **Class packs, courses & memberships** turned on under **Settings**, then **Booking Settings**.

- **Credits** is headed **Class credits**: "Credits are held with each venue separately. Buy a pack from a venue that sells them, then use your credits when you book a class there." It shows **Balances**, **Buy a pack** and **Recent activity**.
- **Courses** lists their **Enrollments** and the courses on sale, free or paid.
- **Memberships** shows **Your memberships** and **Start a membership**, with the line "Memberships are billed by the venue you joined, not by ResNeo."
- **Recurring** is **Repeat class bookings**: "Pick a day and time, and we will book that class for you each week. You need a membership that includes repeat booking."

## Profile and preferences

The longest screen, with jump links at the top to **Payment history**, **Saved payment methods** and **Password and account**. Everything above those three is saved with one **Save changes** button at the foot.

- **Contact details**: **First name**, **Surname**, **Email**, **Phone number** and **Preferred display name (optional)**. Email is their sign-in address, so changing it asks them to confirm from the new inbox.
- **Dates and sign-in**: **Timezone**, which decides how dates and times are shown to them, and **Default destination after login** (**Ask when needed**, **Account** or **Venue dashboard**).
- **Notification preferences**: two tick boxes, both about email from ResNeo itself, not from you. One covers account notices, the other covers ResNeo product news. The screen says plainly that confirmations, reminders and changes are set by the venue they booked with.
- **Venue marketing consent**: one row per venue they have booked with, each with a **Marketing emails** tick box and the date consent was recorded. This is the one that matters to you, and the next section explains why.
- **Devices**: **Register this browser** helps ResNeo spot unfamiliar sign-ins. Registered browsers can be removed.
- **Payment history**: "Deposits and payments recorded against your bookings", each row showing the amount, the venue, whether it was card online, card in person or another method, the date, and a **View booking** link. Refunded and pending payments are labelled as such.
- **Saved payment methods**: cards are saved with each venue separately, never across ResNeo. They pick a **Venue**, see **Saved cards**, and can **Add card** or remove one.
- **Password**: create or change the password for email and password sign-in. Email links keep working either way.
- **Sessions**: **Sign out everywhere**.
- **Download your data**: "Everything in your account, as one file: your profile, bookings, payments and waitlist places." It downloads to their device rather than arriving by email.
- **Delete account**: they type DELETE MY ACCOUNT and click **Request account deletion**. There is a 30-day grace period, and **Cancel deletion request** stops it during that time.

## What this means for your venue

**Fewer calls.** "What time am I in on Thursday", "have I got any credits left", "what did I pay you" and "can you resend my directions" all have an answer they can reach themselves.

**Self-service changes.** Clients can move an appointment from the account when **Guest self-reschedule** is on under **Settings**, then **Booking Settings**, in **Optional Booking features**. With it off they can still cancel, and are told to phone you to move it.

**Marketing consent, kept honest.** When a client ticks or unticks **Marketing emails** for your venue, it changes their record in your **Contacts**, and nothing else. Open the contact and look at **Marketing preferences**, which holds **Opt out of marketing** and **Marketing consent** and shows the date consent was last recorded. On the **Contacts** filter panel, **Marketing consent** narrows the list to **Subscribed** or **Not subscribed**, which is what you build a mailing list from. See [your contacts (CRM)](/help/getting-started/contacts).

**Deletion is not just their account.** A deletion request removes their access after the grace period and anonymises the personal details held against them at the venues they booked with, in line with data protection rules. The booking history stays for your figures, without their name on it.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| A client says their account shows no bookings | They signed in with a different email from the one on the booking | Ask which email they used, then check the address on their record in **Contacts** |
| Their older bookings are missing | Those bookings carry a different email address, or none at all | Correct the email on the contact, then merge duplicate records if there are two |
| They cannot change an appointment from their account | **Guest self-reschedule** is off | Turn it on under **Settings**, then **Booking Settings**, or move the booking yourself |
| They ask you to reset their account password | Only they can do that | Send them to **resneo.com/login** and the **Password** section of their profile |
| They say they never opted in to your emails | Consent comes from the tick box when they book, or from **Venue marketing consent** in their account | Check **Marketing preferences** on their contact for the date consent was recorded |
| They want a record of what they paid | It is already there | Point them at **Payment history** on their profile, or **Payments for this booking** on the booking itself |
| They ask you for a copy of their data | The account does it in one click | Point them at **Download your data** on their profile |
| They want their data deleted | They can request it themselves, or you can erase it at your end | **Delete account** on their profile, or **Erase personal data?** on their contact in **Contacts** |

## Next steps

- [What your clients see when they book](/help/getting-started/what-your-clients-see)
- [Your contacts (CRM)](/help/getting-started/contacts)
- [Guest communications (email and SMS)](/help/getting-started/communications)
- [Using the waitlist](/help/getting-started/waitlist)`,
};
