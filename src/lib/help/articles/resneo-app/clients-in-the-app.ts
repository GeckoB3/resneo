import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: "clients-in-the-app",
  title: "Clients and contacts in the app",
  description: "Search, filter and tag your client list from your phone, then open a client to call, message, book, edit and see their records.",
  tags: ["app","mobile","contacts","clients","tags","export","merge","gdpr","documents","household"],
  verified: '2026-09-06',
  content: `# Clients and contacts in the app

Your whole client list travels with you. **Contacts** is the third tab along the bottom of the ResNeo app, and it holds the same people as **Contacts** on the web dashboard. Search someone before they reach the desk, tap **Call**, take a booking, or add a note while it is still fresh.

## Before you start

- Sign in to the app with your own staff login. Everything you change here saves to your venue straight away and shows on the web dashboard.
- The app cannot save while your phone has no signal. A banner tells you that you are offline and that changes will not save until you reconnect.
- Some tools are for admin logins only: **Export CSV**, **Import contacts**, the bulk **Tag**, **Remove tag** and **Message** buttons, **Merge duplicate**, and the data tools under **Admin** on a client. Staff logins can still search, open, edit, message and book anybody.

## Step 1: Find someone

1. Tap **Contacts**.
2. Type into **Search clients by name, phone, or email**. You need at least two characters, and the list catches up a moment after you stop typing.
3. Or scroll. The list loads 50 people at a time and pulls in the next 50 as you reach the bottom. When there are no more, the footer says how many are loaded.

Above the list, a small green dot means the app is receiving live updates, and the line beside it counts how many of your contacts are on screen. Pull down on the list to refresh it by hand.

Each row shows the person's name, their phone or email, up to three tags, their number of visits and either their next booking or their last visit. A red pill counts their no-shows.

> **Good to know:** swipe a row that has a phone number to reveal **Call** and **Text** without opening the client at all.

## Step 2: Sort the list, or jump to a letter

The row of chips under the search box sorts the list: **Recent first**, **Oldest first**, **Name A–Z**, **Name Z–A**, **Most visits** and **Recently added**.

Pick one of the two name sorts and two extras appear: sticky letter headings through the list, and an A to Z rail down the right-hand edge. Tap a letter on the rail to jump straight to it.

## Step 3: Narrow the list with the filter

Tap the filter button to the right of the search box to open **Filter contacts**.

- **Who to include**: **With contact details** (people with a name plus an email or phone), **All**, or **Anonymous only**.
- **Smart list**: **Everyone**, **New this period**, **Upcoming visit**, **By last visit**, **Marketing consent**, **By last staff**, **By last service** or **By tag**. A line under your choice explains exactly what it includes.
- **Tag**, **Last seen by** and **Last service booked** appear when the matching smart list needs them.
- **Date range**, to narrow the smart list to a window.
- **Consent status**: **Subscribed** or **Not subscribed**.

Tap **Apply** to use the filter, or **Reset** to clear it. Everything you applied then sits above the list as chips you can tap to remove one at a time, including your search text.

## Step 4: Work on several people at once

1. Press and hold any row. A tick appears on every row and a bar slides up from the bottom.
2. Tap more rows to add them, or use the select-all control in the bar.
3. Choose **Tag**, **Remove tag** or **Message**. These three are admin only.

**Tag** and **Remove tag** each ask for one tag and apply it to everyone selected. **Message** sends a marketing broadcast: pick **Email**, **SMS** or **Both**, write a **Subject** and a **Message**, and tap **Send**. Only people who have given marketing consent and have the matching contact detail on file will receive it, and the app tells you afterwards how many were messaged and how many were skipped. To message one person directly, open their profile instead.

## Step 5: Add a contact

1. Tap the round button in the bottom right of **Contacts**.
2. Fill in **First name**, **Last name**, **Email** and **Phone**. You need at least one of them.
3. Tap **Add client**.

If the email or phone already belongs to somebody, the app opens that existing record instead of creating a second one.

## Step 6: Open a client

Tap a row to open the client. The top card shows their name, their contact details, their tags and any no-show count, with quick actions underneath:

- **Call** (only when a phone number is on file)
- **Message** (opens a sheet where you write a short message and choose email, SMS or both)
- **Email** (only when an email address is on file)
- **Edit**

**Edit** opens every detail in one sheet: **First name**, **Last name**, **Phone**, **Email**, **Tags (comma separated)**, **Notes**, **Address line 1**, **Address line 2**, **City / town**, **Postcode**, and switches for **Marketing consent** and **Opted out**. Tap **Save**.

Below the top card you will find:

- An **Address** card, shown only when an address has been captured.
- Four figures: **Bookings**, **No-shows**, **Cancelled** and **Deposits**.
- A **Notes** card. These are your team's notes about the client, not the notes on a single booking.
- A **Tags** editor. Tap **Add a tag** to type one, or tap a tag's cross to remove it.

## Step 7: Book them in, and read their history

**New booking for this client** opens the booking form with this person already filled in, so you go straight to choosing a service and a time.

**Guest bookings** below it is closed until you tap it. Its header counts what is behind it, and opening it splits their visits into **Upcoming** and **Previous**. Tap any visit to open its details without leaving the client.

## Step 8: More details

Under the **More details** heading sit the rest of the client's record, each one closed until you tap it:

- **Marketing preferences**, with the same two switches as the edit sheet and the date consent was recorded. Tapping a switch saves it there and then.
- **Custom fields**, if your venue has any. Fill them in and tap **Save custom fields**.
- **Household**, for linking family members or a carer. Tap **Link member**, search by at least two characters, and tap **Link**. Tap anyone in the household to jump to their record.
- **Records**, which holds their documents and photos. **Add photos** takes them from your photo library and **Add files** from your files. Photos, PDFs, Word and Excel files are accepted, up to 10 MB each. Photos are resized as they upload. Photos and PDFs open in the app; anything else downloads.
- **Compliance**, when compliance records are switched on for your venue. It lists any forms awaiting the client, every record on file with its result and expiry date, and an audit trail. See [Compliance in the app](/help/resneo-app/compliance-in-the-app).
- **Message history**, listing everything sent to this person and whether it arrived.
- **Activity**, a timeline of what has happened on their record.

## Admin only: merge and erase

Admins see one more card at the very bottom, **Admin**, closed by default.

**Merge duplicate** joins two records into one, and cannot be undone. It walks through four steps:

1. Search for and pick the duplicate profile.
2. Choose which record to keep. The other is deleted and its bookings, history and loyalty move across.
3. Resolve any fields where the two disagree. Tags can be combined.
4. Review the merged profile, then tap **Merge now**.

**GDPR (admin)** holds two buttons. **Export data (JSON)** shares a structured copy of everything held about the person. **Erase data** permanently anonymises their name, email, phone and notes, keeping the booking history without a name on it. It asks twice: **Continue** on the first sheet, then **Yes, erase permanently** on **Final confirmation**.

## Admin only: export and import

Two more chips sit at the end of the sort row for admins.

- **Export CSV** exports exactly what your current search, sort and filters are showing, one row per contact plus a column for each active custom field, and hands it to your phone's share sheet. Very large lists are capped at 5,000 contacts and the app tells you when that happens.
- **Import contacts** opens the web data import tool in a browser. The import wizard is not built into the app. See [Importing your data](/help/getting-started/importing-data).

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| Nothing happens when I type in the search box | Fewer than two characters | The app tells you to type at least two characters, then searches on its own |
| I cannot see the A to Z rail | You are on a sort other than a name sort, or too few letters are loaded | Tap **Name A–Z** or **Name Z–A** |
| The list looks short | Only the first 50 are loaded | Keep scrolling, or pull down to refresh |
| **Tag**, **Remove tag** and **Message** are missing when I select rows | You are signed in as staff, not an admin | Ask an admin to run the bulk action |
| A bulk message says contacts were skipped | Those people have no marketing consent, or no email or phone on file | Open them one at a time and use **Message** on their profile |
| **Call** or **Email** is not on a client's card | There is no phone number or email address on file | Tap **Edit** and add one |
| A file will not upload to **Records** | It is over 10 MB, or not a photo, PDF, Word or Excel file | Compress a large scan, or convert it |
| I added someone and an existing record opened | The email or phone matched somebody already in your list | That is deliberate, so you do not end up with duplicates |
| Nothing saves and a banner mentions being offline | Your phone has no connection | Reconnect and try again; the app does not queue changes |

## Next steps

- [Hours, breaks, leave and blocks in the app](/help/resneo-app/availability-in-the-app)
- [Compliance in the app](/help/resneo-app/compliance-in-the-app)
- [Your client list (Contacts)](/help/getting-started/contacts)
- [Taking a booking](/help/getting-started/new-booking)`,
};
