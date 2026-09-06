import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: "business-profile",
  helpSection: "gs-set-up",
  title: "Set up your business profile",
  description: "Add your business details, booking address, timezone, logo, and the kinds of bookings you offer, all in a few minutes.",
  tags: ["business profile","settings","venue details","booking page address","slug","timezone","booking models","logo"],
  verified: '2026-09-06',
  content: `# Set up your business profile

Your business profile is the name, address, and contact details clients see when they book, plus the web address of your booking page. Get it right once and it flows through your booking page, your confirmations, and your reminders.

## Before you start

- Sign in as an **admin**. Everything on this page is admin only. If your sidebar shows **Account** rather than **Settings**, you are signed in as a team member.
- Have your business address, a phone number, and an email you actually check.
- Have a logo and a wide photo of your premises ready, as JPEG, PNG, or WebP files under 5MB each.
- Allow about ten minutes. Every field in this article saves automatically as you go, so you can stop and come back.

## Step 1: Fill in your business details

Open **Settings** from the sidebar, then the **Profile** tab.

The top section, **Personal details & security**, is about you rather than your business: a **Your profile** card (your display name, sign-in email, and phone, with a **Save profile** button) and a **Password** card. Scroll past it to the **Venue profile & contact details** section. The card you want is **Business profile**.

:::help-figure profile-form

1. Set your **Name**. This is your trading name, the one clients recognise.
2. Fill in your **Address** in its four boxes: **Building / venue name**, **Street**, **Town / city**, and **Postcode**. This is the address clients walk to, so make it the one on your door. If you leave the building name blank, ResNeo uses your business name in its place so the address reads naturally.
3. Add a **Phone** number. The control on the left of the box shows a flag and dialling code, with the UK (+44) as the default. Click it to search for and pick another country, then type the number as you would dial it locally.
4. Add an **Email**. Client replies to booking confirmations and reminders come back to this address.
5. Add your **Business website** if you have one. It appears on your public booking page. You can type just the domain, for example \`example.com\`, and ResNeo saves a secure https link.
6. Set your **No-show grace period (minutes)**. This is how long after the appointment time you must wait before you can mark someone as a no-show. Anything from 10 to 60, and the default of 15 suits most salons and clinics.

> **Good to know:** there is no Save button on this card. The note under its title says **Edits to these fields save automatically after you pause typing.** About a second after you stop, a strip under the tabs shows **Saving changes…** and then a green **Saved** pill with **Venue profile saved.** It fades after a few seconds.

> **Warning:** if a field is not valid, nothing on the card saves until you fix it. A red message appears under the field (for example **Enter a valid phone number**) and the strip shows **Not saved. Check the highlighted fields.** Fix the field and saving carries on by itself.

## Step 2: Set your timezone

**Timezone** is the last field on the same card, and it decides what time your slots and reminders actually happen.

1. Open the **Timezone** drop-down and choose your zone: **Europe/London** for the UK, **Europe/Dublin** for Ireland. Zones are named after a region and a city, so scroll to yours.
2. It saves automatically like the rest of the card.

> **Good to know:** you can only choose from the list, so you cannot mistype a zone. If the box shows a zone followed by **(not recognised)**, the stored value is not one ResNeo can use. Pick the right zone from the list and it saves.

## Step 3: Choose your booking page address

This is the last part of your public link, so pick it before you share anything. It lives on the **Booking Page** tab, not the Profile tab.

:::help-figure profile-slug

1. In **Settings**, open the **Booking Page** tab. Under the **URL & branding** heading is the **Your booking page** card. Its **Public booking page** box shows your full link, with an **Open booking page in a new tab** link beneath.
2. In the **Book now** section of that card, find **Booking page address**. The grey \`/book/\` in front of the box is part of your link.
3. Type the name you want, in lowercase, using hyphens instead of spaces. For example \`sharps-barbers\`.
4. Wait a second for the check underneath. You will see **This address is available.** or **This address is already in use. Choose a different one before it can be saved.**
5. When it says available, stop typing. It saves on its own and the strip under the tabs confirms with **Booking page address saved.** The note then changes to **This is your current booking page address.**

> **Good to know:** type \`sharps-barbers\` and your booking link becomes \`.../book/sharps-barbers\`. Spaces, capitals, or symbols are refused with **Lowercase letters, numbers and hyphens only**.

> **Warning:** changing this later breaks every link and printed QR code that used the old address. Pick it now, before you put it on a card or a shop window.

## Step 4: Add your logo and cover photo

These sit just below the address, in the same **Book now** section of the **Your booking page** card.

1. Under **Logo**, click **Upload logo** and choose your file. Once it is up, you can drag the logo to reposition it, click **Change logo** to swap it, or **Remove logo**. It appears on your booking page and in client emails.
2. Under **Cover photo**, choose a layout first: **Full width** spans the whole screen and suits wide photos; **Contained width** keeps the photo the same width as your booking content. Then click **Upload photo**.
3. With a cover photo in place you also get **Change photo**, **Crop photo** (later **Edit crop** and **Reset crop**), and **Remove photo**.

Each upload saves as soon as it finishes; the strip confirms with **Logo updated.** or **Cover photo updated.**

> **Good to know:** JPEG, PNG, or WebP only, and under 5MB each. Anything else is refused with **Invalid type; use JPEG, PNG or WebP** or **File too large (max 5MB)**. Photos straight from an iPhone are often HEIC files, so convert them to JPEG first.

## Step 5: Check what you sell

Still in **Settings**, open the **Booking Settings** tab. Under the **Models on your public page** heading is the **Booking models** card.

:::help-figure profile-models

If you take appointments, tick **Appointments & services** and nothing else. Only add **Ticketed events**, **Classes & sessions**, or **Resources & facilities** if you genuinely sell them, because each one adds its own tools to your sidebar and its own setup to finish. A **Set up →** link appears beside each ticked model and jumps straight to its screen.

Ticks save on their own. The note under the list reads **Changes will save automatically in a moment.** and then **All booking type changes are saved.**, and the strip shows **Booking types saved.**

> **Good to know:** you cannot untick your last remaining model. Something has to be bookable, so if you are switching, tick the new one first.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| **Venue profile saved.** never appears | A field is not valid, so the card has stopped saving | Look for the red message under a field and the strip reading **Not saved. Check the highlighted fields.** Fix that field and saving resumes |
| I cannot find the booking page address on the Profile tab | It lives on the **Booking Page** tab | Open **Settings → Booking Page**, then the **Book now** section of the **Your booking page** card |
| The booking address says it is in use | Another venue already has it | Choose a different address. You will see **This address is available.** when it is free |
| The booking address shows **Lowercase letters, numbers and hyphens only** | It has spaces, capitals, or symbols | Use lowercase letters, numbers, and hyphens only |
| My photo is refused | It is not a JPEG, PNG, or WebP, or it is over 5MB | Convert it (HEIC photos from an iPhone are the usual culprit) or shrink it, then upload again |
| My times look an hour out | The wrong zone is chosen, or the box says **(not recognised)** | Pick the right zone from the **Timezone** list, **Europe/London** for the UK |
| I cannot untick a booking model | It is the only one ticked | Tick the model you want first, then untick the old one |
| I cannot see **Settings** at all | You are signed in as a team member | Team members get **Account** instead. Ask an admin |

## Next steps

- [Set up your services](/help/getting-started/services)
- [Business & calendar hours](/help/getting-started/business-and-calendar-hours)
- [Your public booking page and embed](/help/getting-started/public-booking-page)
- [Connect Stripe to take payments](/help/getting-started/stripe-payments)`,
};
