Cursor Prompt:
"Implement the Appointments Light plan for ReserveNI. This is a new free-tier plan targeting sole traders that offers a single calendar with all non-restaurant booking models (appointments, classes, events, resources), email reminders included, and pay-as-you-go SMS at 8p per message. The plan is free for 3 months, then £10 per month. Users can upgrade to the full Appointments plan (£35/month) at any time.
The existing Appointments plan (£35/month unlimited) and Restaurant plan (£79/month) must remain completely unchanged. This work adds a third plan alongside them.

DATABASE CHANGES
Add a new pricing_tier value. The venues.pricing_tier column currently supports 'standard', 'business', and 'founding'. Add 'light' as a valid value.
Add columns to the venues table for tracking the Light plan lifecycle:
sqlALTER TABLE venues ADD COLUMN IF NOT EXISTS light_plan_free_period_ends_at TIMESTAMPTZ;
-- Set to now() + 3 months when a Light plan venue is created
-- NULL for non-Light venues

ALTER TABLE venues ADD COLUMN IF NOT EXISTS light_plan_converted_at TIMESTAMPTZ;
-- Set when the free period ends and billing begins
-- NULL during free period or for non-Light venues
No changes to the sms_usage or sms_log tables — they already support tracking per venue. The difference for Light plan venues is that their sms_monthly_allowance is 0, so every SMS is an overage charged at 8p.
When creating a Light plan venue, set:

pricing_tier = 'light'
plan_status = 'active'
calendar_count = 1
sms_monthly_allowance = 0
light_plan_free_period_ends_at = now() + interval '3 months'

Add a column to sms_usage to track the per-venue overage rate:
sqlALTER TABLE sms_usage ADD COLUMN IF NOT EXISTS overage_rate_pence INT NOT NULL DEFAULT 6;
When creating sms_usage records for Light plan venues, set overage_rate_pence = 8. For all other plans, set overage_rate_pence = 6.
Update the increment_sms_usage database function to use the venue's overage rate when calculating overage_amount_pence. The function should read the venue's pricing_tier to determine which rate to apply:

Light plan: every SMS is overage at 8p (allowance is 0)
Appointments plan: overages at 6p after 300 included
Restaurant plan: overages at 6p after 800 included


STRIPE CONFIGURATION
Create the following Stripe product and prices:
Product: "Reserve NI Appointments Light"

Price: £10.00 GBP, recurring monthly
Copy the Price ID → set as STRIPE_LIGHT_PRICE_ID

Product: "Reserve NI SMS" (this product should already exist with a 6p price)

Existing Price: £0.06 per unit, metered usage → STRIPE_SMS_OVERAGE_PRICE_ID (used for Appointments and Restaurant plans, no change)
New Price: £0.08 per unit, metered usage → STRIPE_SMS_LIGHT_PRICE_ID (used for Appointments Light plan only)

Both SMS prices sit on the same SMS product but have different unit amounts. Stripe uses the price attached to the subscription item to determine the charge per unit, so the correct rate is applied automatically when usage is reported.
Add these new environment variables:
STRIPE_LIGHT_PRICE_ID=price_xxxxx
STRIPE_SMS_LIGHT_PRICE_ID=price_xxxxx
How SMS billing works per plan:

Appointments Light: every SMS is overage. Usage is reported against the subscription item using STRIPE_SMS_LIGHT_PRICE_ID (£0.08 per unit). Stripe calculates the charge automatically.
Appointments plan: overages after 300 included messages. Usage is reported against the subscription item using STRIPE_SMS_OVERAGE_PRICE_ID (£0.06 per unit).
Restaurant plan: overages after 800 included messages. Usage is reported against the subscription item using STRIPE_SMS_OVERAGE_PRICE_ID (£0.06 per unit).

The application does NOT calculate SMS costs — it only reports the quantity of billable messages to Stripe. Stripe applies the correct rate based on which price ID is attached to the subscription item for that venue.

SIGNUP AND ONBOARDING FLOW
Landing page pricing section:
Update the pricing section to show three cards in this order:
Card 1 — Appointments Light:

