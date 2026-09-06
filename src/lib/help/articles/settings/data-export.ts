import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: 'data-export',
  title: 'Exporting all your data',
  description: 'Whole-venue CSVs, per-report CSVs, the contacts export, one person as JSON, and the import report.',
  tags: ['export', 'csv', 'backup', 'gdpr', 'reports'],
  verified: '2026-09-06',
  content: `
# Exporting all your data

Your data is yours, and you can take a copy at any time. This article covers every way out of ResNeo and who can use each one.

> **The one big idea:** the buttons at the bottom of **Reports** give you the whole venue. Every other export gives you a slice, either a report, a filtered list or one person.

## Where the exports live

Sign in as an **admin** and open **Settings → Reports**. It has two tabs, **Overview** and your client directory.

An old \`/dashboard/reports\` bookmark still works and brings you straight here.

## Everything you have

Scroll to the bottom of the **Overview** tab and find **Export your data**.

- **Export all appointments** downloads every booking your venue has ever had. On a venue that calls them bookings, the button says so.
- **Export client list** downloads every client record. On a guest-facing venue the button reads **Export guest list**.

Both cover the **whole venue**. They ignore the **Date range** at the top of the page, which only applies to the reports in between. Files are built there and then and land in your downloads folder, named for what they hold and the date you took them.

Do this before any big change: a data import, a change of plan, or handing the business on.

## One report at a time

Every report card on the **Overview** tab has **Export CSV** in its top right corner. Unlike the two buttons above, these follow the **Date range** you set with **From**, **To** and **Apply**, so they are the ones to use for a month's figures or a quarter's.

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
| **Export all appointments**, **Export client list** | Admins, on **Settings → Reports** |
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
| My export has far more rows than the report above it | **Export all appointments** and **Export client list** always cover the whole venue | Use the **Export CSV** on the report card instead. Those follow the **Date range** |
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
