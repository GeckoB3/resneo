import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: "importing-data",
  helpSection: "gs-grow",
  title: "Importing your data",
  description: "Bring your clients and bookings over from a spreadsheet in a few guided steps, with a 24-hour undo if anything looks off.",
  tags: ["import","data","csv","excel","migration","clients","bookings","undo"],
  verified: '2026-09-06',
  content: `# Importing your data

Bring your client list and booking history across from your old system. ResNeo matches your columns for you, checks the file, and gives you 24 hours to undo the whole thing.

## Before you start

1. Back up what you already have. Open **Settings**, then the **Reports** tab, and use **Export all appointments** and **Export client list**. Keep both files safe.
2. Open the importer. Click **Settings**, stay on the **Profile** tab, and scroll to the bottom. Under **Data import**, click **Open Data Import**. There is no Data Import tab and no sidebar link.
3. You need an admin login. **Data import** is hidden from staff logins.

> **Tip:** you do not need a special export. Excel workbooks (.xlsx and .xls) and CSV files from any salon or clinic system work, including files with title rows, several sheets, or odd characters. Your columns are matched to ResNeo fields on the next step, so the system you came from does not need to be recognised.

What each file must contain:

- A **Client list** needs a name column. One combined full-name column is fine, ResNeo splits it into first and last name.
- A **Booking history** needs a **Booking date**, a **Booking time**, and at least one way to identify who each booking is for: their email, their phone, an ID from your old system, or a name. A single combined date and time column covers both the date and the time.
- A **Staff list** needs a **Staff member name**.

A service name and a staff name on your bookings make the result far more useful, but they are not required.

## Do a small test first

Do not import three years of history on your first go.

1. Save a copy of your spreadsheet.
2. Delete everything except the header row and about twenty client rows.
3. Import that copy all the way through.
4. Open **Contacts** and check a few of them. Are names split correctly? Phone numbers right? Dates read as UK dates?
5. Undo the test, fix your file, then run the full import.

## Step 1: Start an import

On the **Data import** screen, click **Start new import**. That opens the wizard at **Upload**.

The same screen lists every import you have run, so you can pick one up again. Each row has:

- **Continue** to go back into a wizard you have not finished.
- **Resume import** if an import is still running.
- **Report CSV** and **Undo** once it is complete.
- **Delete** to take a session off the list.

**Delete** only clears the session and its uploaded files. It does not remove anything already written into your venue, so use **Undo** for that.

## Step 2: Work through the wizard

Six steps, numbered across the top so you always know where you are: **Upload**, **Map**, **Review**, **Services & staff**, **Validate**, **Import**. **Back to imports** takes you out at any point, and your progress is saved.

:::help-figure import-flow

### 1. Upload

Drop your files on **Upload your files**, or click to browse. You can add several at once, and each sheet in a workbook is read separately.

Label each file **Client list**, **Booking history** or **Staff list**. ResNeo usually detects this and pre-fills it, so most of the time you are just confirming. Leave a file as **Not sure** and you cannot continue.

**Remove** takes a file back off. Open **What can I import?** for **Supported sources** and two sample files, **Download a sample clients CSV** and **Download a sample bookings CSV**.

> **Tip:** if a file holds both bookings and client details, and most do, label it **Booking history**. The client details come across too.

**Continue** stays locked until every file has a label. If a file is laid out as a printed report rather than a table, ResNeo reorganises it first and shows you the result, with **Undo (use the original)** if the tidy-up went wrong. That can take a few minutes on a big file, so keep the tab open.

### 2. Map

**Map columns** matches your columns to ResNeo fields automatically, and your job is to check the result. Drag a column onto a field to change it, use the dropdowns, or split a combined column such as a full name into parts.

:::help-figure import-mapping

If the guesses are poor, open **Tell the AI about your data (optional)**, describe your file in plain English, and click **Save & re-run AI mapping**. **Re-run AI mapping** does the current file again on its own.

> **Tip:** if a file is missing something it needs, ResNeo lists it under **Before you can continue, this file needs:**.

### 3. Review

**Review** shows every column with its **Sample**, **Action** and **Detail**. Each one is marked **Imported**, **Not imported**, **Custom field** or **Split into fields**, so you can see at a glance what is coming across and what is being left behind.

### 4. Services & staff

**Set up services & staff** lists the service names, staff names and anything else your bookings mention, in tabs. For each one you can:

- **Match** it to something you already have in ResNeo.
- Add it as new, using **Add as new service**, **Add as new practitioner** or **Add as bookable staff**. **Advanced setup** lets you set the length and price as you go.
- **Skip** it, which leaves those bookings out of the import.

Then click **Continue to validation**.

### 5. Validate

ResNeo scans every row for missing fields, duplicates and ambiguous dates, and shows **Your import plan** and a **Validation complete** summary. Large files are checked in the background and your progress is saved, so you can leave and come back.

Settle anything it flags:

1. If dates could be read two ways you will see **Ambiguous dates detected**. Choose **DD/MM/YYYY (UK)** and click **Apply and re-validate**.
2. For clients who already exist, set each row to **Update existing** or **Skip row**, or use the buttons above the list to decide them all at once, including **Skip all duplicates**.
3. For rows with an unreadable email, choose **Import anyway** or **Skip row**, or use **Import all without email where invalid** or **Skip all these rows**.
4. **View row** shows you the actual row from your file if you are not sure.

The import cannot start while any of these are unresolved. **Download report CSV** gives you the full list to work through offline.

> **Good to know:** **Send upcoming reminders for imported bookings** sits near the bottom whenever you are importing bookings, and it is **off by default**. Leave it off and nobody is contacted. Tick it and every imported appointment still in the future sends your normal reminders, by text as well as email if SMS is on, which on a year of history can be a lot of messages and a large bill. Booking confirmations are never resent either way.

Then click **Review & approve**. A **Review & approve import** window sums up what will happen. **Not yet** takes you back, **Approve & start import** goes ahead.

### 6. Import

**Importing** runs large files in batches with a progress bar. You can leave the page and come back to this step to pick it up.

When it finishes you get **Import complete**, the counts of clients and bookings, and **Download import report (CSV)**. If something goes wrong you get **Import failed** with the reason and a link **Back to import history**.

## The 24-hour undo

Once an import finishes, its row on the **Data import** screen shows **Undo available until** a date and time. The clock starts when the import finishes, not when you approve it.

Click **Undo**, confirm "Undo this import? This will revert created records.", and ResNeo reverses the whole session:

- Clients it created are deleted.
- Bookings it created are deleted.
- Clients it updated are put back as they were, so any edits you made since are lost too.
- Services, staff and calendars the import created are deleted.

> **Warning:** after 24 hours the undo stops working, but the **Undo** button stays on screen. Clicking it then says the undo window has expired and nothing changes. Past that point, unwanted records have to be removed by hand.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| I cannot find Data import | It is not a tab, and staff logins do not see it | Sign in as an admin, open **Settings**, stay on **Profile**, scroll to **Data import** and click **Open Data Import** |
| **Continue** is locked on Upload | A file is still labelled **Not sure**, or is still being reorganised | Label every file and wait for the notice to clear |
| Clients or bookings appear twice | The same file was imported twice | Undo the second import within 24 hours, otherwise remove the duplicates by hand |
| An imported booking is on a day I am closed | Imported bookings are not checked against your opening hours | Open it from the calendar and move or cancel it |
| Clients got unexpected reminders | **Send upcoming reminders for imported bookings** was ticked | Undo within 24 hours if you can, and turn the affected messages off under **Settings**, then **Communications** |
| Dates are a month out | The file was read as US dates | Undo, re-import, and choose **DD/MM/YYYY (UK)** |
| **Undo** does nothing | The 24 hours have passed | Remove the records by hand |
| Removing a session did not remove the data | **Delete** only clears the session and its files | Use **Undo** on a completed import instead |

## Next steps

- [Importing clients and bookings](/help/appointments/data-import)
- [Data import problems](/help/troubleshooting/import-issues)
- [Your contacts (CRM)](/help/getting-started/contacts)
- [Set up your services](/help/getting-started/services)`,
};
