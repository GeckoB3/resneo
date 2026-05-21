Context
The dashboard class-timetable page (/dashboard/class-timetable) and the customer-facing class booking flow (ClassBookingFlow) need a ground-up rewrite. The current implementation has:

Restaurant booking fields (dietary notes, occasion) leaking into class booking forms
A requires_online_payment boolean that is insufficient - needs deposit / full payment / no payment options
A failed test booking (needs investigation and fix)
No dynamic price/deposit display when party size changes
A dashboard page that lacks the polish and completeness of a professional class management tool

This plan covers two deliverables:

Prompt A: Full rewrite of dashboard/class-timetable (admin-facing)
Prompt B: Spec for the customer-facing class booking tab


Prompt A: Dashboard Class Timetable Page - Full Rewrite
Overview
Delete the existing ClassTimetableView.tsx and rebuild from scratch. The new page must be a complete, professional class booking management interface.
Critical Files to Modify/Replace

src/app/dashboard/class-timetable/ClassTimetableView.tsx (DELETE and rewrite)
src/app/dashboard/class-timetable/page.tsx (update if needed)
src/app/api/venue/classes/route.ts (extend for new payment_requirement field)
src/app/api/venue/classes/generate-instances/route.ts (extend for monthly recurrence)
src/types/booking-models.ts (update ClassType interface)
New migration: add payment_requirement enum column to class_types

Database Changes
New enum and column on class_types:
sql-- Replace the boolean requires_online_payment with a 3-option enum
CREATE TYPE class_payment_requirement AS ENUM ('none', 'deposit', 'full_payment');

ALTER TABLE class_types
  ADD COLUMN payment_requirement class_payment_requirement NOT NULL DEFAULT 'none',
  ADD COLUMN deposit_amount_pence integer; -- only used when payment_requirement = 'deposit'

-- Migrate existing data:
-- requires_online_payment = true AND price_pence > 0 → 'full_payment'
-- requires_online_payment = false → 'none'
-- Then drop requires_online_payment column
Extend class_timetable for richer recurrence:
sqlALTER TABLE class_timetable
  ADD COLUMN recurrence_type text NOT NULL DEFAULT 'weekly', -- 'weekly' | 'biweekly' | 'monthly' | 'custom_interval'
  ADD COLUMN recurrence_end_date date, -- optional end date for the series
  ADD COLUMN total_occurrences integer; -- optional: stop after N occurrences
Section 1: Class Type Management
Create/Edit Class Type Form - Fields (all required unless noted):
FieldTypeValidationNotesNametextrequired, max 200e.g. "Yoga Flow", "Pottery Beginners"Descriptiontextareaoptional, max 2000Shown to customers on booking pageDuration (minutes)number5-480Default 60Capacity (spots)numbermin 1Default 10Price per personcurrency inputmin 0, optionalLeave blank for free classesPayment requirementradio/selectrequiredThree options: (a) No payment required (free or pay at venue), (b) Deposit required at booking - shows deposit amount field, (c) Full payment required at booking. For free classes (no price), this is automatically "No payment required" and greyed outDeposit amount per personcurrency inputrequired when deposit selectedOnly visible when "Deposit required" is chosenColourcolour pickerdefault #6366f1Shown on calendar and booking pageInstructordropdown OR textoptionalDropdown from practitioners list, or free-text "custom label" field. Mutually exclusiveActivetoggledefault trueInactive classes hidden from booking page
Payment requirement UX logic:

If price is blank/zero: payment requirement locked to "No payment required", deposit field hidden
If price > 0: all three options available
If "Deposit required" selected: show deposit amount field with validation (must be > 0 and <= price)
If "Full payment" selected: deposit amount = price (auto-calculated, not editable)
Clear labelling: "No payment required" shows helper text "Customers can book without paying. Collect payment at venue or run free classes."

Class type cards display:

Colour dot, name, duration, capacity
Price (if set) with payment badge: "Free", "Deposit: X", "Full payment: X", "Pay at venue: X"
Instructor name (if set)
Active/inactive badge
Edit, Delete buttons (admin only)
Expandable section for schedule & sessions

