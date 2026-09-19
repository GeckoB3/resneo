import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: 'data-export',
  title: 'Exporting all your data',
  description: 'Whole-venue exports as CSV, Excel or PDF for any dates, per-report CSVs, the contacts export, one person as JSON, and the import report.',
  tags: ['export', 'csv', 'excel', 'pdf', 'backup', 'gdpr', 'reports'],
  verified: '2026-09-19',
  content: `
# Exporting all your data

Your data is yours, and you can take a copy at any time. This article covers every way out of ResNeo and who can use each one.

> **The one big idea:** **Export your data** at the bottom of **Reports** gives you everything, or everything between two dates, as a CSV, an Excel spreadsheet or a PDF. Every other export gives you a slice, either a report, a filtered list or one person.

## Where the exports live

Sign in as an **admin** and open **Settings → Reports**. It has three tabs: **Overview**, **Revenue** and your client directory. The exports that cover your whole venue are on **Overview**.

An old \`/dashboard/reports\` bookmark still works and brings you straight here.

## Everything you have

Scroll to the bottom of the **Overview** tab and find **Export your data**. It asks three things and then gives you one file.

1. **What to export.** Choose **Appointments**, **Clients** or **Services**. On a venue that calls them bookings and guests, the chips say so.
2. **Which dates.** Choose **All time**, **This month**, **Last month**, **This year**, **Last year** or **Custom dates**. Custom dates shows a **From** and a **To** box; the file covers both days and everything between. Appointments are chosen by their appointment date. Clients and services are chosen by the day they were added.
3. **File type.** **CSV** opens in Excel, Numbers and Google Sheets and imports into most other systems. **Excel spreadsheet** gives you a formatted .xlsx workbook with money as numbers. **PDF** is for reading or printing; use CSV or Excel when you want to move your data somewhere else.

Under the choices the page counts what they cover, for example **142 appointments in these dates**, so you know what you are about to download. If there is nothing in the range it says so and the button greys out. Click **Download appointments as CSV** (the button names your choices) and the file lands in your downloads folder, named for your venue, what it holds and the dates.

### What each file contains

Every file carries the full details, so you could rebuild your records somewhere else from it.

- **Appointments**: one row per service booked, with the appointment and visit IDs, date, start and end time, status, type, service and option, add-ons, calendar and staff member, the client's name, email, phone and ID, party size, price, add-ons total, payment state, amount paid, tip, deposit status and amount, Stripe payment reference, source, the collective it was booked through, location and client address, special requests, dietary notes, occasion, internal notes, when and by whom it was booked, arrival and check-in times, who cancelled it, and when the reminder and follow-up went out.
- **Clients**: one row per client, with their ID, first name and surname, email, phone, address, tags, marketing consent and when it was recorded, marketing opt-out, notes, dietary preferences, source, visits, no-shows, last visit, total appointments, upcoming and cancelled counts, paid deposits, first and last booked, waiver signed, whether they have an online account, when they were added, and a column for each custom field you have set up.
- **Services**: one row per service, with its ID, name, category, description, type, duration, buffer and processing time, price and how it is shown, deposit, what must be paid to book, location and online meeting details, whether it is bookable online and active, which calendars offer it (with any per-calendar duration or price), its options, its add-on groups, places per session, booking rules, pre-appointment instructions, colour, sort order, whether it is shared from a collective, and when it was added.

Times in every file are in your venue's time zone. Money columns are in your venue's currency.

Do this before any big change: a data import, a change of plan, or handing the business on. **All time** with **CSV** or **Excel spreadsheet** is the complete backup.

## One report at a time

Every report card on the **Overview** tab has **Export CSV** in its top right corner. These follow the **Date range** you set at the top of the page with **From**, **To** and **Apply**, which is separate from the dates you choose in **Export your data**, so they are the ones to use for a month's figures or a quarter's.

The reports you may see:

- **Appointment activity**: what was created, how many places were booked, and how many were kept, broken down by source and status.
- **By booking type**: appointments against classes, events and resources.
- **Team, services & channels**: who did the work, what was booked, where it came from, and add-on revenue.
- **No-show rate** and **Cancellation rate**: one row per period.
- **Payments & deposits**: collected, refunded, forfeited and no-show fees.
- **Event ticket sales by tier**, when you sell tickets.
- **Resource utilisation**, when you rent rooms or equipment.

If there is nothing in the range, the button greys out and tells you when you click it, for example **There is no appointment activity to export for this period.**

## Your client directory

The second tab of **Reports** has its own **Export CSV** button in the header, which downloads the full client list.

Open a client on that tab and you also get **Export history (CSV)**: every booking that one person has had, with the date, time, service, status, deposit and who they saw.

## The list you are looking at

**Contacts** has its own **Export** button in the toolbar, and it behaves differently on purpose: it downloads exactly the rows your filters and search have left on screen, with tags, visit counts, no-shows, last visit, booking counts, deposits paid and marketing consent.

Use it when you want a slice rather than everything: everyone tagged VIP, everyone with a visit last year, everyone who has agreed to marketing.

This one is not admin only. Anyone on your team who can open **Contacts** can export the list they can see.

## One person's data

When somebody asks for everything you hold on them, open their record in **Contacts**, open **Messages & privacy**, then **Privacy & data**. The **GDPR (admin)** box has **Download data export (JSON)**, which gives you a single structured file for that one person.

Admins only. To anonymise their record afterwards, use **Erase data** on the contact card.

## Other exports around the dashboard

- **Events**: open an event and use **Export CSV** above the attendee list to get everyone booked on it, with their ticket types.
- **Data Import**: each finished import session has a **Report CSV** link telling you exactly what was created, and an **Undo** button while the undo window is still open.

## Who can export what

| Export | Who |
| --- | --- |
| **Export your data** (appointments, clients, services) | Admins, on **Settings → Reports** |
| Per-report **Export CSV** | Admins |
| **Export CSV** and **Export history (CSV)** on the client directory | Admins |
| **Export** in **Contacts** | Anyone who can open **Contacts** |
| **Download data export (JSON)** for one person | Admins |
| **Export CSV** on an event's attendee list | Anyone who can open **Events** |
| **Report CSV** for an import | Admins, since only admins can import |

If someone on your team needs a whole-venue file, they will need to ask an admin, because **Reports** lives inside **Settings**.

## Looking after the files

A CSV of your clients is the most sensitive thing your business owns. Once it leaves ResNeo it is on your computer, with none of the permissions that protected it here.

1. Save it somewhere only you can reach, not a shared desktop or a shared downloads folder.
2. Never email it to yourself or attach it to a chat message.
3. Delete the copy once you have finished with it.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| I cannot find **Reports** | It is a tab inside **Settings**, and admin only | Open **Settings → Reports**. Ask an admin if you do not have it |
| My export has far more rows than the report above it | **Export your data** has its own dates, and **All time** covers the whole venue | Pick the same dates in **Export your data**, or use the **Export CSV** on the report card, which follows the **Date range** |
| An **Export CSV** button is greyed out | There is nothing in the selected range | Widen the range with **From**, **To** and **Apply** |
| Nothing downloaded | Your browser blocked it, or the export failed | Check for a blocked-download notice in the address bar, then try again. A failure shows a message on the page |
| I only want one group of clients | The whole-venue export cannot be filtered | Filter in **Contacts** first, then use **Export** there |
| A client has asked for their data | You need one person, not the venue | Use **Download data export (JSON)** in their record under **Privacy & data** |
| I need to prove what an import changed | The session keeps its own record | Open **Data Import** and use **Report CSV** on that session |

## Next steps

- [Reading your reports](/help/getting-started/reports)
- [Your contacts (CRM)](/help/getting-started/contacts)
- [Importing your data](/help/getting-started/importing-data)
- [Settings overview](/help/settings/overview)
`.trim(),
  markdownRestaurant: `
# Exporting data (Restaurant and Founding Partner)

## Full CSV exports

Admins open **Reports** (\`/dashboard/reports\`, **Overview** tab) and use **Export your data** at the bottom:

- **Export all bookings** → \`/api/venue/export?type=bookings\`.
- **Export all guest records** → \`/api/venue/export?type=guests\`.

These files cover the **entire** venue history available to the API, independent of the chart date picker.

## Chart CSVs

Sections such as booking summary, no shows, cancellations, deposit summary, and **Table utilisation** (only when table management data exists) each include **Download CSV** for the applied range.

## Imports

Use **Settings → Data import** for CSV imports; download the provided session report afterwards if you need proof of what changed.

## Governance

Restaurant exports can include high value guest data. Limit distribution to managers only.
`.trim(),
};
