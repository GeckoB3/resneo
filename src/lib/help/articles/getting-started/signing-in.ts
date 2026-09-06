import type { HelpArticle } from '../../types';
import { MAGIC_LINK_EXPIRY_HOURS } from '@/lib/auth/magic-link-lifetime';

export const article: HelpArticle = {
  slug: "signing-in",
  helpSection: "gs-start-here",
  title: "Signing in to ResNeo",
  description: "The two ways into your account, creating a password from an invite or a reset link, and what to do when a link has expired.",
  tags: ["sign in","login","password","magic link","sign-in link","session","logout","invite"],
  verified: '2026-09-06',
  content: `# Signing in to ResNeo

Everything you do in ResNeo starts at the same sign-in page. You can use a password, or ask for a link by email and skip the password altogether. Both ways get you to the same place.

This article covers the normal ways in. If you are locked out, or a colleague cannot reach a screen you think they should, see [Login, staff access and permissions](/help/troubleshooting/access-issues).

## Before you start

- Use the email address your ResNeo account was set up with. That is the address your invitation arrived at, or the one you signed up with.
- To reach the sign-in page, click **Log in** at the top right of the ResNeo website.
- The page has two tabs, **Password** and **Magic Link**. They sign you into the same account, so use whichever suits you.

## Step 1: Sign in with your password

1. Open the sign-in page. The **Password** tab is already selected.
2. Fill in **Email** and **Password**.
3. Click **Sign In**. It reads **Signing in...** while it works.

You land on your dashboard. If your account is also a client account somewhere, you are asked **Where would you like to go?** first, which is explained further down.

A wrong password shows a short red message under the fields. Try again, or use **Forgot password?**.

## Step 2: Or get a link by email instead

This is handy when you cannot remember your password, or you are on a phone and would rather not type one.

1. On the sign-in page, click the **Magic Link** tab.
2. Fill in **Email**.
3. Click **Send Magic Link**. The screen changes to "Check your inbox for the sign-in link."
4. Open the email titled **Sign in to ResNeo** and click the **Sign in to ResNeo** button in it.
5. You are signed in and taken to your dashboard.

Open the link on the device you want to be signed in on. It signs in whichever browser opens it, not the one you asked from, so a link opened on your phone signs your phone in.

> **Good to know:** the email says "This link works once and expires in ${MAGIC_LINK_EXPIRY_HOURS} hours." If you have asked more than once, always open the newest email.

To go back to the password form, click **Sign in with password instead**.

There is a limit on how many links can be sent to one address in a quarter of an hour. Past it, the page says "Too many sign-in link requests. Try again shortly." Check your inbox and your spam folder, and try again in a few minutes.

## The code in that email

Under the button, the sign-in email shows a short number after the line "Using the ResNeo app? Enter this code instead:". It is there for the ResNeo app, and for email programs that mangle links. You do not need it to sign in on a computer.

Do not count the digits or assume it is the same length as last time: the length is set for each ResNeo environment and can differ. Type in exactly what the email shows.

> **Warning:** never forward a sign-in email or read that code out to anyone. Either one is enough to get into your account.

## Create your password from an invite or a reset link

You do not pick a password when you are invited. You choose it the first time you follow your link.

1. Open the email. An invitation has the subject **Sign in to** your venue name **on ResNeo** and a **Sign in and continue** link. A reset email arrives after you use **Forgot password?** below.
2. Follow the link. The **Create your password** page opens.
3. Type the same password into **Password** and **Confirm password**. It has to be at least 8 characters.
4. Click **Continue to dashboard**.

From then on you can use either tab on the sign-in page: your new password, or a link by email.

> **Good to know:** these links work once. If you open an invitation twice, the second attempt shows **Password link unavailable** and a **Go to login** button. That is not a fault with your account, it just means you need a fresh link.

## If you forget your password

1. On the sign-in page, click **Forgot password?** underneath the **Sign In** button.
2. The form changes to "Enter your email and we'll send you a reset link." Fill in **Email**.
3. Click **Send Reset Link**. You see "Check your inbox for a link to reset your password."
4. Open the link in that email and choose a new password on **Create your password**.

**Back to sign in** takes you back without sending anything. If the email does not arrive, check your spam folder, and check the address is the one your account uses.

Admins can also set a password for a team member who is completely stuck, under **Settings**, then the **Staff** tab. See [add and manage your team](/help/getting-started/staff).

## "Where would you like to go?"

Some people have two kinds of access with one email address: they run a venue, and they are also a client who books somewhere on ResNeo. When that is true, signing in shows **Where would you like to go?** with the note "Your account has access to more than one area. Pick a destination. You can switch later."

- **Venue dashboard**: "Manage bookings, guests, and your venue". This is your business.
- **My bookings (account)**: "View and manage your own bookings". This is you as a client.

Pick one and carry on. Nothing is decided for good, and you can move between the two afterwards. If you only have one kind of access, ResNeo never asks and takes you straight there.

To stop being asked every time, open your client account, go to **Profile**, and in the **Dates and sign-in** section set **Default destination after login** to **Venue dashboard** or **Account**. Leaving it on **Ask when needed** keeps the question.

> **Good to know:** a third card, **Sales dashboard**, appears only for ResNeo sales partners.

## When a link says it has expired

Sign-in links, invitations and reset links are all single use, and they run out after a while. When one has been used or has aged, the sign-in page explains what happened:

- "This sign-in link was already used or has expired. Please request a new link."
- "We could not complete sign-in from that link. Use the latest link from your email, request a new sign-in link, or sign in with your password if you have one."

The fix is the same for all of them: ask for a new link and open that one, or use your password instead. Two things cause this more often than anything else. Opening an older email when a newer one has arrived, and having a link opened for you by an email scanner before you get to it.

If a fresh link still does not work, see [Login, staff access and permissions](/help/troubleshooting/access-issues).

## How long you stay signed in

Your dashboard signs you out on its own after a period of no activity. Clicking, typing and scrolling all count as activity and start the clock again.

The length is a venue-wide setting called **Auto-Logout Timer**, under **Settings**, then the **Staff** tab, in the **Security settings** card. Only admins can change it, it applies to everybody who signs into your venue, and the longest allowed is 7 days. A shared front desk device is much safer on a short setting. The choices and how to save them are in [add and manage your team](/help/getting-started/staff).

When the timer runs out you land back on the sign-in page with "Your session has expired due to inactivity. Please sign in again." Nothing is lost apart from anything you had typed and not saved.

## Signing out

**Sign out** is at the bottom of the sidebar. It signs you out everywhere you are signed in with that account, not just the browser you clicked it in, and it clears the data ResNeo had saved on that device. That is deliberate, so a shared computer does not leave your venue open to the next person.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| The sign-in page sends me straight to my dashboard | You are still signed in | Nothing to fix. Use **Sign out** in the sidebar first if you want to sign in as someone else |
| The sign-in link email never arrived | It went to spam, or the address is not the one on your account | Check your spam folder, then try the address your invitation came to. Ask an admin to check the email on your staff record |
| "This sign-in link was already used or has expired" | The link was single use, or an older email was opened | Ask for a new link and open the newest email, or use the **Password** tab |
| **Password link unavailable** | An invitation or reset link has already been used | Click **Go to login**, then use **Forgot password?** to get a fresh one |
| I am asked for a password I never set | You were invited and have not finished setting one | Use **Forgot password?**, then choose a password on **Create your password** |
| I keep being signed out during the day | The **Auto-Logout Timer** is short for how you work | Ask an admin to raise it under **Settings**, then **Staff** |
| ResNeo asks **Where would you like to go?** every time | Your email has both venue access and a client account | Set **Default destination after login** on your client account **Profile**, under **Dates and sign-in** |
| I signed out on the till and my phone signed out too | Signing out ends the session everywhere | This is expected. Sign in again on the device you need |
| I see **Account** instead of **Settings** | You are signed in as a team member, not an admin | Ask an admin, or see [Login, staff access and permissions](/help/troubleshooting/access-issues) |

## Next steps

- [Welcome to ResNeo](/help/getting-started/welcome)
- [Add and manage your team](/help/getting-started/staff)
- [Login, staff access and permissions](/help/troubleshooting/access-issues)`,
};