Section 2: Recurring Schedule (Timetable Rules)
Per class type, admin can add multiple schedule rules. Each rule has:
FieldTypeOptionsDay of weekselectMonday-SundayStart timetime inputHH:mmRecurrence patternselectWeekly, Every 2 weeks, Every 3 weeks, Every 4 weeks, Every 6 weeks, Every 8 weeksEnd conditionradioNever (ongoing), Until date (date picker), After N occurrences (number input)
Schedule rule display:

Pill/tag per rule showing: "Monday 10:00 - Weekly" or "Wednesday 18:00 - Every 2 weeks until 30 Jun"
Edit button opens inline form pre-populated with current values
Delete button with confirmation

Important: When a schedule rule is deleted, existing generated instances remain. New instances won't be generated from this rule. Show this clearly in the delete confirmation.
Section 3: Instance Generation
Generate instances panel:

"Generate upcoming sessions" button with weeks-ahead selector (1-26 weeks, default 8)
Shows count of instances that will be created before confirming
Clear explanation: "This creates bookable class sessions from your weekly schedule rules. Existing sessions are not duplicated."

Section 4: Calendar View of Instances
Replace the current flat list with a proper calendar view:

Default view: week view showing all class instances across all class types
Colour-coded by class type
Each cell shows: class name, time, booked/capacity (e.g. "3/10")
Click on a cell to open instance detail panel
Month view option for overview
Navigation: previous/next week/month, today button
Filter by class type (multi-select dropdown)

Instance detail panel (slide-out or modal):

Class name, date, time, duration
Capacity: X/Y booked (progress bar)
Instructor name
Payment info: price, payment requirement
Attendee roster table:

Guest name, email, phone
Party size
Booking status (Confirmed, Pending, Cancelled, No-Show)
Deposit status and amount
Check-in status


Actions:

Edit instance (date, time, capacity override)
Cancel instance (with reason, triggers notifications to booked guests)
Download roster as CSV
Add walk-in/phone booking (opens staff booking form)



Section 5: One-Off Sessions
Add one-off session form (per class type or global):

Class type selector (if global)
Date picker
Time picker
Capacity override (optional, defaults to class type capacity)
Clear labelling: "Add a single session outside the regular schedule"

Section 6: Bulk Operations

Select multiple instances (checkboxes) for bulk cancel
Bulk cancel with single reason, sends notifications to all affected guests

Section 7: Class Type Quick Stats
At the top of the page, show summary cards:

Total active class types
Sessions this week / next week
Total bookings this week
Revenue this week (from confirmed deposits/payments)


Prompt B: Customer-Facing Class Booking Tab Spec
Critical Files to Modify/Replace

src/components/booking/ClassBookingFlow.tsx (rewrite)
src/components/booking/DetailsStep.tsx (add variant='class' or pass correct variant)
src/app/api/booking/create/route.ts (update payment logic for deposit vs full payment)
src/lib/availability/class-session-engine.ts (return payment_requirement and deposit_amount)

Bug Fixes (Immediate)
Bug 1: Dietary notes and occasion on class booking form

Root cause: ClassBookingFlow.tsx line 160 renders <DetailsStep> without passing variant="appointment"
Fix: Either pass variant="appointment" to show "Comments or requests" instead of dietary/occasion fields, OR better: add a new variant="class" that shows a "Notes" field with placeholder "Any requirements, injuries, or things we should know?"
The form must NOT show "Dietary notes" or "Occasion" for class bookings

Bug 2: Test class booking failed

Investigate: Check the /api/booking/create endpoint for class_session path
Likely causes to check:

The availability engine returns requires_online_payment from class_types but the venue may not have Stripe connected - this returns 400 "Venue has not set up payments" (line 687-692 in create/route.ts)
The computeClassAvailability may not be returning the correct instance for the selected date
The booking may succeed but payment step fails if Stripe isn't configured
Check if class_instance_id is being passed correctly


Fix: Ensure classes with requires_online_payment=false or free classes go through without Stripe. For paid classes, ensure clear error messaging if Stripe isn't connected.