Large text: 'Free for 3 months'
Then: '£10/month after'
Subtitle: 'For sole traders getting started'
Benefits list:

'One calendar for you and your business'
'Online booking page your clients can use 24/7'
'Appointments, classes, events, and resource booking'
'Automated email reminders included'
'SMS messages at 8p each — pay only for what you send'
'Client records with visit history'
'Email support'


CTA: 'Start Free'

Card 2 — Appointments (highlight as 'Most Popular'):

Large text: '£35/month'
Subtitle: 'For teams of any size'
Benefits list:

'Unlimited calendars and team members'
'Everything in Light, plus:'
'300 SMS per month included, then 6p each'
'Personal booking links per staff member'
'Phone and email support'


CTA: 'Get Started'

Card 3 — Restaurant:

Large text: '£79/month'
Subtitle: 'For restaurants and hospitality'
Benefits list:

'Unlimited calendars and team members'
'Everything in Appointments, plus:'
'800 SMS per month included, then 6p each'
'Table management with timeline grid and floor plan'
'Priority support'


CTA: 'Get Started'

Below all cards: 'No per-booking fees. No commission. Cancel anytime.'
Plan selection page (/signup/plan):
Update to show three plan options for non-restaurant business types. For restaurant business types, continue showing only the Restaurant plan — no Light or Appointments option appears.
When the user selects Appointments Light:

No calendar count selector needed (fixed at 1)
No Stripe Checkout during signup — the plan is free for 3 months
Show a confirmation: 'Appointments Light — Free for 3 months, then £10/month. No card required to start.'
CTA: 'Start Free'

Payment flow for Light plan:
Do NOT collect payment details at signup. The user starts completely free with no card on file. This removes all friction from the signup process.
At signup:

Create a Stripe Customer record (for future billing and SMS tracking).
Create the venue record with pricing_tier = 'light', plan_status = 'active', light_plan_free_period_ends_at = now() + 3 months, sms_monthly_allowance = 0.
Do NOT create a Stripe subscription yet. No subscription exists until either (a) the user opts into SMS or (b) the free period ends.

When the user opts into SMS (enables any SMS toggle in notification settings):

Check if the venue has a Stripe subscription. If not, show a payment method collection modal: 'To send SMS reminders, we need a payment method on file. You won't be charged for your plan during your free period — only for SMS messages you send at 8p each.'
Create a Stripe Checkout session in 'setup' mode to collect the payment method without charging.
After payment method is collected, create a Stripe subscription with TWO items:

Item 1: STRIPE_LIGHT_PRICE_ID (£10/month recurring) — set to start billing on light_plan_free_period_ends_at date using trial_end so the £10 charge does not begin until the free period ends.
Item 2: STRIPE_SMS_LIGHT_PRICE_ID (£0.08 metered) — active immediately so SMS usage can be reported and billed from day one.


Store stripe_subscription_id and the stripe_subscription_item_id for the SMS metered item on the venue record. The SMS item ID is needed by the overage billing cron to report usage.
SMS toggles now work and messages send normally.

When the free period ends (if the user never opted into SMS and has no subscription):

The light-plan-expiry cron checks if the venue has a payment method and subscription.
If no payment method: pause the booking page and show the dashboard banner as described in the FREE PERIOD EXPIRY section.
If the user later adds a payment method to reactivate: create the subscription with both items (STRIPE_LIGHT_PRICE_ID and STRIPE_SMS_LIGHT_PRICE_ID), with billing starting immediately since the free period has ended.


ONBOARDING WIZARD
The Light plan uses the same unified scheduling wizard as the full Appointments plan: Your Business → Your Team → Your Services → Preview & Go Live.
The only difference is in the 'Your Team' step: show a single calendar or practitioner form pre-filled with the venue owner's name. There is no 'Add team member' button. Instead, show a subtle note beneath the form: 'Need more team members? You can upgrade to the Appointments plan (£35/month) anytime.'

