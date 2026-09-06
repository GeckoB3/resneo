import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: 'data-import',
  helpSection: 'growth',
  title: 'Importing clients and bookings',
  description: 'Where the importer lives, what each of the six wizard steps does, how duplicates and odd dates are settled, and how the 24-hour undo differs from deleting a session.',
  tags: ['import', 'csv', 'migration', 'admin'],
  verified: '2026-09-06',
  content: `
# Importing clients and bookings

Bring your client list and booking history across from your old system. ResNeo reads your spreadsheet, matches your columns to its own fields, checks every row with you, and gives you 24 hours to undo the whole import.

## Before you start

- **Admins only.** Data import is hidden from team member logins. Ask an admin to run it rather than sending files round.
- **Open the importer.** Click **Settings**, stay on the **Profile** tab, and scroll to the bottom. Under **Data import**, click **Open Data Import**. There is no Data import tab and no sidebar link.
- **Back up what you already have.** Under **Settings → Reports**, use **Export all appointments** and **Export client list**, and keep both files.
- **Any spreadsheet will do.** Excel workbooks (.xlsx and .xls) and CSV exports both work, including files with title rows, several sheets, or unusual characters. ResNeo does not need to recognise the system you came from, because your columns are matched on the next step.

What each file must contain:

- A **Client list** needs a name column. One combined full-name column is fine, ResNeo splits it.
- A **Booking history** needs a booking date, a booking time, and at least one way to identify the client: email, phone, an ID from your old system, or a name. One combined date and time column covers both.
- A **Staff list** needs a staff member name.

A service name and a staff name on your bookings make the result far more useful, but neither is required.

> **Tip:** import about twenty client rows first, check them in **Contacts**, then undo that test and run the real file. It is much cheaper than fixing three years of history afterwards.

## The import hub

The **Data import** screen lists every import you have run and has **Start new import** in the top right. Each row shows when it ran, a status, and the counts once it is finished, plus the buttons that apply:

- **Continue** goes back into a wizard you have not finished.
- **Resume import** picks up an import that is still running.
- **Report CSV** and **Undo** appear once it is complete.
- **Delete** takes the session off the list.

**Delete** only clears the session and its uploaded files. It does not remove anything already written into your venue: for that you need **Undo**.

## The six steps

The wizard is numbered across the top: **Upload**, **Map**, **Review**, **Services & staff**, **Validate**, **Import**. **Back to imports** takes you out at any point and your progress is saved.

:::help-figure import-flow

### 1. Upload

Drop your files on **Upload your files**, or click to browse. Several at once is fine, and each sheet in a workbook is read separately.

Label each file **Client list**, **Booking history** or **Staff list**. ResNeo usually detects this and pre-fills it, so mostly you are confirming. A file left as **Not sure** blocks **Continue**. **What can I import?** opens **Supported sources** and two sample files you can download as a guide.

If a file is laid out as a printed report rather than a table, ResNeo reorganises it first and shows you the result, with **Undo (use the original)** if the tidy-up went wrong. That can take a few minutes on a big file.

> **Tip:** if a file holds both bookings and client details, and most do, label it **Booking history**. The client details come across too.

### 2. Map

**Map columns** matches your columns to ResNeo fields automatically, and your job is to check the result. Drag a column onto a field to change it, use the dropdowns, or split a combined column such as a full name.

If the guesses are poor, open **Tell the AI about your data (optional)**, describe your file in plain English, and click **Save & re-run AI mapping**. **Re-run AI mapping** redoes the current file on its own. Anything still missing is listed under **Before you can continue, this file needs:**.

### 3. Review

**Review** lists every column with its **Sample**, **Action** and **Detail**, each marked **Imported**, **Not imported**, **Custom field** or **Split into fields**. This is where you see what is being left behind, before anything is written.

### 4. Services & staff

**Set up services & staff** lists the service and staff names your bookings mention. For each one, **Match** it to something you already have, add it as new (**Advanced setup** lets you set a duration and price as you go), or **Skip** it, which leaves those bookings out. Then click **Continue to validation**.

### 5. Validate

ResNeo scans every row for missing fields, duplicates and ambiguous dates, and shows **Your import plan** and a **Validation complete** summary. Large files are checked in the background, so you can leave and come back.

Settle whatever it flags:

1. **Ambiguous dates detected**: choose **DD/MM/YYYY (UK)** and click **Apply and re-validate**.
2. Clients who already exist: set each row to **Update existing** or **Skip row**, or decide them all at once with the buttons above the list, including **Skip all duplicates**.
3. Rows with an unreadable email: choose **Import anyway** or **Skip row**, or apply the same choice to all of them.
4. **View row** shows you the actual row from your file if you are unsure.

The import cannot start while any of these are unresolved. **Download report CSV** gives you the full list to work through offline.

> **Warning:** **Send upcoming reminders for imported bookings** sits near the bottom whenever bookings are being imported, and it is **off by default**. Leave it off and nobody is contacted. Tick it and every imported appointment still in the future sends your normal reminders, by text as well as email if SMS is on, which on a year of history can be a lot of messages and a large bill. Booking confirmations are never resent either way.

Then click **Review & approve**. A **Review & approve import** window sums up what will happen: **Not yet** takes you back, **Approve & start import** goes ahead.

### 6. Import

Large files run in batches with a progress bar. You can leave the page and come back to this step.

When it finishes you get **Import complete** with the counts of clients (including how many existing ones were updated), bookings and skipped rows, plus **Download import report (CSV)**. If something goes wrong you get **Import failed** with the reason and a link **Back to import history**.

## The 24-hour undo

Once an import finishes, its row shows **Undo available until** a date and time. The clock starts when the import finishes, not when you approve it.

Click **Undo**, confirm "Undo this import? This will revert created records.", and the whole session is reversed:

- Clients it created are deleted.
- Bookings it created are deleted.
- Clients it updated are put back as they were, so any edits you made since are lost too.
- Services, staff and calendars the import created are deleted.

> **Warning:** after 24 hours the undo stops working, but the **Undo** button stays on screen. Clicking it then tells you the window has expired and nothing changes. Past that point, unwanted records have to be removed by hand.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| I cannot find Data import | It is not a tab, and team member logins do not see it | Sign in as an admin, open **Settings**, stay on **Profile**, scroll to **Data import** and click **Open Data Import** |
| **Continue** is locked on Upload | A file is still labelled **Not sure**, or is still being reorganised | Label every file and wait for the notice to clear |
| Dates are a month out | The file was read as US dates | Undo, re-import, and choose **DD/MM/YYYY (UK)** |
| Clients or bookings appear twice | The same file was imported twice | Undo the second import within 24 hours, otherwise remove the duplicates by hand |
| Clients got unexpected reminders | **Send upcoming reminders for imported bookings** was ticked | Undo within 24 hours if you can, and switch the affected messages off under **Settings → Communications** |
| An imported booking is on a day you are closed | Imported bookings are not checked against your opening hours | Open it from the calendar and move or cancel it |
| Removing a session did not remove the data | **Delete** only clears the session and its files | Use **Undo** on a completed import instead |
| **Undo** does nothing | The 24 hours have passed | Remove the records by hand |

If a validation message is hard to follow, copy the exact wording (and the row reference if one is shown) before you ask for help.

## Next steps

- [Importing your data](/help/getting-started/importing-data)
- [Data import problems](/help/troubleshooting/import-issues)
- [Your contacts (CRM)](/help/getting-started/contacts)
- [Exporting all your data](/help/settings/data-export)
`.trim(),
};
