import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: 'guest-management',
  title: 'Your client records',
  description: 'Contacts is home base: filters, bulk actions and the full profile, plus how Reports and Compliance relate to it.',
  tags: ['guests', 'clients', 'crm', 'contacts', 'tags', 'gdpr', 'bulk message', 'marketing permission', 'marketing consent', 'opt out', 'subscribed'],
  verified: '2026-09-12',
  content: `
# Your client records

Everyone who has ever booked with you has one record, and it lives in **Contacts**.

> **The one big idea:** **Contacts** is home base. **Reports** counts your clients, and **Compliance** tracks their forms, but both point you back here for the actual work.

## Contacts is home base

Open **Contacts** from the sidebar, or go to \`/dashboard/contacts\`. Admins and team members both have it. An old \`/dashboard/guests\` bookmark still works and simply brings you here.

Along the top you have:

- **Search**, for a name, email or phone number.
- **Filters**, **Sort** and a **/ page** control for how many rows you see at a time.
- **New client**, to add somebody by hand.
- **Export**, which downloads exactly the list you are looking at as a CSV.

## Narrowing the list

Click **Filters**. The panel opens in two parts, and **Done** closes it.

**Who to include** comes first, because it decides whether walk-ins appear at all:

- **Saved contact details**: people with a name plus an email or phone you can reach.
- **All identified guests**: everyone ResNeo can recognise. Anonymous walk-ins stay hidden.
- **Walk-ins only**: people with no saved contact details, handy for reviewing anonymous visits.

**Smart lists** then add an optional rule on top: **Everyone**, **New this period**, **Has an upcoming visit**, **By last visit**, **Marketing consent**, **Last booking staff member**, **Last booked service** or **Filter by tag**. Some of them open extra boxes underneath for **Dates**, a **Tag**, or **Subscribed** and **Not subscribed**.

**Sort** offers **Last visit (newest)**, **Last visit (oldest)**, **Name (A to Z)**, **Name (Z to A)**, **Most visits** and **Recently added**.

## Doing something to several people at once

Tick the boxes on the rows you want, or the box at the top of the list to take everyone on this page. A bar appears with the number **selected** and three actions:

- **Add tag…** puts the same tag on all of them.
- **Message** opens one email or text to the lot.
- **Clear selection** starts again.

> **Warning:** a bulk message goes to real people. Check **Who to include** and your **Marketing consent** filter first, so you are only writing to those who agreed to hear from you.

ResNeo backs you up here rather than taking your word for it. A marketing send skips anybody without permission, and the result says why each one was skipped: they opted out, or no consent was recorded. Permission means consent is on file **and** no opt-out stands, so an old consent never outlives an unsubscribe. The **Subscribed** filter counts people the same way.

Ticking several people in the **Contacts** list and clicking **Message** follows the same rule. Messaging one person from their own record, or from a booking, always sends: those are about a booking they have made, not marketing.

## What is inside one record

Click a row to open the full profile.

At the top you get their name, how many visits they have had, any no-shows, and **Customer info**, where a note you write here follows them from booking to booking.

A row of buttons sits underneath: **New booking**, and for admins **Merge…** and **Erase data**.

Below that, sections you can open one at a time:

- **Preferences**: **Marketing preferences** (whether they have agreed to hear from you) and **Household**, for linking family members who book together.
- **Records**: documents and photos kept against the person, not against a single booking.
- **Compliance**: their patch tests, consent forms and intake questionnaires. This only appears once compliance is switched on for your venue.
- **Messages & privacy**: **Send a message** with a channel picker, the **Message log** of everything already sent, and **Privacy & data**.

Their booking history has its own section too, so you can open any past or future booking without leaving the record.

## Duplicates, and erasing someone

Both are admin only.

- **Merge…** opens **Merge duplicate clients**, for when the same person booked twice under two spellings or two phone numbers.
- **Erase data** opens **Erase personal data?**, which anonymises the record. Use it when somebody asks to be forgotten.

Under **Messages & privacy**, **Privacy & data** holds a **GDPR (admin)** box with **Download data export (JSON)**: everything ResNeo holds about that one person, in a file you can send them.

## How Reports relates to this

**Settings → Reports** has a second tab, your client directory, named after whatever you call your clients.

It is a summary, not a replacement. It gives you four counts for the date range you picked: how many clients you know all-time, how many are new this period, how many came back, and how many visits had nobody attached. There is an **Export CSV** for the whole list, and **Export history (CSV)** on an individual client.

The page says so itself: for filters, a CSV of the view you are looking at, and message history, **Open Contacts**.

## How Compliance relates to this

If you use patch tests, consent forms or intake questionnaires, the answers are stored against the client's record and show in their **Compliance** section.

The **Compliance** page in the sidebar is the operational view of the same information: today's check-ins, what is missing for upcoming bookings, what is expiring soon and what you are waiting on. See [Compliance: patch tests, consent and intake forms](/help/getting-started/compliance).

## What ResNeo calls your clients

The words on screen (client, guest, member) come from the business type you picked when you signed up, and they follow through headings, buttons and CSV columns. There is no setting to change them here.

## Looking after the data

Notes, tags and documents can hold sensitive things. Only people you have given a login can read them, and you decide who those people are on **Settings → Staff**.

Two habits worth keeping:

1. Write notes you would be comfortable for the client to read. They have a right to ask for everything you hold.
2. Treat marketing consent as the rule, not a suggestion. The **Marketing consent** filter exists so you can honour it in one click.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| Someone is missing from the list | **Who to include** is set to **Saved contact details** and they are a walk-in with no details | Switch to **All identified guests** or **Walk-ins only** |
| A smart list shows nothing | **By last visit** needs at least one date | Set a starting date, an ending date, or both |
| The same person appears twice | Two records were created from two different spellings or numbers | Open one and use **Merge…**. Admins only |
| I cannot see **Merge…** or **Erase data** | Both are admin only | Ask an admin |
| My export has the wrong people in it | **Export** downloads the list you are currently looking at | Set your filters first, check the row count, then export |
| The **Compliance** section is not there | Compliance is switched off for your venue | Turn it on under **Settings → Compliance**, in **General settings** |
| A client says they never agreed to marketing | Their record says otherwise, or consent was recorded elsewhere | Open **Preferences**, then **Marketing preferences**, and update it |

## Next steps

- [Your contacts (CRM)](/help/getting-started/contacts)
- [Exporting your data](/help/settings/data-export)
- [Reading your reports](/help/getting-started/reports)
- [Compliance: patch tests, consent and intake forms](/help/getting-started/compliance)
`.trim(),
  markdownRestaurant: `
# Guest records (Restaurant and Founding Partner)

## Contacts

**Contacts** (\`/dashboard/contacts\`) remains the shared CRM list for admins and staff who have the link. Use it for phone edits, **tags**, visit counts, and household tools when enabled.

## Reports

Admins should use the second **Reports** tab (\`/dashboard/reports?tab=clients\`, label from **terminology**) when they want summary KPIs or quick exports, then drop into **Contacts** for full detail work, mirroring the in app guidance.

## Table service specifics

Restaurant bookings still attach guest profiles. Internal notes entered while managing **Bookings** or **Day Sheet** sync back to the contact record when the UI offers that field.

## Tags and marketing

Tags are handy for VIPs or dietary flags, not a replacement for consent tracking. Use your own policies before bulk email.
`.trim(),
};