CALENDAR AND FEATURE LIMITS
Single calendar enforcement:
Light plan venues are limited to exactly 1 calendar entity — this means 1 practitioner, OR 1 class type, OR 1 event type, OR 1 resource. They can use any booking model, but only one calendar total.
When a Light plan user attempts to add a second calendar of any type, show a modal:
'Your Appointments Light plan includes one calendar. To add more team members or booking types, upgrade to the Appointments plan.'
Two buttons: [Upgrade to Appointments — £35/month] [Not now]
This check must be enforced server-side on every calendar creation endpoint, not only in the UI. Return a 403 with a clear error message if a Light plan venue attempts to create a second calendar via any route.
Single staff login enforcement:
Light plan venues can have only one staff account (the owner and admin). The 'Invite staff' option in settings is visible but displays the upgrade modal when clicked.
Email reminders included at no charge:
All email-based communications work identically to the Appointments plan. Booking confirmations, email reminders, email confirm-or-cancel, cancellation confirmations, no-show notifications, and post-visit follow-ups are all sent via email at no charge.
SMS is pay-as-you-go:
SMS sending works but every message is billable at 8p. Before the first SMS is sent, check if the venue has a payment method on file:

If yes: send the SMS, log it, increment sms_usage with overage_rate_pence = 8, report usage to the STRIPE_SMS_LIGHT_PRICE_ID subscription item.
If no: show a prompt in the dashboard notification settings: 'Add a payment method to start sending SMS reminders to your clients. SMS messages cost 8p each — you only pay for what you send.' [Add payment method button]

In the dashboard notification settings, the SMS options should show the per-message cost: 'SMS reminders: 8p per message'. Show a toggle to enable or disable SMS for each message type. Default all SMS toggles to OFF for Light plan users. The user actively opts in to SMS. This is unlike the Appointments and Restaurant plans where SMS toggles default to ON.
All other features work identically to the Appointments plan:
Deposits via Stripe Connect, client management and tagging, booking history, reporting, post-visit feedback, booking page with QR code and iFrame widget, CSV export — all included and fully functional.

SMS DASHBOARD FOR LIGHT PLAN
Update the SMS usage dashboard widget and the Settings Plan & Billing section to reflect Light plan pay-as-you-go pricing.
For Light plan venues, the dashboard SMS widget shows:
SMS This Month
23 messages sent
Cost so far: £1.84 (23 × 8p)
Billed at end of month
Do NOT show an allowance progress bar — there is no monthly allowance to track against. Show a running cost total instead.
In Settings → Plan & Billing, the SMS section for Light plan venues shows:

'Your plan: Pay-as-you-go SMS at 8p per message. No monthly allowance.'
'This month: X messages sent = £X.XX estimated charge'
'Upgrade tip: The Appointments plan (£35/month) includes 300 SMS per month. If you send more than 58 SMS messages per month, upgrading could save you money — plus you get unlimited team members and phone support.' [Upgrade to Appointments button]
Recent SMS log table: date, time, message type (confirmation, reminder, etc.), last 4 digits of recipient phone, delivery status (sent, delivered, failed).


FREE PERIOD EXPIRY
Create a cron job at /api/cron/light-plan-expiry that runs daily at 9am. Add to vercel.json: { "path": "/api/cron/light-plan-expiry", "schedule": "0 9 * * *" }. Secure with CRON_SECRET bearer token.
The cron job handles three stages:
14 days before free period ends:
Send an email to the venue owner:
Subject: 'Your Reserve NI free period ends in 14 days'
Body: 'Hi [name], your Appointments Light free period ends on [date]. After that, your plan continues at just £10/month. To keep using Reserve NI, please add a payment method before [date]. All your bookings, clients, and settings are safe — nothing changes except the small monthly charge. [Add Payment Method] Or upgrade to Appointments for £35/month and get unlimited team members and 300 SMS included. [Compare Plans]'
7 days before free period ends:
Send a second reminder email with the same content, subject line updated to 'Your Reserve NI free period ends in 7 days'.
On the day the free period ends:
Check if the venue has a Stripe subscription (they would have one if they opted into SMS earlier):

