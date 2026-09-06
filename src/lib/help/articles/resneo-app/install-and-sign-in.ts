import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: "install-and-sign-in",
  title: "Install the app and sign in",
  description: "Find the ResNeo app in the App Store or on Google Play, sign in with a password or a sign-in code, and choose whether you land on your venue or your own bookings.",
  tags: ["app","mobile","install","sign in","password","magic link","sign-in code","staff access"],
  verified: '2026-09-06',
  content: `# Install the app and sign in

The ResNeo app puts your diary in your pocket. It is the same venue as the web dashboard, so a booking taken on the app appears on the web straight away, and the other way round.

The app is for your **team**. Clients have their own side of the app for the bookings they have made with you, which is covered in [Your client's ResNeo account](/help/getting-started/your-clients-resneo-account).

## Before you start

- You need a staff account at a venue. **The app cannot create accounts.** An admin invites you from the web dashboard, under **Settings → Staff**.
- If you already sign in to the web dashboard, the same email works in the app.
- Not everything lives in the app. Some jobs still open the web dashboard in your phone's browser, and the app tells you when that is the case.

## Step 1: Install the app

1. Open the **App Store** on an iPhone or iPad, or **Google Play** on an Android phone or tablet.
2. Search for **Resneo**. That is the name the app is listed under.
3. Install it, then open it.

The app runs on both iPhone and Android. A few features differ between the two, and the articles in this category say so where it matters.

## Step 2: Sign in with your password

The sign-in screen has two tabs, **Password** and **Magic Link**, and opens on **Password**.

1. Type your email in the **Email** box.
2. Type your password in the **Password** box.
3. Tap **Sign in**.

If you see "That email and password did not match", either the password is wrong, or you have never chosen one. If you have never set a password, use the **Magic Link** tab instead (Step 3), then set a password afterwards.

## Step 3: Sign in with a code instead

If you would rather not type a password, or you do not have one yet:

1. Tap the **Magic Link** tab.
2. Type your email and tap **Send magic link**.
3. The app shows **Check your email**. Open the email we send you.
4. The email contains a **sign-in code**. Type it into the **Sign-in code** box in the app and tap **Sign in**.

Two things worth knowing about that email:

- The **button** in the email opens the ResNeo website, not the app. The **code** is what signs you in on the phone, so type the code rather than tapping the button.
- The code is a run of digits. Its length is set by ResNeo and can change, so just copy across whatever the email shows.

If nothing arrives, check the address for a typo and look in your spam folder. Tap **Send another code** to try again.

## Step 4: If you have forgotten your password

Tap **Forgot password?** on the **Password** tab. The screen is titled **Forgotten your password?**.

**There is no password reset inside the app.** Tapping **Email me a sign-in code** sends you the same sign-in code as Step 3. The code gets you in without a password at all, and you can choose a new password once you are in:

1. Sign in with the code.
2. Open the **More** tab.
3. Tap **Account settings**.
4. Under **Change password**, fill in **New password** and **Confirm password**, then tap **Update password**.

You can also change your password on the web, under **Settings → Staff**.

## Step 5: Create a password from an invitation

When an admin invites you, the invitation email takes you to a screen called **Create your password**.

1. Enter a password in the **Password** box. It must be at least 8 characters.
2. Repeat it in **Confirm password**.
3. Tap **Save password and continue**.

From then on you can sign in with your email and password, or keep using sign-in codes. Both work.

## Step 6: Choose where you land

One email address can be two things at once: a member of your team, and a customer with bookings of their own somewhere. The first time that applies to you, the app asks once, in a panel titled **Where would you like to go?**:

- **My venue** takes you to the diary, the tabs and the tools in this category.
- **My own bookings** takes you to your personal bookings as a customer.

The app remembers your answer, so it only asks once. To change your mind later:

1. Open the **More** tab.
2. Scroll to **Your own bookings**.
3. Tap **Switch to my account**.

From the customer side, the way back is **Switch to venue app**.

## "Staff access required"

If you sign in and see **Staff access required**, your email is valid but it is not attached to a venue's team. The screen offers **Try again**, in case it was a passing glitch, and **Sign out**.

The fix is one of these:

- Ask an admin at your venue to invite you as staff, using the email you just tried.
- Sign in with a different email, if you have more than one.
- If you are a client rather than a team member, use the customer side of the app or the ResNeo website instead.

## Common problems & fixes

- **The email arrived but the code does not work.** Codes expire after a short time. Tap **Send another code** and use the newest email; an older code in your inbox will be refused.
- **Tapping the button in the email opened a website, not the app.** That is what the button does. Go back to the app, which is still waiting on the **Check your email** screen, and type the code from that email instead.
- **You never receive the email.** Check the address for a typo, then check spam. Remember that a ResNeo account is created when a venue invites you or when you book with a venue, so if neither has happened there is no account yet.
- **"Invalid login credentials" on the Password tab.** Either the password is wrong, or you have never set one. Use **Magic Link**, then set a password from **More → Account settings**.
- **You are in the wrong side of the app.** Use **More → Switch to my account**, or **Switch to venue app** from the customer side.
- **You are signed in but everything is read-only.** A past due or expired subscription blocks changes. An admin can sort the plan out on the web, under **Settings → Plan**.

## Next steps

- [The diary on your phone](/help/resneo-app/diary-on-your-phone)
- [Finding and updating bookings](/help/resneo-app/bookings-in-the-app)
- [Taking a booking in the app](/help/resneo-app/take-a-booking-in-the-app)
- [Your team and staff logins](/help/getting-started/staff)`,
};
