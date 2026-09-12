import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: 'booking-widget',
  helpSection: 'growth',
  title: 'Your booking page, embed, and QR code',
  description: 'Every public address your venue has, the two-line embed code and how it resizes, the accent colour, ?tab= deep links, QR codes, and how widget bookings appear in reports.',
  tags: ['embed', 'widget', 'iframe', 'qr', 'marketing', 'accent colour', 'resize.js', 'tab', 'combined page', 'collective'],
  verified: '2026-09-12',
  content: `
# Meet clients wherever they browse

Everything a client can open lives at one of four addresses, all built from your **Booking page address** in **Settings → Booking Page**.

1. **Your booking page**, at \`/book/\` plus your address. The full page, with your cover photo, branding and any tabs you have switched on. This is the link to share.
2. **A person's own page**, at \`/book/\` plus your address plus their **Booking link**, for example \`/book/sharps-barbers/dave\`. It opens on that calendar only and shows a **Booking with Dave** banner. Set the segment on each calendar under **Calendar Availability**, the **Calendars** tab.
3. **A combined page**, at \`/book/c/\` plus the collective's own address, when your venue is part of a venue collective.
4. **The embed**, at \`/embed/\` plus your address. The booking form on its own, sized for an iframe on your website.

:::help-figure embed-vs-book

:::help-video booking-page-setup

## Where the controls live

1. Sign in as an **admin**.
2. Open **Settings**, then the **Booking Page** tab.
3. Scroll to **Website widget & QR code**. Inside it is a card called **Booking widget & QR code**, holding two sections: **Embed code** and **QR code**.

:::help-figure widget-settings

## The embed code

**Copy code** puts the whole snippet on your clipboard, and the button changes to **Copied!**. If your browser blocks clipboard access it reads **Copy failed. Try again**; select the code in the grey box above and copy it by hand instead.

The snippet is always **two lines**, and both matter:

- An \`<iframe>\` pointing at your \`/embed/\` address, 100% wide, 450 pixels tall to begin with, with scrolling switched off and the id \`reserveni-widget\`.
- A \`<script>\` tag loading \`resize.js\` from ResNeo.

Paste both into your website's HTML or embed block, or send them to whoever looks after your site. Nothing else needs installing.

### Why the second line matters

The booking form inside the iframe measures itself at every step and tells the page around it how tall it needs to be. \`resize.js\` is the small piece that listens for that message and stretches the iframe to match. Without it the iframe stays at its starting 450 pixels with scrolling switched off, so the later steps of the flow are simply cut off. The script finds the frame by its id, so if your website builder rewrites or strips the \`id="reserveni-widget"\`, resizing stops working too.

### Accent colour

**Accent colour (optional)** tints the buttons and highlights inside the widget. Use the colour swatch or type a 6-digit hex value. It saves on its own a moment after you stop typing: you will see **Saving accent…** and then **Accent colour saved.** A **Reset** link appears next to the box once a valid colour is stored.

Leave it blank and the widget falls back to the **Brand colour** you set higher up the same tab, so most venues never need to touch it. Set it only when the widget should differ from your booking page, usually to match the site it sits in.

Changing the colour rewrites the \`?accent=\` part of the snippet, so copy the code again afterwards.

### Embedding a combined page

If your venue belongs to a venue collective with at least one other active member, a **What to embed** dropdown appears above the colour: **My venue only** with your venue name, or **Venue collective** with the collective's name. Choosing the collective swaps the snippet to the combined page.

Two things behave differently there. The combined page is a full web page rather than the slimmed-down embed, so it does not report its height and \`resize.js\` cannot stretch the frame: raise the \`height\` number in the iframe line yourself until it fits. It also uses the collective's own colour, so the accent colour has no effect on it.

## Opening a specific tab

When you have more than one booking type switched on, clients land on a row of tabs and pick one. To send them straight to a type, add \`tab=\` to the address with one of these values:

\`appointments\`, \`classes\`, \`events\`, \`resources\` or \`tables\`.

This works on your booking page and inside the embed. Because the snippet may already carry \`?accent=\`, add the tab with an ampersand: \`.../embed/sharps-barbers?accent=00c2c7&tab=appointments\`. On a plain link with nothing else after it, use a question mark: \`.../book/sharps-barbers?tab=classes\`.

A tab you have not switched on, or a word that is not on the list, is ignored and the client sees your usual first tab. If only one booking type is on, there is no tab row and the parameter does nothing.

:::help-figure public-tabs

## What the embed shows

The embed is deliberately narrow in scope: the booking flow, and a small "Powered by ResNeo" line underneath. Your cover photo, logo, and the **Services**, **Meet the team** and **About** tabs stay on the hosted page, because the surrounding page is already your website. The tab row for booking types does appear when you have several switched on.

There is no per-person embed. If you want one calendar embedded on its own, embed the venue and let clients choose, or link out to that person's own page.

## QR codes

In the **QR code** section, click **Download QR code**. You get a PNG with your business name printed underneath, ready for a window sticker, a reception card or a poster.

The code encodes your booking page, not the embed, so people who scan it get the full page on their phone. If you have selected a collective under **What to embed**, the QR points at the combined page instead.

> **Warning:** the code carries your current booking page address. Change that address and every printed code stops working, and nothing can redirect the old one. Settle on your address before you print anything.

## How widget bookings show up in reports

Every booking records where it came from, and **Reports** shows the mix under **Team, services & channels**. The channel names are **Online**, **Phone**, **Walk-in**, **Booking page** and **Website widget**.

For appointments, classes, events and resources, a booking made in the embed is recorded as **Booking page**, exactly like one made on your hosted page. The **Website widget** channel is only used by table reservations. So the channel chart will tell you how much came from online booking overall, but not how much of that arrived through the iframe on your site. If you need to separate them, use your own website analytics on the page holding the embed.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| The widget is cut off, or has its own scrollbar | Only the iframe line was pasted, not the script | Paste both lines of the embed code |
| It still will not resize | Your website builder stripped or renamed the iframe's id | Keep \`id="reserveni-widget"\` exactly as generated |
| Nothing appears where the widget should be | Your website builder is stripping iframes or scripts from a rich-text block | Paste into a dedicated HTML or embed block instead |
| The widget shows the wrong colour | The accent colour is blank, so it is using your **Brand colour** | Set **Accent colour (optional)**, then copy the code again |
| **Could not save accent colour. Use 6 hex digits.** | The value is not a valid 6-digit hex code | Clear the box completely and click away to reset it |
| **Copy code** does nothing | Your browser blocked clipboard access | Select the code in the grey box above the button and copy it by hand |
| \`?tab=\` is ignored | That booking type is not switched on, or only one type is on | Turn the type on under **Settings → Booking Settings** |
| The embed shows no times to book | The same reason the hosted page would: no service on a calendar with working hours | See [set up your services](/help/getting-started/services) |
| A combined page embed is clipped | The combined page does not report its height, so the resize script cannot help | Raise the \`height\` number in the iframe line until it fits |
| A printed QR code stopped working | Your booking page address changed | Download a fresh code. Anything already printed is dead |
| The widget went blank after a change | You changed your booking page address, so the old \`/embed/\` address no longer exists | Copy the new embed code and replace it on your site |

## Next steps

- [Your public booking page and embed](/help/getting-started/public-booking-page)
- [Deposits and card holds](/help/appointments/deposits)
- [Communications](/help/appointments/communications)
- [Reports](/help/appointments/reports)
`.trim(),
};