If subscription exists: the £10/month item billing was deferred to this date via trial_end. Stripe starts billing automatically. Set light_plan_converted_at = now(). No action needed beyond logging.
If no subscription and no payment method: set plan_status = 'past_due'. Disable the public booking page — return a friendly page to clients: 'Online booking for [business name] is temporarily unavailable. Please contact them directly.' Show a persistent banner in the dashboard: 'Your free period has ended. Add a payment method to continue using Reserve NI at £10/month. Your booking page is paused.' [Add Payment Method button]
If no subscription but a payment method was previously saved (edge case): create the subscription immediately with both STRIPE_LIGHT_PRICE_ID and STRIPE_SMS_LIGHT_PRICE_ID, starting billing now. Reactivate the booking page.

3 days after free period ends (if still past_due):
Send a final email: 'Your Reserve NI booking page is currently paused. Add a payment method to reactivate for just £10/month. All your clients and bookings are safely stored — nothing has been deleted.' [Reactivate Now button]
Reactivation at any point after expiry:
When a past_due Light plan venue adds a payment method via the dashboard billing settings, immediately create the Stripe subscription with both price items, set plan_status = 'active', reactivate the booking page, and show a success message: 'Your booking page is live again. Welcome back!'

UPGRADE FROM LIGHT TO APPOINTMENTS
The upgrade must be completely seamless — one click, no data loss, no re-onboarding, no disruption to existing bookings or client records.
Upgrade trigger points:

Settings → Plan & Billing: a prominent 'Upgrade to Appointments' section showing a side-by-side comparison.
When hitting the calendar limit: the upgrade modal described in CALENDAR AND FEATURE LIMITS.
When hitting the staff limit: the upgrade modal when trying to invite a staff member.
When SMS usage suggests upgrading is cheaper: the tip shown in the SMS billing section.
A subtle dashboard banner during the first 30 days: 'You are on Appointments Light. Upgrade to Appointments for unlimited team members and 300 SMS included. [Learn more]'

Upgrade modal content:
Upgrade to Appointments

Appointments Light        →    Appointments
1 calendar                     Unlimited calendars
1 staff member                 Unlimited staff
SMS at 8p each                 300 SMS included, then 6p
Email support                  Phone and email support
£10/month (or free now)         £35/month

Your clients, bookings, and settings transfer automatically.
Nothing is lost or disrupted.

[Upgrade Now — £35/month]   [Not yet]
Upgrade flow:

User clicks 'Upgrade Now'.
Redirect to Stripe Checkout with two subscription items:

STRIPE_STANDARD_PRICE_ID (£35/month recurring)
STRIPE_SMS_OVERAGE_PRICE_ID (£0.06 metered — replaces the 8p Light SMS price)


If the venue currently has a Light plan subscription (either the £10/month or just the SMS metered item), cancel it immediately on successful Checkout completion. Do not wait for the billing period to end.
On successful payment (via checkout.session.completed webhook): update the venue record:

pricing_tier = 'standard'
calendar_count = NULL (unlimited)
sms_monthly_allowance = 300
stripe_subscription_id = new subscription ID
stripe_subscription_item_id = the SMS item ID from the new subscription
light_plan_free_period_ends_at = NULL
light_plan_converted_at = NULL
plan_status = 'active'


Immediately unlock all Appointments plan features: the 'Add team member' button works, the calendar limit is removed, SMS toggles switch to default ON behaviour (with 300 included allowance), phone support becomes available.
Show a confirmation screen: 'Welcome to the Appointments plan. You now have unlimited team members and 300 SMS per month included. Your existing clients and bookings are all here.' [Add a team member] [Go to Dashboard]

Downgrade from Appointments to Light:
Allow this only if the venue currently has 1 or fewer active calendars and 1 or fewer staff members. If they have more, show: 'To switch to Appointments Light, you will need to reduce to 1 active calendar and 1 staff member first.' On downgrade, cancel the Appointments subscription, create a new Light subscription (both STRIPE_LIGHT_PRICE_ID and STRIPE_SMS_LIGHT_PRICE_ID), update the venue record to pricing_tier = 'light', calendar_count = 1, sms_monthly_allowance = 0. Reset SMS toggles to OFF. The venue is not given another 3-month free period on downgrade — billing begins immediately at £10/month.

