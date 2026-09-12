import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: "linked-venues",
  helpSection: "gs-grow",
  title: "Link with another venue",
  description: "Share calendars and bookings with another ResNeo venue, and put several linked venues on one combined booking page.",
  tags: ["linked accounts","linked venues","venue collective","combined booking page","chair rental","multi venue","sharing"],
    verified: '2026-09-12',
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

A **venue collective** is a single public booking page covering two or more linked venues under one brand.

Before you can create one, the link must be fully open in **both** directions: full booking detail, create, edit and cancel, and no limit to particular calendars.

1. Open **Settings**, then **Linked Accounts**, and scroll to **Venue collectives**.
2. Click **Create venue collective**.
3. Under **Collective name**, type a name clients will recognise.
4. Under **Booking-page address**, choose the bit that goes after \`/book/c/\`. ResNeo tells you whether the address is free.
5. Under **Invite linked venues**, tick the venues you want.
6. Click **Create collective**.
7. Each venue you invited opens **Settings**, then **Linked Accounts**, and clicks **Accept invitation**. Until they do, their chairs do not appear.

Your combined page works like a single venue: one services menu and one team across all members. Once it is live, the sidebar swaps **Your Booking Page** for a link named after the collective, marked **(combined)**, so your team always shares the right address.

> **Good to know:** a venue can be in one collective at a time. Once you are in one, the **Create venue collective** button disappears rather than greying out. The combined page needs at least two accepted members before it goes live.

### Set up the combined page

The venue that created the collective is the **Host** and is the only one who can edit the page. Once the collective is live, open **Settings**, then **Booking Page**: it opens on the combined page, with three tabs. A switch at the top, **Combined page** or **This venue's own page**, moves you between the shared page and your own. The same editor opens as a window from **Manage combined page** on the Linked Accounts tab.

**Page** is the page designer, the same one you use for your own booking page, plus three things unique to a collective:

- **Page name (shown to customers)**, which you can change at any time.
- **Booking page address**: the full address with **Copy link** and **Open** buttons, then either a **Dedicated address** at \`/book/c/your-address\`, or **Use a member venue's existing booking address**, which puts the combined page on that venue's own address. Be careful with the second: that venue's solo page is then the combined page.
- **Settings that follow the host venue**: the combined page has no settings of its own for the "any available practitioner" and staff-first booking options, the address, phone, website and opening hours in the header, or the currency and wording. Change those in the host venue's own **Settings** and the combined page follows. Prices, durations, deposits and cancellation notice always come from each member venue's own service, because every booking is made with that venue.

Underneath sits **About: contact details and opening hours**, a read-only panel showing the phone, website, address and opening hours the combined page puts in its header and its **About** tab. They are the host venue's, read straight from the host's **Settings → Profile** and **Settings → Business hours**, so a change there shows on the page at once. There is no separate copy to keep up to date, and a member who wants them changed has to ask the host.

> **Important: those opening hours do not decide availability.** They are information for customers. Every linked account still sets its own business hours, closures and calendar hours for its own people, and the combined page offers a time on a calendar only when that calendar's own account says it is free. A calendar at another venue can be open outside the hours shown in the header, or closed inside them. Keep your own venue's hours right under **Settings → Business hours** and each person's under **Calendar Availability**, because those are what bookings into your calendars actually follow.

**Services & calendars** is where you build the menu. **Choose services to offer** lists every bookable service at each member venue: tick the ones you want and add them together. They then appear under **Offerings on your combined page**, where you can open an offering and tick which venues' calendars can take it. You can also type a name to create a custom offering. Categories give the page its headings, and **Match categories from your venues** files anything uncategorised under the heading it already has at its own venue.

When you tick a calendar at a venue that does not yet have the service, ResNeo copies it into that venue. From then on the copy is marked **in step**: its duration, buffer, processing periods and options follow the original whenever that is saved. Price and description stay that venue's own; add-ons are matched each time the copy is linked or updated from the manager. If the venue edits the copy's duration, processing or options itself, the row changes to **customised** and stops following; you can **Re-sync** it (ResNeo asks first), or click **Stop syncing** on any copy to leave it alone for good. When you tick a calendar at a venue that already has a service with the same name, ResNeo asks whether to update that service to match the original and keep it in step; say no and the calendar is added with the service left as it is. Every copy at another venue carries a badge: **Linked to (venue), in step**; **Linked, behind (venue)** with what differs (for example 30 min here, 45 min there); **Not linked**, with whether it differs from the original today; or **Edited at (venue), no longer following**. Beside it is the next step: **Link to (venue)**, **Update from (venue)**, **Relink to (venue)**, or **Unlink**. Linking asks first, then updates the duration, buffer, processing periods, options and add-ons to match the original and keeps the copy following from then on (price and description stay the venue's own); unlinking leaves the copy exactly as it is. **Link all copies** and **Unlink all copies** at the top of the list, and the same pair on each offering, do this for several copies at once.

> **Good to know:** once the collective is live, the **Book again** links in your emails and in a client's ResNeo account point at the combined page rather than each venue's own, so a client following one up sees the whole group's menu.

**Members** lists every venue with **(host)** or **(invited)** beside it. From here the host can **Invite a venue** and click **Send invitation**, **Remove** a member, **Make host** to hand the collective to someone else, or **Dissolve collective**.

Members who are not the host do not get these tabs. Their **Booking Page** tab shows who hosts the page, its address with a **Copy link** button, and which of their calendars are on it. Their services appear using their own price, duration and availability, and they can view the page or use **Leave** on the collective row under Linked Accounts to step out.

### Ending a collective

A member leaves with **Leave**. The host ends the whole thing with **Dissolve collective**, on the **Members** tab. The combined page goes offline straight away, and every venue keeps its own page, bookings and clients. You can create a new collective immediately afterwards. The only wait is on the name: a name another venue's collective was using is held for 30 days, so pick a different one if ResNeo says it is not available yet.

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
| The combined page says it is unavailable | Fewer than two venues have accepted | Ask the invited venues to click **Accept invitation** |
| The collective name is refused | Another venue's collective used it in the last 30 days | Choose a different name |

## Next steps

- [Using the calendar](/help/getting-started/calendar)
- [Add and manage your team](/help/getting-started/staff)
- [Your public booking page and embed](/help/getting-started/public-booking-page)`,
};
