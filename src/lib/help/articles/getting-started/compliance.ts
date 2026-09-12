import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: "compliance",
  helpSection: "gs-run",
  title: "Compliance: patch tests, consent and intake forms",
  description: "Set up patch tests, consent and intake forms so the right records are collected before each client sits down.",
  tags: ["compliance","patch test","consent","intake","forms","enforcement","expiry","services"],
  verified: '2026-09-12',
  content: `# Compliance: patch tests, consent and intake forms

If some of your services need a patch test, a signed consent, or an intake form before a client sits down, ResNeo can collect those for you, attach them to the right services, and warn or block bookings when a record is missing or out of date.

> **Three words to know:** a **type** is the kind of record you collect, like a patch test. A **requirement** is the link that makes a service ask for it. A **record** is the form a client actually completed, valid until its expiry date.

:::help-figure compliance-concepts

## Before you start

- Compliance records are part of every Appointments plan (Light, Plus and Pro).
- Only an admin can open **Settings → Compliance** or create and edit types. Once compliance is on, everyone on your team can see the **Compliance** page in the sidebar and collect records from a booking.
- While compliance is switched off, none of it appears: no **Compliance** item in the sidebar, no compliance on your bookings, and nothing for your clients.

## Step 1: Turn compliance on

Open **Settings** from the sidebar, then the **Compliance** tab. It opens on **General settings**, with **Templates & types** and **Requirements** alongside it.

1. Tick **Enable compliance records for this venue**. Nothing else works until you do.
2. Choose your **Default form-link channel**, either **Email** or **SMS**. This is how a form link reaches a client. If an SMS cannot be sent, ResNeo emails the link instead so it always arrives.
3. Set your **Reminder cadence (days before expiry)**, which is how many days ahead ResNeo reminds a client to renew. Set it to **0** to turn expiry reminders off.
4. Set your **Form-link expiry (days)**, which is how long a link you send stays usable.
5. Click **Save settings**.

> **You must do this first.** Until compliance is on, the **Templates & types** tab cannot create anything.

## Step 2: Add a type, from the library or from scratch

Go to the **Templates & types** tab.

To use a ready-made form, click **Add from library**. Each template shows its category, how long it lasts and how many questions it has. Click **Preview** to read it, then **Add**. It is copied in as your own type, fully editable, and nothing links back to the original.

To build your own, click **Create custom type**. On the **New compliance type** page:

1. Give it a **Form name** and pick a **Category**: Test, Consent, Intake, Declaration or Certificate.
2. Choose a **Result type**: **Pass / fail (staff decide a result)**, **Signed (requires a signature)**, **Completed (no result)** or **File upload (requires a file)**.
3. Set the **Validity**: **No expiry (lifetime)**, **Per visit (single-use)** or **Expires after N days**.
4. Use the **Captured by** tickboxes to say who can fill it in: **Staff in venue**, **Client online**, or both. Leave **Staff in venue** ticked if you want to complete it on a tablet with the client in front of you.
5. Add a **Description (optional)** and **Intro text (optional, markdown)** if the form needs a preamble.
6. Build the questions. Click a field type on the left to add it: **Short text**, **Long text**, **Dropdown**, **Checkboxes**, **Date**, **Signature** or **File upload**. Each field has a label, optional help text, **Required** and **Staff only** tickboxes, and options where the type needs them. Drag the handle to reorder.
7. Click **Preview as client** to see exactly what the client will see, then **Back to editor**.
8. Click **Create type**.

If you choose the pass or fail result type, ResNeo adds a staff-only **Result (staff decision)** question with **Pass** and **Fail** options and marks which answer means which. Rename it or its options if you like.

Use **Message when a booking is blocked (optional)** when clients cannot complete the form themselves, for example a patch test your team carries out. It is the text they see online instead of a dead end, so tell them what to do next.

Back on the list, each type has **Edit**, **Duplicate** (a copy to change without touching the original) and **Archive**. An archived type keeps its records and shows an **Archived** pill, and **Restore** brings it back.

> **Pick the result type with care.** Most things can be changed later, but the result type is locked once the type is created.

> **Editing saves a new version.** The button reads **Save new version**, and you can note **What changed (optional)**. Records already collected keep the version they were signed on. **Version history** lists every version, and **Restore** brings an older one back as a new current version.

## Step 3: Attach the type to a service, or to all bookings

1. Go to the **Requirements** tab.
2. Click a service to expand it. To ask every client for a form whatever they book, such as a new client intake form, expand **All bookings** at the top instead.
3. Click **Add requirement** and choose the **Compliance type**.
4. Set **When unmet**, which is how strict it is.
5. Set a **Lead time (optional)** if the record must be on file in advance rather than on the day. Type the number of hours. A patch test before colour is usually 48.
6. Set **Online booking** to decide where the client fills it in:
   - **Email a link in the confirmation**: they book, then complete it before the visit.
   - **Show in the booking flow**: they fill it in while booking.
   - **Do not collect online**: your team collects it in the venue.
7. Click **Add requirement** again to save.

Each service shows a **requirements** count, so you can see at a glance which ones ask for something. You can also set a single service's requirements while you are editing it, at the bottom of the service form under **Compliance requirements**.

> **How often a client is asked** comes from the type's **Validity**. No expiry means once per client. Per visit means every booking. A number of days means again after that long.

## Step 4: Choose how strict it is

:::help-figure compliance-enforce

- **Warn staff**: your team sees a flag, nothing is blocked. The client is not told.
- **Warn client**: the client sees a note while booking online but can still book, and your team sees the flag too.
- **Block online booking**: clients cannot book this online without a valid record. Your team can still book them in from the dashboard.
- **Block all bookings**: the same online, and your team sees a red reminder that the record is required before the appointment. Your team is never blocked from making a booking.

> **Start gentle, then tighten.** Many businesses begin with **Warn staff** while they gather records, then move up once most regulars are covered.

## What your clients see

It depends on the **Online booking** setting for that requirement.

- **Show in the booking flow**: once they have typed their email, a **Before you book** panel appears with the form, marked **Required** or **Optional**. They click **Save form**, and it shows as completed with an **Edit** link. A blocking form must be done before they can confirm.
- **Email a link in the confirmation**: the booking goes through, and the confirmation email carries a **Forms to complete** link. The same link is listed on their manage booking page under **Forms to complete before your visit**.
- **Do not collect online**: nothing is shown to them, and your team collects it in the venue.

If a form is needed that they cannot complete online, they see a short notice before they book, headed **Before you can book online** when it blocks, or **Forms needed for this booking** when it only warns. Where a record is already on file, the notice says they are all set. A returning client who used a different email address will look like a new one, and the notice suggests they check with you.

A form link opens a plain ResNeo page with your venue name on it. When they submit, they see a **Thank you** message and can close the page. Links do not last forever, and each one says why it will not open:

- **Already submitted**: the form has already been completed.
- **Link expired**: it passed your **Form-link expiry (days)**.
- **Link no longer active**: someone on your team revoked it.
- **Form not found**: the link is wrong or incomplete.

In every case, send a fresh link from the booking or from the **Compliance** page.

## Collect a record from a booking

On the bookings list, a booking that needs something shows a compliance pill, either **Compliant** or a count of forms due, and the calendar shows a small dot on the booking card. Open the booking and expand **Compliance**.

Under **Requirements for this booking**, each form has:

- **Hand to client**: opens the form on your screen for the client to complete and sign on your device.
- **Capture now**: you fill it in with them or on their behalf, including any staff-only questions.
- **Send link**: sends a secure link by your default channel. If there is no email or phone on file, ResNeo copies the link to your clipboard instead so you can paste it to them.
- **View record**: opens the record you already have.

Under **Form links** you can **Copy link**, **Resend email**, **Resend SMS** or **Revoke** a link that is still waiting. **All compliance records** lists everything on file for that client with a **View** button, and **Audit trail** shows who did what and when.

Opening a record shows the answers, any signature or file, and lets you **Void this record** if it was collected in error. Voiding is permanent and the record stops counting. A pass or fail form completed by the client shows **Awaiting decision** until someone chooses **Pass**, **Fail** or **Inconclusive**.

## Renewals and expiry

When a type has a validity period, its records expire and ResNeo watches the clock. A record in its final 30 days is flagged **Expiring soon**, and one reminder with a fresh link goes out as far ahead as your **Reminder cadence**. Once a record passes its expiry, the service treats it as missing and your strictness setting applies again.

ResNeo also chases a form link a client has not completed in the last few days before their appointment, up to twice, and stops as soon as they submit it.

## Your daily sweep

Click **Compliance** in the sidebar, just below **Contacts**. A line at the top counts what is outstanding, or tells you that you are all caught up.

:::help-figure compliance-dashboard

- **Today's check-ins**: today's bookings with a form still outstanding, grouped by client and shown with their arrival time. Use **Complete now** to hand your device over, or **Send link**.
- **Missing for upcoming bookings**: bookings in the next 14 days needing a record you do not have. Use **Send link**.
- **Expiring soon**: records that expire within 30 days. Use **Send renewal**.
- **Awaiting client submission**: links you have sent that are not completed yet, with the date sent and when the link expires.

> **Make it a habit.** A two-minute glance before you open means nobody arrives for a service they cannot safely have.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| A client cannot book online because a form is missing | The requirement is set to a blocking level | Collect the record with **Capture now** or **Hand to client**, send them a link, or book it for them from the dashboard, where your team is never blocked |
| The **Templates & types** tab asks me to turn compliance on | The feature is still off | Tick **Enable compliance records for this venue** and save |
| A service is not asking for the form | No requirement links the type to that service, or to all bookings | Add one in **Requirements** |
| Clients can still book online without it | The requirement is only set to warn | Change **When unmet** to a blocking level |
| A blocking form is never offered to clients | **Online booking** is set to **Do not collect online**, so nobody can complete it themselves | Choose where it is collected online, or add a **Message when a booking is blocked** on the type telling them what to do |
| No renewal reminders are going out | **Reminder cadence** is set to 0, which turns them off | Set it to the number of days ahead you want |
| A record I just collected still shows as missing | The old one expired, it was captured against a different type, or it was captured too close to the booking to satisfy the **Lead time** | Collect a fresh record, check the requirement points at the right type, and shorten the lead time if it is too strict |
| A completed form still shows **Awaiting decision** | It is a pass or fail type and nobody has recorded the result | Open the record with **View** and choose **Pass**, **Fail** or **Inconclusive** |
| The client says their link will not open | It has been submitted, revoked, or passed your **Form-link expiry (days)** | Send a fresh link from the booking or from the **Compliance** page |
| **Send link** copied a link instead of sending it | There is no email or mobile number on file for that client, or the send failed | Paste the copied link into a message yourself, and add their contact details in **Contacts** |
| I cannot create or edit types | Type management is admin only, and non-admins do not see the **Compliance** tab in Settings | Ask an admin |

## Next steps

- [Set up your services](/help/getting-started/services)
- [Your contacts (CRM)](/help/getting-started/contacts)
- [Using the bookings list](/help/getting-started/bookings-list)`,
};
