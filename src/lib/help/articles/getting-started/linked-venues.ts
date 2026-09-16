import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: "linked-venues",
  helpSection: "gs-grow",
  title: "Link with another venue",
  description: "Share calendars and bookings with another ResNeo venue, and see how links underpin a venue collective.",
  tags: ["linked accounts","linked venues","venue collective","combined booking page","chair rental","multi venue","sharing"],
    verified: '2026-09-16',
  content: `# Link with another venue

If you share a space with another business, rent a chair to someone self-employed, or run more than one venue, you can link your ResNeo accounts. Linking lets two venues see each other's calendars and, if you both agree, manage each other's bookings.

> **The one big idea:** linking shares access, never ownership. Each venue keeps its own bookings, clients and payments. You choose what the other venue can see and do, and you can pull it back at any time.

:::help-video linked-venues-setup

There are two separate things here, and most businesses only need the first.

| | A link | A collective |
| --- | --- | --- |
| What it is | Two venues seeing each other's diaries | One public booking page covering several venues |
| Who sees it | Only you and your teams | Your clients |
| Good for | A chair renter, a shared room, covering each other | Two businesses trading under one name |
| What it needs | Whatever access you both agree | Full access, both ways, no calendar limits |
| Undoing it | **Unlink** | **Dissolve collective** |

Start with a link. You do not need a collective to share a diary.

## Before you start

- Linked accounts live under **Settings**, then the **Linked Accounts** tab. You need admin access.
- Both venues need to be on a ResNeo appointments plan. Every appointments plan can link, Light included.
- Both need a working subscription. A free trial counts, and so does a plan you have cancelled but not used up. A failed or expired payment stops you creating new links, though existing ones keep working.
- Linking costs nothing extra, and the other venue's calendars do not count against your plan's calendar limit.

## Step 1: Send a link request

1. Open **Settings**, then **Linked Accounts**.
2. In the **Active links** card, click **Send link request**.
3. Under **Find a venue**, type the other venue's name or paste their booking page address, then pick them from the list. Venues you can link with are marked **Available**. Ones marked **Unavailable** cannot link right now.
4. Add a **Personal note (optional)** if you like.
5. Set the permissions before you send. See step 2. This matters more than anything else on the page.
6. Click **Send request**.

> **Warning:** the form arrives pre-filled with full access in both directions: full booking detail, client contact details, and create, edit and cancel. If you send it without changing anything, that is what you are offering and what you are asking for. Always review step 2 first.

Do not know their exact name? Click **Get invite link** instead. **Invite a venue to link** gives you a link and a QR code to share. When an admin at the other venue opens it, it fills in a request back to you. It grants nothing on its own and expires in 30 days.

## Step 2: Choose what each venue can see and do

Permissions are set separately for each direction, in two boxes:

- **What [their venue] can do with your data** is the access you are giving away. Read this one especially carefully.
- **What you can do with [their venue]'s data** is what you are asking them to grant.

Start with **Calendar visibility**, because it decides the other two:

- **No access**: they see nothing, and the other settings switch off.
- **Busy/free time blocks only**: they see that you are busy, not who with. Client details and booking actions are not available at this level, on purpose.
- **Full booking detail**: they see the client name, service and notes on every booking.

> **Warning:** the three settings are a ladder, not three independent choices. The moment you pick **Full booking detail**, ResNeo also ticks **Share client contact details (name, email, phone)** and sets **Booking actions** to **Edit existing bookings**. One dropdown change hands over three things: your diary in full, your clients' names, emails and phone numbers, and the right to change your bookings.
>
> If that is more than you meant, untick **Share client contact details** straight away. Doing so forces **Booking actions** back to **Read-only**. There is no way to let another venue edit your bookings without also sharing your clients' contact details.

**Booking actions** offers **Read-only**, **Edit existing bookings**, or **Create, edit and cancel bookings**. Only the last one lets them add a booking to your diary.

If you have more than one calendar, **Which of your calendars?** appears underneath. Leave it on **All calendars**, or pick **Choose specific** and tick the ones to share, so a chair renter sees only their own column. You can only limit the calendars you are sharing out, not which of theirs you see.

A link has to give something to somebody: if you set both directions to **No access**, ResNeo says so and will not let you send it.

> **Tip:** start at **Busy/free time blocks only**. For coordinating a shared diary that is genuinely all you need, and it shares no client data at all.

## Step 3: Respond to a request sent to you

1. Open **Settings**, then **Linked Accounts**.
2. Under **Pending requests**, find the venue under **Received** and click **Review request**.
3. Read the two lines saying what each venue would be able to do.
4. Click **Reject**, or **Accept**, or **Accept with changes** to adjust the permissions first and then click **Save & accept**.

> **Good to know:** a request nobody answers expires after 30 days. You can have 10 requests waiting at once, and there is a seven-day wait before you can ask the same venue again after a rejection.

## Step 4: See the shared calendars

Once a link is active, click **Open linked calendars** in the **Active links** card. It takes you to your **Appointment Calendar**, where the partner's columns sit alongside your own.

- Linked bookings carry a small chip with the other venue's name.
- A padlock on that chip means view only: either they share time blocks only, or they have not granted edit rights.
- To hide or show them, click **Filter** above the grid and use the **Linked venues** section. **All linked calendars** shows the lot, or tick individual venues and columns.
- The **Day Sheet** has its own **Linked calendars** panel at the bottom, for the day you are printing.

To add a booking on a partner's column, they must have granted you **Create, edit and cancel bookings**. Where they have, a **New booking** button appears for that venue and the booking is created in their diary, not yours.

## Changing or ending a link

Each active link has buttons for **View audit log**, **Edit permissions**, **Reduce access now**, and **Unlink**. **Edit permissions** is hidden while a link is suspended or a change is awaiting an answer.

| Change | When it applies | Button |
| --- | --- | --- |
| You give the other venue more access | Immediately | **Expand access now** |
| You cut back what they can do | Immediately, and they do not need to agree | **Reduce access now** |
| You ask for more access to their data | Only once they accept | **Propose change** |
| You change both directions at once | Only once they accept, even if one side is a reduction | **Propose change** |
| You end the link | Immediately, for both venues | **Unlink** |

While a proposed change is waiting, both venues see it on the link. The venue that proposed it can **Withdraw change**. The other venue can **Accept change** or **Decline change**. Neither of you can propose a second change until the first is settled.

**View audit log** opens the **Cross-venue audit log**: every cross-venue action on that link. Both venues see the same list, and it is kept after the link ends. Ended links move to the **Past links** card, where the audit log is still available.

> **Warning:** unlinking stops access both ways at once. To link again, one of you sends a fresh request.

If the other venue's subscription lapses, the link shows as **Suspended** and sharing pauses. It resumes on its own if they restore it within 30 days.

## Emails and the notification bell

When your venue has an active link, admins get a bell beside **Support** at the bottom of the sidebar. A number on it counts unread items. Click it for a list of what the linked venues have done to your bookings, click any entry to open that booking, or click **Mark all read**. When there is nothing new it says you are all caught up.

The bell always fills in. Email is separate, and off until you ask for it. Scroll to the **Notification emails** card at the bottom of **Settings**, then **Linked Accounts**, and switch on the ones you want. There are four:

- Email me when a linked venue cancels a booking
- Email me when a linked venue reschedules a booking
- Email me when a linked venue creates a new booking
- Email me when a linked venue edits booking notes or service

Emails go to your venue's contact address and to active admins. The last one can be noisy, so leave it off unless you really want every note change.

## Put linked venues on one booking page

A **venue collective** puts two or more linked venues on one public booking page, with one set of services that the host venue manages. It needs a link that is fully open in **both** directions: full booking detail, create, edit and cancel, and no limit to particular calendars. Creating one, joining one, and running the page are covered in [Run several venues as one collective](/help/getting-started/venue-collectives).

> **Good to know:** a collective never changes your links. Leaving or ending one leaves every link, and the access it gives, exactly as it is.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| The **Linked Accounts** tab is missing | You are not an admin | Only an admin can set up a link. Ask an owner or admin |
| **Send link request** will not go through | Your subscription lapsed or a payment failed | Sort your card out under **Settings**, then **Plan** |
| A venue shows as **Unavailable** | Their plan cannot link, their subscription is inactive, or you are linked already | Ask them to check their plan |
| I gave away more than I meant to | Picking full booking detail also grants contact details and edit rights | Use **Reduce access now**. It applies immediately without their agreement |
| No **New booking** button on a partner's column | They granted view or edit only, not create | Ask them to set **Booking actions** to **Create, edit and cancel bookings** |
| Linked columns have vanished from the calendar | They are switched off in the filter | Click **Filter**, then tick **All linked calendars** under **Linked venues** |
| **Create venue collective** is greyed out | The link is not fully open both ways | Open **Edit permissions** and set both sides to full detail and create, edit and cancel, with no calendar limits |
| The **Create venue collective** button has vanished | You are already in a collective, and a venue can only be in one | Leave or dissolve the one you are in first |

## Next steps

- [Using the calendar](/help/getting-started/calendar)
- [Add and manage your team](/help/getting-started/staff)
- [Run several venues as one collective](/help/getting-started/venue-collectives)
- [Your public booking page and embed](/help/getting-started/public-booking-page)`,
};
