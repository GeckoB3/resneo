import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: "contacts",
  helpSection: "gs-run",
  title: "Your contacts (CRM)",
  description: "See every client's visits, bookings, and contact details in one place, and reach them in a click.",
  tags: ["contacts","crm","guests","tags","segments","merge","messaging","bulk message","marketing permission","marketing consent","opt out","skipped","rebooking","gdpr","documents","export"],
  verified: '2026-09-12',
  content: `# Your contacts (CRM)

**Contacts** is your client book: who they are, what they have booked, what you have sent them, and what you know about them. Open it from **Contacts** in the sidebar. Everyone on your team can use it, and the list keeps itself up to date as bookings come in.

## Before you start

- Contacts are created for you when someone books. You rarely need to add one by hand.
- Three actions are admin only: **Merge…**, **Erase data**, and **Download data export (JSON)**.
- The screen uses your venue's word for clients, so your buttons may say **New client**, **New guest** or **New member**. This article says "client".

## Reading a contact row

Each row shows the name, then the phone and email where you have them. Underneath sit small pills: how many visits they have made (with a red **NS** count inside the same pill when they have missed appointments), when they last came in, a blue pill for their next booking, and up to three tags. If they have more than three tags, a small counter shows how many are hidden. Walk-ins with no details show as **Anonymous**.

:::help-figure contacts-row

## Find someone

1. Click the magnifying glass in the toolbar and type into **Name, phone, or email**. Two characters are enough to start. **Clear search** puts everyone back.
2. Click **Filters** to choose who appears. There are two settings, described below.
3. Click the sort button (it shows the sort you are on) to change the order: **Last visit (newest)**, **Last visit (oldest)**, **Name (A to Z)**, **Name (Z to A)**, **Most visits**, or **Recently added**.
4. Click **25 / page** to show **25**, **50**, **100** or **250** contacts at a time. ResNeo remembers your choice on this device.

The chips above the list tell you what is on: the size of your directory, the page you are on, and any **Filter**, **Show** or **Search** you have applied.

### Who to include

This is the first section in **Filters**, and it decides who can appear at all.

- **Saved contact details** (the default): people with a name plus an email or phone you can reach.
- **All identified guests**: everyone ResNeo can recognise. Anonymous walk-ins stay hidden.
- **Walk-ins only**: guests with no saved contact details, useful for reviewing anonymous visits.

### Smart lists

Underneath, **Smart lists** narrows things further. Leave it on **Everyone** if the setting above is all you need.

- **New this period**: added within your dates. Leave the dates blank for this month so far.
- **Has an upcoming visit**: has a future booking in the date range. Leave the dates blank to look a year ahead.
- **By last visit**: their last visit falls in the range you set. Set at least one date.
- **Marketing consent**: choose **Subscribed** or **Not subscribed**, and optionally when the consent was saved.
- **Last booking staff member**: their latest booking was with the **Team member** you pick.
- **Last booked service**: their latest booking included the **Service name** you pick.
- **Filter by tag**: type a tag or choose one of your venue's existing tags. Capital letters do not matter.

Whichever you choose, the matching box appears below it: **Tag**, **Dates** (**Starting** and **Ending**), **Marketing consent**, **Staff member** or **Service**. **Clear filters** at the bottom of the panel resets everything, and **Done** closes it.

> **Tip:** the **Filters** button reads **Filters (active)** whenever something is narrowing the list.

## Open a contact

Click a row to open the full profile underneath it. The top card and the row of actions are always visible; the sections below them are folded, each showing a one-line summary until you click its heading.

:::help-figure contacts-detail

1. At the top sits the name with a visits pill (it says **New** for someone who has not been in yet), a no-show pill where there are no-shows, and a count of bookings on file. **Call** and **Email** buttons appear where you have the details.
2. Below are **First name**, **Surname**, **Email**, **Phone**, **Last visit** and **Next visit**, plus **Address** where one is saved. Click **Edit** to change them, then **Save changes**.
3. **Tags** and **Customer info** sit at the bottom of that card. Tags save the moment you add or remove one. **Customer info** is a private staff note, good for allergies, accessibility needs or payment preferences.
4. Open **Guest bookings** for their history, split into **Upcoming** and **Previous**. Each row carries a pill saying how the booking was made, **Online**, **Phone** or **Walk-in**, and most have a **Rebook** button that starts a new booking with the same details.
5. Open **Preferences** for **Marketing preferences** (the tick boxes **Opt out of marketing** and **Marketing consent**, saved with **Save marketing preferences**) and **Household**.
6. Open **Records** for their documents and photos.
7. Open **Compliance** to see their patch tests, consents and intake forms. This section only appears when compliance records are switched on for your venue.
8. Open **Messages & privacy** to message them, read what you have sent, and download their data. It opens by itself when there are already messages on file.

**New booking** sits in the row of actions under that card and books them in with their details filled in.

> **Good to know:** confirmations, reminders and other booking messages still go out to someone who has opted out of marketing. The marketing settings govern marketing sends.

## Add a contact by hand

Click **New client** at the top right, fill in **First name**, **Last name**, **Email** and **Phone**, then click **Add client**. A name on its own is enough, though a contact with no email or phone only appears under **All identified guests**, not the default view. If the email or phone already belongs to someone, ResNeo opens their existing record instead of creating a second one.

## Documents and photos

Open **Records** on a contact to keep files against the person rather than one booking, so the same files show on their bookings too.

1. Click **Add documents or photos** and pick one or several files.
2. Photos, PDFs, Word and Excel files are accepted, up to **10 MB** each. Photos are resized as they upload, so a photo straight off a phone is fine.
3. Click a thumbnail to view it. Photos and PDFs open in a viewer without downloading; anything else downloads.
4. **Download** saves a copy. **Remove** deletes the file after a confirmation, and cannot be undone.

## Household and linked contacts

**Household** inside **Preferences** shows any household this person belongs to and who else is in it, with the main contact marked as primary. To link two people you paste the other contact's ID into the box and click **Link to household**. Most venues never need this.

## Message a client

1. Open **Messages & privacy**.
2. Choose **Send via**: **Email & SMS (if available)**, **Email only**, or **SMS only**.
3. Write the message and click **Send**.

Everything you send is listed in **Message log** underneath, with the channel, whether it was delivered, and when. If the person has nothing on file for the channel you picked, ResNeo tells you rather than sending.

## Work with several contacts at once

1. Tick the box on each row you want, or use **Select all on page** to tick everyone shown.
2. A bar appears saying how many are selected, with **Add tag…**, **Message** and **Clear selection**.
3. **Add tag…** applies one tag to all of them. Type a new tag or click one of your **Existing tags**.
4. **Message** sends the same message to each of them. Pick a **Channel**, write the **Message**, then click **Send**. Anyone without an email or phone for that channel is skipped, and you are told who.

> **Important: a bulk message from Contacts counts as marketing.** Ticking several contacts and clicking **Message** only sends to the people who have given marketing permission, which means **Marketing consent** is ticked and **Opt out of marketing** is not (both under **Preferences**). The rest are skipped, and the confirmation says how many, for example "Message sent to 12 clients, 3 skipped (no marketing permission)". If none of them has given permission, nothing is sent at all and ResNeo says so.
>
> Messaging one person from their own record always sends, and so does messaging from a booking. Those are about a booking they have made, not marketing.

Changing a filter, a page or the search clears your selection, so finish a bulk action before moving on.

## Merge two records

If the same person appears twice, open one, click **Merge…**, and work through the four steps. This is admin only.

1. Search by name, email or phone for the other profile, and pick it.
2. Read what the merge does, then continue.
3. Choose which value to keep for **First name**, **Surname**, **Email**, **Mobile / phone** and the guest profile note. For **Tags**, **Combine both** keeps everything from both records.
4. Click **Review**, check the summary, then click **Merge now**.

Bookings, messages, documents and household links move onto the record you kept, and the other record is deleted. Names already printed on past confirmations are not rewritten.

> **Warning:** merging cannot be undone.

## Erase someone's personal data

If someone asks you to delete their details, open their record and click **Erase data**, then confirm in **Erase personal data?**. This is admin only and cannot be undone.

- Their bookings stay on record (dates, status, deposits) so your reporting still adds up.
- Their name, email, phone, notes and requests on those bookings are cleared.
- Message logs, uploaded documents, household links and marketing consent history go.
- The profile itself is wiped and marketing is opted out.

Before you erase, you can save a copy for your records: open **Messages & privacy** and click **Download data export (JSON)** under **Privacy & data**.

## Export your list

Click **Export** for a CSV you can open in Excel or Numbers. It includes names, email, phone, tags, visits, no-shows, last visit, total bookings, upcoming and cancelled counts, deposits paid and marketing consent. Whatever search, filters and sort you have on are applied to the file, not just the page you are looking at.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| I cannot find a client | A filter or smart list is narrowing the view | Open **Filters**, click **Clear filters**, then search again |
| The list says **Choose a tag** or **Choose visit dates** | That smart list needs one more detail before it can run | Open **Filters** and fill in the box under **Smart lists** |
| A section looks empty | The sections are folded until you open them | Click the section heading, such as **Records** or **Preferences** |
| The same person is in twice | They booked with two different emails or phone numbers | Open one and use **Merge…** |
| My export is missing people | Exports follow your current search and filters | Clear the filters, then export again |
| I cannot see **Merge…**, **Erase data** or the data export | All three are admin only | Ask an admin |
| A client shows as **Anonymous** | They were a walk-in with no details saved | Set **Who to include** to **Walk-ins only**, open their row and use **Edit** to add their details |
| A file will not upload | It is over **10 MB**, or a type ResNeo does not store | Compress the PDF or scan, or save it as a photo, PDF, Word or Excel file |
| My message did not send | There is no email or phone on file for the channel you chose | Use **Edit** to add the missing detail, or pick a different **Send via** option |

## Next steps

- [Taking a booking](/help/getting-started/new-booking)
- [Compliance: patch tests, consent and intake forms](/help/getting-started/compliance)
- [Guest communications (email and SMS)](/help/getting-started/communications)
- [Importing your data](/help/getting-started/importing-data)`,
};
