import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: 'import-issues',
  title: 'Data import problems',
  description: 'A stuck wizard step, validation you cannot clear, ambiguous dates, a part-finished run, and the 24-hour undo.',
  tags: ['import', 'csv', 'errors'],
  verified: '2026-09-06',
  content: `
# Data import problems

Most import trouble is caught before anything is written to your venue. The wizard will not let you past a step while something is unresolved, so a stuck step is usually the system protecting your data.

## I cannot find Data import

It is not a tab and it is not in the sidebar. Sign in as an **admin**, open **Settings**, stay on the **Profile** tab, scroll to **Data import**, and click **Open Data Import**. Team member logins cannot see it or run it.

## Continue is locked on Upload

Every file needs a label: **Client list**, **Booking history** or **Staff list**. A file left as **Not sure** blocks the step. A file laid out as a printed report rather than a table is reorganised first, which can take a few minutes on a big file, so leave the tab open and wait. Use **Undo (use the original)** if the tidy-up went wrong.

## The importer did not recognise my old system

It does not try to. Your columns are matched to ResNeo fields on **Map**, so any Excel or CSV export works. If the guesses are poor, open **Tell the AI about your data (optional)**, describe your file in plain English, and click **Save & re-run AI mapping**. Anything a file is still missing is listed under **Before you can continue, this file needs:**.

## Validate will not let me through

Settle everything it flags:

- **Ambiguous dates detected** means a date such as 03/04 could be read two ways. Choose **DD/MM/YYYY (UK)** and click **Apply and re-validate**. Get this wrong and every booking lands a month out.
- For clients who already exist, set each row to **Update existing** or **Skip row**, or use **Skip all duplicates**.
- For unreadable emails, choose **Import anyway** or **Skip row**, or **Import all without email where invalid**. **View row** shows the actual line from your file.

**Download report CSV** gives you the whole list to work through offline.

## The import stopped part way

**Importing** runs large files in batches and saves as it goes, so you can leave the page and come back to that step to pick it up. If it ends on **Import failed**, the reason is shown underneath. If it finishes, **Import complete** gives you the counts and **Skipped rows**, plus **Download import report (CSV)** listing what was left out and why.

## Undo, and its 24 hours

A completed import shows **Undo available until** a date and time on the **Data import** screen. The clock starts when the import finishes, not when you approve it. **Undo** deletes the clients, bookings, services, staff and calendars it created, and puts updated clients back as they were, losing any edits you made since.

Past the deadline the button stays on screen but answers **Undo window has expired**, and nothing changes. **Delete** is not a substitute: it only removes the session and its uploaded files, and leaves your data where it is.

## Still stuck

Open **Support** with the session id from the **Data import** screen, the report CSV, and a redacted sample of your original export.

## Next steps

- [Importing your data](/help/getting-started/importing-data)
- [Importing clients and bookings](/help/appointments/data-import)
- [Your contacts (CRM)](/help/getting-started/contacts)
`.trim(),
  markdownRestaurant: `
# Data import problems (Restaurant and Founding Partner)

## Table bookings in CSVs

Restaurant imports often need table or area identifiers to line up with your current floor plan. Treat validation errors about unknown tables seriously; importing anyway can attach bookings to the wrong capacity.

## Validate, execute, report

The flow matches Appointments venues: **Validate**, fix rows, **Execute**, then read the **report CSV** for skipped lines or warnings.

## 24 hour undo

Completed imports keep **Undo** available until **24 hours** after completion. After that, use manual tools or a carefully planned second import.

## Admin only

**Data import** remains under **Settings** for **admins** only.

## Support

Send **Support** (\`/dashboard/support\`) the session id, report CSV, and a redacted sample of the source export.
`.trim(),
};