ACCESS CONTROL AND MIDDLEWARE
Update the existing access control middleware to handle the Light plan:
Venue stateDashboardBooking pageLight, plan_status = 'active', within free periodFull access, limits enforcedLive and accepting bookingsLight, plan_status = 'active', post free period (converted)Full access, limits enforcedLive and accepting bookingsLight, plan_status = 'past_due'Read-only with payment bannerDisabled with friendly messageLight, plan_status = 'cancelled'Resubscribe pageDisabled
The dashboard remains fully readable when past_due so the owner can see their data and add a payment method. Only write actions (creating bookings, editing settings) are blocked.

COMMUNICATION ENGINE UPDATE
Update the communication engine's channel routing to handle Light plan SMS:
function getChannelsForMessage(messageType, venue):

  if venue.pricing_tier is 'light':
    if SMS toggles are OFF (default): return ['email']
    if SMS toggles are ON and no payment method: return ['email']
    -- log a warning that SMS was requested but no payment method on file
    if SMS toggles are ON and payment method exists: return ['email', 'sms']
    -- every SMS sent for Light plan is logged at 8p rate

  if venue.pricing_tier is 'standard' or 'business' or 'founding':
    -- existing routing logic unchanged
    -- reminders and confirm-or-cancel via SMS
    -- cancellations and post-visit via email only
    -- etc.
When sending SMS for a Light plan venue, after the Twilio send call:

Log to sms_log as normal.
Call increment_sms_usage with the venue_id — the function reads the venue's overage_rate_pence (8 for Light plan) and updates sms_usage accordingly.
Report 1 unit of usage to Stripe against the venue's STRIPE_SMS_LIGHT_PRICE_ID subscription item using stripe.subscriptionItems.createUsageRecord().

Step 3 must happen for every single SMS sent on the Light plan. Usage reporting to Stripe is how billing is generated — if this step is missed, the SMS is sent but never billed.

TESTING SCENARIOS
Verify these end-to-end:

SIGNUP: Solo barber selects Appointments Light → no payment required → completes onboarding wizard → lands on dashboard with 1 calendar → booking page is live → can accept bookings → no Stripe subscription created yet.
EMAIL REMINDERS: Booking is created → confirmation email sent → 24h reminder email with confirm-or-cancel link → client confirms → status updates. No SMS sent (toggles are off by default).
SMS OPT-IN: User enables SMS in notification settings → prompted to add payment method → adds card via Stripe setup mode Checkout → subscription created with both STRIPE_LIGHT_PRICE_ID (deferred to free period end) and STRIPE_SMS_LIGHT_PRICE_ID (active immediately) → SMS now sends → logged at 8p → sms_usage tracks correctly → dashboard widget shows running cost → usage reported to Stripe.
CALENDAR LIMIT ENFORCED IN UI: User tries to add a second practitioner → upgrade modal appears → 'Not yet' dismisses → 'Upgrade' starts upgrade flow.
CALENDAR LIMIT ENFORCED SERVER-SIDE: Direct API call to create a second practitioner on a Light plan venue → returns 403 with clear error message. The limit cannot be bypassed via the API.
STAFF LIMIT: User tries to invite a staff member via settings → upgrade modal appears.
FREE PERIOD WARNINGS: 14 days before expiry → email sent to venue owner. 7 days before → second email sent. Check cron logs to confirm both fired correctly.
FREE PERIOD EXPIRY WITH PAYMENT METHOD: Venue has added a payment method (via SMS opt-in). On the expiry date, the Stripe subscription's trial_end is reached → Stripe automatically begins billing £10/month → light_plan_converted_at set → no disruption to dashboard or booking page.
FREE PERIOD EXPIRY WITHOUT PAYMENT METHOD: Venue never added a payment method. On the expiry date, cron runs → plan_status set to 'past_due' → booking page disabled with friendly client message → dashboard shows banner with payment prompt.
REACTIVATION: Venue in past_due state adds payment method → subscription created immediately → plan_status = 'active' → booking page reactivates → all historical data intact → success message shown.
UPGRADE DURING FREE PERIOD: User upgrades during month 2 → Stripe Checkout for £35/month with 6p SMS → Light subscription cancelled → venue unlocks unlimited calendars → can add team members immediately → SMS allowance becomes 300 → SMS toggles default to ON.
UPGRADE POST FREE PERIOD: User on £10/month billing upgrades to Appointments → old Light subscription cancelled → new £35/month subscription created → features unlock immediately → SMS item switches from STRIPE_SMS_LIGHT_PRICE_ID (8p) to STRIPE_SMS_OVERAGE_PRICE_ID (6p).
DOWNGRADE: Appointments user with 1 calendar and 1 staff downgrades to Light → new subscription at £10/month → calendar limit enforced → SMS allowance drops to 0 → SMS toggles reset to OFF → no new free period granted.
SMS BILLING LIGHT PLAN: Light plan user sends 50 SMS in a month → overage billing cron reports 50 units to STRIPE_SMS_LIGHT_PRICE_ID subscription item → Stripe calculates 50 × £0.08 = £4.00 → charge appears on next invoice at the correct 8p rate.
SMS PRICE ISOLATION: Verify that reporting usage for a Light plan venue uses STRIPE_SMS_LIGHT_PRICE_ID (8p). Verify that reporting usage for an Appointments plan venue uses STRIPE_SMS_OVERAGE_PRICE_ID (6p). Verify that upgrading from Light to Appointments switches the SMS subscription item from the 8p price to the 6p price. The two rates must never be mixed on the same venue at the same time.
RESTAURANT PLAN UNAFFECTED: Restaurant venue sees no changes to their experience. No Light plan option visible anywhere. Table management, floor plan, day sheet, and all restaurant features work as before.
APPOINTMENTS PLAN UNAFFECTED: Appointments plan venue (£35/month) sees no changes. 300 SMS included, 6p overage, unlimited calendars, phone support — all unchanged.