Bug 3: Payment requirement field missing from class type (current: only boolean)

The current requires_online_payment boolean doesn't support deposit-only. After the DB migration, update the create API to use the new payment_requirement enum.

Booking Flow Steps
Step 1: Date Selection + Class List

Date picker (default today)
List of available classes for that date, each showing:

Colour dot + class name
Start time + duration
Instructor name (if set)
Description (truncated, expandable)
Price per person: "Free", "From X (deposit)" or "X per person"
Remaining spots indicator (green/amber/red)
Disabled with "Full" badge if no spots remaining


Click a class to proceed

Step 2: Spots + Payment Summary

Selected class summary card (name, date, time, instructor)
Number of spots selector (1 to min(remaining, 10))
Dynamic payment breakdown that updates when spots change:

Free class: "Free - no payment required"
No payment required (has price): "X per person - pay at venue. Total: Y" (informational)
Deposit required: "Deposit: X per person. Total deposit: Y. Remaining Z per person due at venue."
Full payment required: "X per person. Total: Y"


This section must recalculate immediately when the spots selector changes

Step 3: Guest Details

Name (required)
Email (required)
Phone (required, E164 validation)
Notes (optional) - placeholder: "Any requirements, injuries, or things we should know?"
NO dietary notes field
NO occasion field
Accept terms checkbox

Step 4: Payment (conditional)

Only shown when payment_requirement is 'deposit' or 'full_payment' AND amount > 0
Shows amount being charged: deposit amount or full amount
Stripe PaymentElement
Cancellation/refund policy text
Skip entirely for free classes and "no payment required" classes

Step 5: Confirmation

Success message with booking details
Class name, date, time, spots booked
Payment summary: what was paid, what's due at venue (if deposit)
"You'll receive a confirmation email shortly"

Payment Calculation Logic (API Side)
Update POST /api/booking/create class_session handler:
typescriptif (effectiveModel === 'class_session') {
  // ... existing availability check ...

  if (cls.payment_requirement === 'full_payment' && cls.price_pence > 0) {
    requiresDeposit = true;
    depositAmountPence = cls.price_pence * party_size;
  } else if (cls.payment_requirement === 'deposit' && cls.deposit_amount_pence > 0) {
    requiresDeposit = true;
    depositAmountPence = cls.deposit_amount_pence * party_size;
  }
  // payment_requirement === 'none' → no deposit, booking confirmed immediately
}
Availability Engine Changes
computeClassAvailability must return these additional fields per slot:

payment_requirement: 'none' | 'deposit' | 'full_payment'
deposit_amount_pence: number | null (per person deposit amount)
instructor_name: string | null (display name from class type)
description: string | null


Implementation Order

Database migration - Add payment_requirement enum, deposit_amount_pence column, migrate data, drop requires_online_payment
Update types - ClassType interface in booking-models.ts
Update API - /api/venue/classes route for new fields, /api/booking/create for new payment logic
Update availability engine - Return new fields from computeClassAvailability
Fix DetailsStep - Add variant='class' support, remove dietary/occasion for classes
Rewrite ClassBookingFlow - New customer booking flow with dynamic pricing
Rewrite ClassTimetableView - Complete dashboard rebuild with calendar view
Investigate and fix test booking failure - Debug the create endpoint

Verification Plan

Unit tests: Update class-session-deposit-rule.test.ts for three payment modes
Manual test - Dashboard:

Create class type with each payment mode (none, deposit, full)
Add weekly schedule rules and generate instances
Edit/delete instances from calendar
Cancel instance and verify notification
View attendee roster


Manual test - Customer booking:

Book a free class - should confirm immediately, no payment step
Book a deposit class - should show deposit amount, go through Stripe
Book a full-payment class - should show full amount, go through Stripe
Book a "pay at venue" class - should confirm immediately with price shown
Change spots and verify price updates dynamically
Verify no dietary/occasion fields appear
Verify "Notes" field appears instead


Preview tool: Use Claude Preview MCP to visually verify both pages render correctly