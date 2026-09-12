import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: "venue-settings-in-the-app",
  title: "Venue settings you can change in the app",
  description: "A tour of the More tab: your venue profile, hours and closures, booking settings, booking page, communications, team, plan, referrals, linked venues and support, with a note on which of them are read only.",
  tags: ["app","mobile","settings","more tab","venue profile","business hours","booking page","communications","team","plan","linked venues","collectives","support","ask resneo","reports","booked revenue"],
  verified: '2026-09-12',
  content: `# Venue settings you can change in the app

The **More** tab is the app's settings drawer. Most of what an owner changes week to week is here: your address and phone number, your opening hours, your booking page, the messages your clients get, and who is on your team.

A few things only ever show you the answer rather than let you change it, and this page is clear about which.

## Before you start

- **Roles matter.** An admin sees everything below. A team member sees a shorter list: **Services**, **Business hours**, the day-to-day tools, **Support** and their own **Account settings**.
- **A search bar sits at the top.** Type "stripe", "SMS", "branding" or "closures" into **Search settings** and it jumps you to the right screen, including the ones the web calls something slightly different.
- **Changes are live.** Anything you save here shows on the web dashboard immediately, and the other way round. There is no separate app copy of your settings.

## What is on the More tab

At the top is your name, your venue and your role, with a bell for [notifications](/help/resneo-app/push-notifications-and-security). Under that, where your venue has it switched on, sits **Ask ResNeo**: ask how to do something in your own words and it answers from the ResNeo help centre. It stands where the settings search box used to, because a person at the top of this tab is usually looking for how to do something. Keep client details out of the question, and check the article it links to for the full steps.

Below that:

- **Quick actions**: **Today**, **Calendar availability**, **Waitlist** and, for admins, **Reports**. **Reports** covers bookings, no-shows, cancellations, deposits, your team and your services, and **Booked revenue**, the value of everything on the diary by day and by calendar.
- **Your venue**: **Services**, **Business hours**, **Booking settings**, **Booking page**, **Venue profile**, and **Compliance** with **Compliance settings** where your plan includes them.
- **Team & clients**: **Team**, **Communications** and **Import contacts**.
- **Booking types**: whichever of **Classes**, **Events**, **Resources** and **Tables** your venue has switched on.
- **Billing & growth**: **Plan & payments** and **Refer & Earn**.
- **Linked venues**: **Linked calendar**, **Linked venues** and **Venue collectives**.
- **App & support**: **Support**, **Push notifications** and **Web dashboard**.

Under those sit **In-person payments**, **Privacy & security**, **Your own bookings** and **Sign out**, with the app version at the very bottom.

> **Good to know:** if your subscription is past due or has been cancelled, admins see a **Subscription issue** banner at the top of **More**. Tap it to open **Plan & payments**.

## Venue profile

**More → Venue profile** (admins). This is your business as clients and ResNeo see it.

- **Business details**: **Business name**, and your address split into **Building / venue name**, **Street**, **Town / city** and **Postcode**.
- **Contact**: **Phone**, **Email** and **Business website**.
- **Booking page**: your **Booking page address**, the last part of your public link.
- **Operational settings**: the **No-show grace period (minutes)**, which is how long after the appointment time your team can mark a no-show, and your **Timezone**.
- **Branding**: your **Venue logo** and **Cover photo**, plus **Edit booking page branding**, which opens the booking page editor.
- **Data import** points at the web, because the import tool with its column mapping, validation and 24-hour undo runs there. Recent imports are listed for reference.

Tap **Save changes** when you are done.

## Business hours and closures

**More → Business hours**. Two parts on one screen.

**Weekly opening hours** is the week you are normally open. Edit a day, and the card marks itself **Unsaved changes** until you tap **Save opening hours** in the bar at the bottom. If any existing bookings would fall outside the new hours, the app asks **Save these hours anyway?** before committing.

**Closures & Exceptions** covers one-off closures, amended hours and capacity changes. Tap a date on the calendar, then **Add closure**, or tap an existing entry to edit it. Past entries are hidden behind **Show past blocks**.

Staff working hours are a different thing and live under **Calendar availability**, covered in [Working hours and time off in the app](/help/resneo-app/availability-in-the-app).

## Booking settings

**More → Booking settings** (admins).

- **Booking models** turns booking types on and off for your venue, with **Primary booking type** and **Also offer on your booking page** underneath.
- **Guest accounts** holds **Require sign-in to book**.
- **Optional booking features** lists **Any available practitioner**, **Staff-first booking**, **Guest self-reschedule**, **Appointment waitlist** and **Class packs, courses & memberships**.

Two of these open a little more when switched on. **Any available practitioner** lets you choose **Priority order** or **Random**. **Appointment waitlist** lets you choose what happens when a slot opens: **Staff choose**, **First in line, notify in order**, or **Offer to all**.

**Class packs, courses & memberships** is the exception: you can see it, but the products themselves are built on the web dashboard, and the row says so.

There is more on each of these in [Optional booking features](/help/getting-started/optional-booking-features).

## Booking page

**More → Booking page** (admins). Almost everything the web editor does, on your phone.

- **Your booking page** shows the live address with **Copy link** and **Open page**, and lets you edit the **Web address** itself.
- **Embed on your website** gives you the code to paste into your own site, with an optional **Accent colour**, and **Copy code**.
- **QR code** produces a code for your window, your card or your counter.
- **Branding** has **Quick palettes**, a **Brand colour**, a **Font style** and the option to use your brand colour in customer emails.
- **Announcement banner** puts a short message at the top of your page.
- **Logo & cover** handles your **Logo** and **Cover photo**, including how the cover is laid out and how the logo is framed.
- **Public page tabs** switches the **Services tab**, **Meet the team tab** and **About tab** on and off. With them on you get **Service photos**, **How services are listed**, **Team profiles**, an **About / welcome** message, your **Instagram**, **Facebook**, **TikTok** and **X (Twitter)** links, and a **Photo gallery**.

See [Your public booking page](/help/getting-started/public-booking-page) for what each of these does to what clients see.

## Communications

**More → Communications** (admins). The same guest messages as the web: switch each one on or off, choose email, SMS or both, set the timing, and add an extra line to the standard template. Tap a card to preview it.

Below the message cards:

- **Staff alerts**: **Daily schedule email**, **New booking alerts** and **Cancellation alerts**.
- **Business notifications**, the owner **New booking alert** and the email address it goes to.
- **Ask for a Google review** and the link it sends people to.

Changes arm a save bar at the bottom. Team members can look but not change, and the screen says so.

Full detail is in [Guest communications](/help/getting-started/communications).

## Team

**More → Team**. Everyone sees a row for their own account at the top. Admins also get:

- **Team members**, the list. Tap a person to change their role, the calendars they manage, their password or their invitation.
- The **+** button to invite someone. If your plan's seats are full, the button is replaced by an amber note with an **Upgrade plan** button.
- **Role permissions**, a reminder of what Admin and Staff can each do.
- **Session timeout**, the auto-logout after a period of inactivity.

More on roles in [Your team and staff logins](/help/getting-started/staff).

## Plan and payments

**More → Plan & payments** (admins). This one is **mostly read only by design**.

You can see your tier and status, your **Est. next invoice**, any **Coupon applied**, your **Next billing** or **Access until** date, your **Current period**, your **Booking types**, your **Currency**, your **Calendar usage** and your **SMS this period**.

What you can do here:

- **Manage billing** opens the Stripe Customer Portal for card details, invoices, receipts, billing address and cancellation.
- **Delete this venue** under **Danger zone** schedules a 30-day grace-period deletion of the venue and all its data, which you can cancel any time before it ends.

What you cannot do here: **change plan**. Upgrades, downgrades and new subscriptions are handled on the ResNeo website, and the app gives you a **Manage plan on the web** button. That is an app store rule about digital subscriptions, not a ResNeo choice. Connecting Stripe so you can take client payments is a different thing entirely and is never affected.

See [Plans and billing](/help/settings/plan-billing).

## Refer & Earn

**More → Refer & Earn** (admins) shows **Your referral code**, your **Shareable link** with **Copy link** and **Share**, your **Total credited**, **Credit remaining** and **Total referrals**, and a list of **Your referrals**. It is the same scheme as the web, described in [Refer and earn](/help/getting-started/refer-and-earn).

## Support

**More → Support** is open to everyone. **Browse the help centre** opens these articles. Below it is a message form: pick a category (**General**, **Billing**, **Technical** or **Feature**), fill in **Subject** and **Message**, optionally add **Your email** and **Phone number**, then **Send message**. There is also a direct email address under **Other ways to reach us**.

## Linked venues and collectives

**More → Linked venues** (admins) manages sharing with another venue. **Send link request** starts one, **Get invite link** produces a link you can send to a venue that is not on ResNeo yet, and requests and links appear under **Incoming requests**, **Active**, **Sent by you** and **Past**. Tap an active link to review or change what each side can see and do.

**More → Linked calendar** is the day-to-day view: the diary of venues linked to yours, open to everyone.

**More → Venue collectives** (admins) manages a shared public booking page across fully linked venues. You can **Create venue collective**, **Manage combined page**, accept or **Decline** an invitation, and **Leave** one. Creating needs a link that grants create, edit and cancel access in both directions, and the screen tells you when that is missing.

See [Linked venues](/help/getting-started/linked-venues).

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| A row is missing from **More** | Many rows are admin only, and booking-type rows only appear for types your venue has switched on | Ask an admin, or turn the booking type on under **Booking settings** |
| You cannot find something by name | The app and the web sometimes use different words | Type it into **Search settings**; common web words are matched too |
| A switch will not move | You are signed in as a team member | Only admins can change venue settings |
| Nothing saves and a banner mentions your subscription | Past due or expired plans pause every change | Open **Plan & payments** and sort the billing out, or do it on the web |
| **Change plan** is not offered | Plan changes are handled on the web for app store reasons | Tap **Manage plan on the web** |
| Your hours will not save | Existing bookings fall outside the new hours | Answer **Save these hours anyway?**, or move those bookings first |
| An offline banner appears | You have no connection | Changes do not save while offline, and there is no queue. Reconnect and try again |

## Next steps

- [What you can only do on the web dashboard](/help/resneo-app/web-only-features)
- [Working hours and time off in the app](/help/resneo-app/availability-in-the-app)
- [Taking payments in person](/help/resneo-app/payments-in-the-app)
- [Notifications, app lock and your account](/help/resneo-app/push-notifications-and-security)
- [Your public booking page](/help/getting-started/public-booking-page)`,
};