CRITICAL RULES

The Light plan is ONLY available for non-restaurant business types. The Light plan option must never appear for restaurant venues at any point in the signup or settings flow.
During the free period, do NOT collect payment details at signup under any circumstances. The only triggers for collecting a payment method are SMS opt-in and free period expiry. Any payment friction at signup will undermine the free-tier acquisition strategy.
Never delete data when a free period expires without payment. Pause the booking page, show banners, send emails — but the venue's clients, bookings, calendar, and all settings must be preserved indefinitely. A venue may come back and pay weeks or months later.
The upgrade from Light to Appointments must be completely seamless — no data migration, no re-onboarding, no disruption to existing bookings or client records. The venue record is updated in place and features unlock immediately on webhook receipt.
SMS toggles default to OFF on the Light plan to prevent unexpected charges. SMS toggles default to ON on the Appointments and Restaurant plans where SMS is included in the allowance.
Every SMS sent by a Light plan venue must be logged, tracked, and reported to Stripe for billing in the same request lifecycle as the send. There is no free SMS on this plan. Missing a usage report to Stripe means the SMS is sent but never billed — this is a revenue leak.
The Light plan calendar limit of 1 is enforced both in the UI and on every server-side creation endpoint. The limit cannot be bypassed by calling the API directly.
SMS billing uses two separate Stripe price IDs with different unit rates. STRIPE_SMS_LIGHT_PRICE_ID (8p) is ONLY attached to Light plan subscriptions. STRIPE_SMS_OVERAGE_PRICE_ID (6p) is ONLY attached to Appointments and Restaurant plan subscriptions. The application never calculates SMS costs — it reports usage quantities to Stripe and the attached price ID determines the rate. When a venue upgrades from Light to Appointments, the SMS subscription item must be switched from the 8p price to the 6p price as part of the upgrade webhook handler.
When the Light plan subscription is created with a deferred start date (using trial_end set to light_plan_free_period_ends_at), the SMS metered item must be active from day one. Only the £10/month recurring item should be deferred. SMS usage must be billable from the moment the user opts in.
The downgrade path from Appointments to Light does not grant a new free period. Billing begins at £10/month immediately on downgrade."