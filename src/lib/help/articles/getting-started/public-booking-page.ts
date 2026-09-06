import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: "public-booking-page",
  helpSection: "gs-set-up",
  title: "Your public booking page and embed",
  description: "Share your booking link, add a booking widget to your website, and brand it with your colour and a QR code.",
  tags: ["public booking","embed","widget","qr code","accent colour","booking page address","guests","resize.js"],
  verified: '2026-09-06',
  content: `# Your public booking page and embed

Your booking page is where clients book with you online, day or night. This guide covers finding your link, giving each person their own, branding the page, filling out its tabs, and putting it on your own website.

:::help-video booking-page-setup

## Before you start

Your booking page only shows times once three things are true:

1. You have at least one **calendar**, one per person or chair, added under **Calendar Availability**.
2. That calendar has **working hours** set. See [business & calendar hours](/help/getting-started/business-and-calendar-hours).
3. At least one **service** is offered on that calendar. When you edit a service on the **Services** page, tick the calendar under **Calendars that offer this service**. See [set up your services](/help/getting-started/services).

Miss any one and your page will load and look right, but offer nothing to book.

> Only an admin can change this screen. If your sidebar shows **Account** rather than **Settings**, the page is read only for you, and the **Services** and **Meet the team** groups are hidden.

## Where clients book

Your link is your booking page address with \`/book/\` in front of it.

1. Open **Settings**, then the **Booking Page** tab. Under **URL & branding** sits the **Your booking page** card.
2. At the top of the card, **Public booking page** shows your full link. Select it to copy it, or click **Open booking page in a new tab** to see it as a client would. The sidebar's **Your Booking Page** link opens the same page (it is hidden while your venue is part of a combined booking page).
3. To change your part of the link, use the **Booking page address** field in the **Book now** group just below. Lowercase letters, numbers and hyphens only. As you type, ResNeo checks the address and tells you **This address is available.** or that it is already in use. It saves on its own once it is valid.

:::help-figure public-surfaces

Share it anywhere: your social bios, your Google Business profile, a "Book now" button, posters, or a QR code.

If you have more than one booking type switched on, clients choose the type on the **Book now** tab. To send them straight to one, add \`?tab=\` and the type to the end of your link: \`appointments\`, \`classes\`, \`events\` or \`resources\`, for example \`.../book/sharps-barbers?tab=classes\`.

> Pick your address early. Changing it later breaks every existing link, every per-person link, and every printed QR code, and nothing can redirect the old one.

## Give each person their own link

As well as your main link, every calendar can have its own, so a client lands straight on that person's diary and sees only their times.

1. Open **Calendar Availability** from the sidebar, then the **Calendars** tab.
2. At the bottom of a calendar's card, find **Booking link** and type a short segment, usually a first name, such as \`dave\`. Lowercase letters, numbers and hyphens only, up to 64 characters.
3. Click **Save**. The full link is your booking link with that on the end, for example \`.../book/sharps-barbers/dave\`.
4. Click **Copy** to put it on your clipboard, or **Open page** to see it. The page shows a **Booking with Dave** banner above the booking steps.

Use these in each person's own social bio. Clients who do not mind who they see should still get your main link. If you switch that calendar off (**Active (bookable)**), its link shows a "page not found" screen until it is active again.

## Brand the Book now tab

Back on **Settings → Booking Page**, the **Book now** group in the **Your booking page** card holds your branding. Everything here saves on its own a moment after you change it.

- **Logo.** Click **Upload logo** (later **Change logo** or **Remove logo**). Drag the logo to reposition it, use the **Scale** slider to zoom, or click **Reset framing**. The logo also appears in your client emails.
- **Cover photo.** Choose **Full width** (spans the whole screen, best for wide photos) or **Contained width** (stays the same width as your booking content). Click **Upload photo**, then **Crop photo** to open **Crop cover photo**: drag the box to move it, or drag a corner or edge to resize, then click **Apply crop** (or **Reset to full photo**). Afterwards the buttons read **Edit crop** and **Reset crop**. **Remove photo** takes it off again.
- **Quick palettes.** One click sets your brand colour: **ResNeo Navy**, **Forest**, **Plum**, **Charcoal**, **Rose** or **Ocean**.
- **Brand colour.** Pick any colour with the picker, or type a hex code such as \`#003B6F\`. It is used for buttons, highlights and accents on your page; **Reset** clears it. If your colour is very light, a note warns that white button text may be hard to read. Tick **Use my brand colour in customer emails** underneath if you would also like booking confirmations, reminders and receipts to use it. A light colour is darkened a little in emails so button text stays readable.
- **Font style.** Choose one of twelve typefaces for the headings and text on your page: **Clean (Inter)** (the default), **Modern (Poppins)**, **Classic (Montserrat)**, **Light (Raleway)**, **Rounded (Nunito)**, **Chic (Josefin Sans)**, **Elegant (Cormorant)**, **Luxury (Playfair Display)**, **Editorial (Lora)**, **Boutique (Great Vibes)**, **Spa (Marcellus)** or **Refined (Cinzel)**. Each option is shown in its own typeface.
- **Announcement banner.** A short line, such as "Closed bank holiday Monday", shown as a coloured bar across the top of your page. Clear it to remove the bar.

Your address and phone number on the page come from **Settings → Profile**, not from here.

> Photo rules: logo, cover, gallery, service and team photos must be JPEG, PNG or WebP and under 5MB. iPhone HEIC photos are not accepted, so export as JPEG first.

## Add the Services, Meet the team and About tabs

Below **Book now** are three more groups. Each has a **Show on booking page** tick box in its header that adds that tab to your public page (**Book now** is always shown).

**Services**

- **How services are listed.** Once you have categories on the **Services** page, choose **Sections with a category menu** (every category with its services below, and a menu at the top that jumps between them) or **Collapsible categories** (clients open a category to see its services). This applies to the booking form and the **Services** tab alike. Until you have categories, the list shows as it does now. With six or more services, clients also get a **Search services** box.
- **Service photos.** Each service has an **Add photo** button (later **Change** or **Remove**). Drag the thumbnail to reposition the photo, use **Scale** to zoom, or click **Reset framing**. Names, descriptions, lengths and prices come from your services, so edit those on the **Services** page.

**Meet the team**

- **Team profiles** lists every active calendar that offers a service. For each person, tick **Show on page**, click **Add photo** (drag it and use **Scale** to frame it), then fill in **Specialties (comma-separated)** and a **Short bio**. Specialties show as small tags under their name.
- A person only appears on the tab once they have a photo, a bio or specialties. Worth ten minutes, because it is the part clients actually read.

**About**

- **About / welcome message.** A few sentences in your own words.
- **Social links (optional).** Paste full web addresses into **Instagram URL**, **Facebook URL**, **TikTok URL** and **X (Twitter) URL**.
- **Photo gallery.** Click **Add photo** for up to 12 photos. Hover a photo to move it left or right, or to **Remove** it.
- The tab also shows your address with a map and directions, taken from **Settings → Profile**.

## Check it with Live preview

Near the top of the **Your booking page** card, click **Live preview** to expand a copy of your page. Switch between **Mobile** and **Desktop**, click **Refresh** after a change, or use **Open full page in a new tab**. Colours, fonts and text update as you type; logo, cover and gallery photos appear once uploaded.

## Put it on your own website

1. Scroll down to **Website widget & QR code**. Inside it sits a card called **Booking widget & QR code**, holding two sections: **Embed code** and **QR code**.
2. In **Embed code**, click **Copy code**. It is two lines: an iframe and a small resize script. Paste both.
3. Give the code to whoever looks after your website, or paste it into your website builder's HTML or embed block.

The widget's **Accent colour (optional)** sets its buttons and highlights. Leave it blank and the widget uses your **Brand colour**; pick a colour or type a 6-digit hex code to use something different. It saves on its own.

If your venue is part of a combined booking page, a **What to embed** menu appears first: choose **My venue only** or the **Venue collective** page.

> If the colour will not save, you will see **Could not save accent colour. Use 6 hex digits.** Clear the box completely and click away. That resets it. The **Reset** button only appears once the colour is already valid, so it will not help here.

:::help-figure public-embed

## Print a QR code

In the **QR code** section, click **Download QR code**. Your business name is printed underneath it.

> **Warning:** the QR code encodes your current booking page address. Change the address and every printed code stops working, so settle on it before you print.

## When booking is paused

Online booking pauses in two cases: you are on the **Light** plan and a payment to ResNeo has failed, or your subscription was cancelled and its paid period has run out. Clients opening your link then see a page headed **Online booking unavailable**, telling them to contact you directly, so keep your phone number easy to find elsewhere.

This is about your **ResNeo subscription**, not about client card payments. Fix it under **Settings → Plan** with **Update payment method** or **Resubscribe**. Booking restarts as soon as the subscription is active, with your page and link exactly as they were.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| My page loads but there are no times to pick | No service is offered on a calendar, or that calendar has no working hours | Open **Services**, edit the service and tick the calendar under **Calendars that offer this service**, then check that calendar's hours under **Calendar Availability** |
| My link shows a "page not found" screen | The **Booking page address** was changed or mistyped | Check it under **Settings → Booking Page** |
| A person's own link shows "page not found" | Their calendar is switched off, or your main address changed | Turn **Active (bookable)** back on, then **Copy** the link again from **Booking link** |
| The address will not save | It contains spaces or capitals, or another venue already has it | Use lowercase letters, numbers and hyphens, and wait for **This address is available.** |
| Clients see **Online booking unavailable** | A failed payment on the Light plan, or a cancelled subscription that has run out | Fix it under **Settings → Plan** |
| The Services or Meet the team tab is missing | **Show on booking page** is not ticked, or nobody has a profile yet | Tick it in the group header, then give each person a photo, bio or specialties |
| **Copy code** does not work | Your browser blocked clipboard access | Select the code in the grey box above the button and copy it by hand |
| The widget is cut off or has its own scrollbar | Only the iframe line was pasted, not the resize script | Paste both lines of the embed code |
| The accent colour will not save | The value is not 6 hex digits | Clear the box completely and click away to reset it |
| My old QR code stopped working | Your booking page address changed | Download a fresh QR code. Anything already printed is dead and cannot be redirected |

## Next steps

- [What your clients see when they book](/help/getting-started/what-your-clients-see)
- [Set up your services](/help/getting-started/services)
- [Business & calendar hours](/help/getting-started/business-and-calendar-hours)
- [Set up your business profile](/help/getting-started/business-profile)
- [Booking widget](/help/appointments/booking-widget)`,
};
