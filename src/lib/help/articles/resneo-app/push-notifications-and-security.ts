import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: "push-notifications-and-security",
  title: "Notifications, app lock and your account",
  description: "Choose which alerts your phone shows you, set quiet hours, lock the app behind Face ID, and manage your own sign-in details, password and account.",
  tags: ["app","mobile","notifications","push","alerts","quiet hours","face id","biometric","app lock","account","password","delete account","sign out"],
  verified: '2026-09-12',
  content: `# Notifications, app lock and your account

The app can tap you on the shoulder when something happens at your venue, and it can lock itself behind Face ID so client records stay private if your phone is left on the counter. Both are yours to set, and neither is on by force.

This page also covers your own account: your name, your sign-in email, your password, and how to delete the account if you ever need to.

## Before you start

- **Push notifications need the installed app.** They do not work in a web preview or in Expo Go. If you are testing on one of those, the screen tells you so.
- **Your choices follow your account, not your phone.** Turn something off on your tablet and it is off on your phone too, because the settings are saved against your login.
- **These are your alerts, not your clients'.** Confirmations and reminders that go to clients by email and SMS are set separately, under [Guest communications](/help/getting-started/communications).

## Step 1: Turn notifications on

1. Open the **More** tab.
2. Under **App & support**, tap **Push notifications**.
3. If your phone has not been asked yet, an amber banner reads **Turn on notifications**. Tap **Enable** and allow the system prompt.
4. Make sure the top switch, **Push notifications**, is on. Everything else is hidden until it is.

If you turned notifications down at some point, the banner reads **Notifications are turned off** instead, with an **Open Settings** button. Turn them back on for Resneo in your phone's own settings, and the app picks that up when you return.

## Step 2: Choose what you are told about

With the master switch on, three groups appear. Everything is on to start with except **Daily summary** and **Reviews & feedback**.

**Bookings**

- **New bookings** when a booking is made online or by your team
- **Cancellations** when a guest or staff member cancels
- **Reschedules & changes** when a booking moves or is edited
- **Payments & deposits** when a deposit is paid, or a payment fails

**Reminders & operations**

- **No-show prompts** when a guest is overdue to arrive
- **Waitlist offers** when a slot opens for a waiting guest
- **Daily summary**, a morning rundown of the day's bookings

**Account**

- **Reviews & feedback** when a guest leaves a review
- **Low SMS credit** before your guest text reminders run out
- **Billing & account** for payment failures and subscription notices

## Step 3: All bookings, or just yours

Under **Which bookings?** choose between:

- **All bookings**, which alerts you about every booking at the venue. This is the default and suits an owner or a small team.
- **Just mine**, which alerts you only about bookings assigned to you. This is usually what a busy practitioner wants.

The line underneath confirms which you have picked.

## Step 4: Quiet hours

Turn on **Pause overnight** under **Quiet hours** to mute non-urgent alerts overnight. The row shows the window, which starts at 9:00pm and ends at 7:00am.

## The notifications feed

Alerts also collect in one place, so nothing is lost if you miss a banner.

- Tap the bell at the top of the **More** tab, or open **Notifications** from the same tab.
- Items are grouped by day, with unread ones marked.
- **Mark all read** clears the badge.
- Tapping an item marks it read and, where it makes sense, jumps you to the day in the diary. Activity from a linked venue takes admins to **Linked venues**.
- Pull down to refresh.

Admins see **Email notifications** at the bottom of the feed. Those switches control the email channel only, for activity at venues linked to yours. The in-app feed always shows everything either way, and the emails go to your venue's contact address and its active admins.

## Lock the app with Face ID

If your phone has Face ID, Touch ID or a fingerprint set up, the app offers a lock of its own.

1. Open the **More** tab and find **Privacy & security**.
2. Turn on **Require Face ID / biometric unlock**. The description reads "Lock the app when it returns from the background so client records stay private."
3. Your phone asks you to confirm it is you. If you cancel, the switch stays off.

From then on, when you come back to the app after using something else, a screen reads **Resneo is locked** with an **Unlock** button. Face ID, or your device passcode, gets you back in.

Two things worth knowing: the lock engages when the app returns from the background, not when you first open it, and signing out turns it off again.

> **Good to know:** the **Compliance** screen blocks screenshots and screen recording while it is open, because of what is on it. That is automatic and there is nothing to switch on.

## Sign out

Scroll to the bottom of the **More** tab and tap **Sign out**. A sheet asks **Sign out?** and reminds you that you can sign back in with the same work email. Tap **Sign out** to confirm, or **Cancel**.

The app version is printed under that button, which is handy if you are ever asked for it by support.

## Your account settings

Tap your name at the top of the **More** tab, or search for **Account settings**, to open your own details.

**Your profile** holds your **Display name**, your **Sign-in email** (the address you log in with) and an optional **Phone**. Change what you need and tap **Save profile**.

**Password** lets you set a new one. Enter it under **New password**, repeat it under **Confirm password**, and tap **Update password**. It must be at least 8 characters. Use the new password next time you sign in.

> **Good to know:** there is no "reset my password" step inside the app. **Forgot password?** on the sign-in screen emails you a sign-in code instead, which gets you in. Once you are in, change the password here.

## Deleting your account

At the bottom of **Account settings**, under **Danger zone**, is **Delete account**. This deletes **you**, not your venue. A venue is deleted separately by an admin, from **Plan & payments**.

1. Tap **Delete account**.
2. Read the sheet. Deleting starts a **30-day grace period**, after which your account and personal data are permanently deleted and your guest records at venues are anonymised.
3. Type **DELETE MY ACCOUNT** into the box to confirm.
4. Tap **Delete my account**.

The app confirms the date it will happen and signs you out on all devices. If you change your mind, use the **Cancel deletion request** link in the confirmation email before that date. If you sign back in during the grace period, a banner at the top of **Account settings** shows the date with a **Cancel deletion request** button.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| The screen says push is not available in this build | You are in a web preview or Expo Go | Use the installed app from the App Store or Google Play |
| No alerts at all, and the banner says notifications are turned off | Permission was declined on this phone | Tap **Open Settings** and allow notifications for Resneo |
| Alerts stopped after you changed phone | The new phone has not been given permission | Open **More → Push notifications** on the new phone and tap **Enable** |
| Too many alerts | You are set to **All bookings** | Switch **Which bookings?** to **Just mine** |
| Nothing overnight | **Pause overnight** is on | Turn it off under **Quiet hours** |
| A category is switched on but you get nothing | The master **Push notifications** switch is off, so nothing is sent | Turn it on at the top of the screen |
| There is no **Privacy & security** section | The phone has no Face ID, Touch ID or fingerprint set up | Set one up in your phone's settings, then reopen the app |
| The app keeps asking to unlock | The lock engages every time the app returns from the background | Turn off **Require Face ID / biometric unlock** if that is not what you want |
| Your changes are not saving anywhere in the app | A past due or expired subscription pauses changes | An admin sorts the plan out on the web, under **Settings → Plan** |

## Next steps

- [Install the app and sign in](/help/resneo-app/install-and-sign-in)
- [Venue settings you can change in the app](/help/resneo-app/venue-settings-in-the-app)
- [Guest communications](/help/getting-started/communications)
- [Your team and staff logins](/help/getting-started/staff)
- [Access problems](/help/troubleshooting/access-issues)`,
};
