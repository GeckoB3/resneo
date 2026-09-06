import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: "web-only-features",
  title: "What you can only do on the web dashboard",
  description: "The app covers your day and the web covers your setup. Here is the short list of jobs that open the web dashboard, and where to read about each one.",
  tags: ["app","mobile","web dashboard","setup","import","classes","tables","plan","stripe","limits"],
  verified: '2026-09-06',
  content: `# What you can only do on the web dashboard

Think of it this way: **the app covers the day, the web covers the setup.**

The app is built for the counter and the treatment room. It shows you the diary, takes a booking, moves one, finds a client, takes the money and blocks out an afternoon. It does that with one thumb while somebody is standing in front of you.

The bigger, once-in-a-while jobs, the ones with lots of fields, a spreadsheet or a legal agreement, are on the web dashboard. Those are the jobs you do sitting down with a coffee, and they are better on a proper screen.

When the app meets one of them it does not pretend. It says so plainly, and gives you a button that opens the web dashboard in your phone's browser, already signed in.

## The list

### Setting up a brand new venue's diary

Your first calendars are added on the web. Until a venue has at least one, the app's calendar shows **No practitioners yet** and points you at the web dashboard. Once calendars exist you can add, rename, reorder and pause them from the app.

Read: [Business hours and calendar hours](/help/getting-started/business-and-calendar-hours)

### Building the catalogue for a booking type you have just switched on

You can turn **Classes**, **Events** and **Resources** on from the app, and run them day to day there. Creating the class types, events and resources themselves is a web job, and the app's row says so.

Read: [Classes](/help/getting-started/classes), [Events](/help/getting-started/events), [Resources](/help/getting-started/resources)

### Class packs, courses and memberships

**Class packs, courses & memberships** appears in the app's **Booking settings** so you can see whether it is on, but the packs, courses and membership plans are built on the web.

Read: [Selling class packs](/help/appointments/selling-class-packs), [Building a class course](/help/appointments/building-a-class-course), [Selling memberships](/help/appointments/selling-memberships)

### Class check-in on a smaller plan

Where your plan does not include class check-in, the app tells you and asks you to manage attendance on the web instead.

Read: [Classes](/help/appointments/classes)

### Changing your plan, and the billing portal

You can see everything about your subscription in the app. Changing it is done on the ResNeo website. This is an app store rule about digital subscriptions rather than a ResNeo decision, and it is why the app offers **Manage plan on the web** instead of an upgrade button. Card details, invoices, receipts, your billing address and cancellation go through the Stripe Customer Portal, which the app can open for you with **Manage billing**.

Read: [Plans and billing](/help/settings/plan-billing)

### Setting up Stripe

Connecting your Stripe account is Stripe's own hosted sign-up, with business details, a bank account and identity documents. It runs on the web. Once it is connected, taking payments in person works fully in the app.

Read: [Connect Stripe to take payments](/help/getting-started/stripe-payments), [Taking payments in person](/help/resneo-app/payments-in-the-app)

### Detailed SMS usage

The app shows your SMS allowance and what the overage rate is. The message-by-message detail is on the web, under **Settings → Plan**.

Read: [SMS problems](/help/troubleshooting/sms-issues)

### Class revenue reporting

The app's **Reports** covers your bookings, no-shows, deposits, team and services. Class revenue reporting lives on the web.

Read: [Reports](/help/getting-started/reports)

### Importing data, and undoing an import

Uploading a spreadsheet of clients or booking history means mapping columns, checking for problems and approving the result. That is a web wizard, and so is the 24-hour undo that follows it. The app links straight to it from **Venue profile** and from **More → Import contacts**, and lists your recent imports for reference.

Read: [Importing your data](/help/getting-started/importing-data), [Import problems](/help/troubleshooting/import-issues)

### Tables and floor plans

Table and floor plan setup is a web tool. The app's **Tables** row opens it.

### Sitting intervals, covers and turn times

For venues that take table reservations, the deeper configuration (full sitting intervals, maximum covers by day, turn times and booking windows) is set on the web. The app's **Closures & Exceptions** card says so.

### Service location, processing time and custom availability, if you are not an admin

Admins edit these in the app. Team members see a note that a service's location, processing-time blocks and custom availability are managed by venue admins on the web dashboard.

Read: [Services](/help/getting-started/services)

## One thing that stops everything

If your subscription is past due or has expired, changes are paused across the app: an admin sees a **Subscription issue** banner and the message points at the web. Public online booking pauses too. Sorting the plan out on the web brings both straight back.

## How to open the web dashboard from your phone

Two ways:

1. **More → Web dashboard**, under **App & support**.
2. Any of the buttons above, which open the same place at the right screen.

Either way the dashboard opens in a browser window inside the app, so you can finish the job and swipe back to the diary. It works on a phone, though anything with a lot of fields is easier on a laptop or a tablet.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| A button in the app opens a browser instead of a screen | That job lives on the web | Finish it in the browser window and close it to return |
| The web dashboard asks you to sign in again | The browser window did not carry your session | Sign in with the same email you use in the app |
| You cannot find a setting anywhere in the app | It may be one of the web jobs above, or admin only | Use **Search settings** on the **More** tab first, then check this list |
| Everything is read only | A past due or expired subscription | An admin opens **Settings → Plan** on the web |
| The app says something is not included in your plan | The feature belongs to a higher tier | See [Plans and billing](/help/settings/plan-billing) |

## Next steps

- [Venue settings you can change in the app](/help/resneo-app/venue-settings-in-the-app)
- [Install the app and sign in](/help/resneo-app/install-and-sign-in)
- [Your dashboard at a glance](/help/getting-started/dashboard-overview)
- [Your go-live checklist](/help/getting-started/setup-checklist)`,
};
