# ResNeo testing

End-to-end functional test pass across the appointments product, exercised from both
sides of the counter: the venue staff who configure and run the business, and the
customer who books and manages their own appointment.

Everything here is tested against **real data on the dev server**. Services, add-ons
and bookings are actually created, not mocked, and payments run through Stripe in
test mode.

---

## 1. Environment and conventions

| Item | Value |
| --- | --- |
| Dev server | `http://localhost:3000` (already running) |
| Staff login | `plus1@reserveni.com` (already signed in) |
| Venue booking page | `http://localhost:3000/book/plus-1` |
| Collective page | `http://localhost:3000/book/c/plus-1` |
| Dashboard | `http://localhost:3000/dashboard` |

### Test customer identity

All bookings are made as:

- **Name:** Andrew Courtney
- **Email:** andrewcourtney@gmail.com
- **Phone:** 07725002232

These contact details are already saved against the venue, so the booking form may
autofill or match an existing contact. That matching behaviour is itself worth
observing and is covered in test **G4**.

### Test card

| Field | Value |
| --- | --- |
| Number | `4242 4242 4242 4242` |
| Expiry | `12/34` |
| CVC | `123` |
| Postcode | any valid value, e.g. `BT1 1AA` |

Where a test needs a card that behaves differently (declines, requires 3DS,
insufficient funds), the relevant Stripe test number is named in the test itself.

### Naming convention for test data

Every service, variant and add-on group created during this pass is prefixed `TEST`
followed by the test ID, for example `TEST A3 Colour and cut`. This keeps the pass
auditable, makes findings traceable to the exact artefact that produced them, and
makes cleanup at the end a single filtered sweep.

### How each test is recorded

Each test is run in turn and its result written into the findings log in section 12
using this shape:

- **ID** and short title
- **Steps actually taken** (the real click path, not the intended one)
- **Expected** result
- **Actual** result
- **Status:** Pass / Pass with notes / Fail / Blocked
- **Severity** where it is not a pass (see section 13)
- **Evidence:** screenshot, booking reference, service ID, or API response

A test that fails does not stop the pass. It is logged and the next test continues,
unless the failure blocks the artefacts a later test depends on, in which case the
dependent tests are marked **Blocked** and revisited after the fix.

---

## 2. What the product actually offers (scope map)

The test plan below is built from the real feature surface in the codebase, not from
assumptions about what a booking system usually does. The areas in scope:

**Catalogue**

- Services with duration, price, buffer, category, description, photo
- Payment requirement per service: `none`, `deposit`, `full_payment`, `card_hold`
- Service variants (an alternative duration, price and deposit under one service)
- Processing time blocks (a gap mid-service where the practitioner is free)
- Add-on groups and add-ons, with min and max selection rules
- Per-practitioner service overrides (different price or duration per staff member)
- Staff permission to customise price and deposit at the point of booking

**Scheduling**

- Opening hours, staff schedules, leave, calendar blocks, business closures
- Minimum notice, maximum advance booking window
- Any-available-practitioner resolution
- Buffers and processing time affecting slot availability

**Booking flows**

- Public single booking: service, variant, add-ons, practitioner, slot, details
- Multi-service booking in one visit
- Group booking (several people in one transaction)
- Staff-first booking (pick the person before the service)
- Staff-side booking from the dashboard, including walk-ins
- Waitlist join when nothing is available

**Payment**

- No payment, deposit, full payment up front, card hold for a no-show fee
- Staff waiving or customising a deposit
- Payment on arrival, in-person payment

**Management**

- Reschedule, modify services, cancel, no-show, check-in
- Charging a card hold, taking a balance, refunding
- Notes, tags, messaging the customer, resending confirmations

**Customer self-service**

- The `/manage/{bookingId}` guest link
- The `/account` customer portal: bookings, payment methods, profile

---

## 3. Part A: Service setup

Built in **Dashboard > Services**. Each test creates a real service, saves it,
reopens it to confirm the values persisted, and confirms how it renders on the
public booking page.

| ID | Test | What it proves |
| --- | --- | --- |
| A1 | Simplest possible service: name, 30 min, £25, no payment required | The baseline create path and the public listing |
| A2 | Service with a description, category and photo | Rich catalogue fields survive save and render publicly |
| A3 | Service with a buffer (30 min service, 15 min buffer) | Buffer is reserved after the appointment and blocks the next slot |
| A4 | Service requiring a **deposit** (£60 service, £20 deposit) | Deposit is stored, shown publicly and demanded at checkout |
| A5 | Service requiring **full payment** up front (£40) | Full price is charged, not a deposit |
| A6 | Service requiring a **card hold** with a £25 no-show fee | Card is saved without charging, and the fee amount is the hold amount |
| A7 | Service with **variants**: Short (30 min, £30) and Long (60 min, £55) | Variant duration and price override the parent |
| A8 | Service with variants where **each variant has its own deposit** | Deposit policy resolves from the variant, not the parent |
| A9 | Service with **processing time**: 30 min on, 45 min gap, 15 min on | The practitioner is bookable during the gap |
| A10 | Free service (£0) | Zero price is a valid state, not an empty one |
| A11 | Service with **staff may customise price** enabled | Staff can override price at booking time |
| A12 | Service with **staff may customise deposit** enabled | Staff can waive or change the deposit at booking time |
| A13 | **Per-practitioner override**: same service, different price and duration for a second staff member | The right price and duration are used once a practitioner is chosen |
| A14 | Deactivate a service | It disappears from the public page but existing bookings survive |
| A15 | Delete a service that has bookings against it | The guard behaves sensibly rather than orphaning data |
| A16 | Reorder services and categories | Ordering persists and matches the public page |
| A17 | Edit a service price after a booking exists at the old price | The historical booking keeps its snapshotted price |

**Validation and negative cases**

| ID | Test | Expected |
| --- | --- | --- |
| A18 | Deposit greater than the service price | Rejected with a clear message |
| A19 | Negative or non-numeric price or duration | Rejected |
| A20 | Full payment or deposit set while Stripe is not connected | Blocked with an explanation, not a broken checkout |
| A21 | Processing blocks that exceed the total duration | Rejected with the specific reason |
| A22 | Duplicate service name | Allowed or rejected, but consistently and clearly |

---

## 4. Part B: Add-ons

Built in **Dashboard > Services > Add-ons**.

| ID | Test | What it proves |
| --- | --- | --- |
| B1 | Create an add-on group `TEST B1 Treatments`, optional, pick any | Group create path |
| B2 | Add three add-ons with different price and duration deltas | Deltas are stored per add-on |
| B3 | Add-on with a price but **no** extra duration | Price-only add-ons work |
| B4 | Add-on with duration but **no** extra price | Duration-only add-ons work |
| B5 | Group with **min 1, max 1** (pick exactly one, required) | The customer cannot continue without choosing |
| B6 | Group with **min 0, max 2** | At most two selectable, zero allowed |
| B7 | Group with **min 2** | Enforced at the point of selection |
| B8 | Link one group to two different services | Groups are reusable, not owned by a service |
| B9 | Link two groups to one service | Both render and both enforce their own rules |
| B10 | Deactivate an add-on inside a live group | It stops being offered without breaking existing bookings |
| B11 | Add-ons attached to a service that also has variants | Add-on cost stacks on top of the resolved variant price |

---

## 5. Part C: Scheduling and availability configuration

Current settings are recorded before each change so they can be restored in section 14.

| ID | Test | What it proves |
| --- | --- | --- |
| C1 | Set venue opening hours, then confirm no slots exist outside them | Hours gate availability |
| C2 | Set a staff member's working pattern narrower than the venue hours | Staff schedule further restricts slots |
| C3 | Book staff leave for a full day | That day disappears for that practitioner only |
| C4 | Add a calendar block for two hours | Those slots vanish, surrounding slots remain |
| C5 | Add a business closure (whole venue, one day) | No practitioner is bookable that day |
| C6 | Set **minimum notice** to 24 hours | Today and tomorrow morning become unbookable publicly |
| C7 | Set **maximum advance booking** to 14 days | The date picker stops at the boundary |
| C8 | Enable **any available practitioner** | The customer can skip choosing and the system assigns |
| C9 | Disable it | The practitioner step becomes mandatory |
| C10 | Two practitioners, one already booked | Only the free one is offered at the clashing time |
| C11 | Buffer collision (uses A3) | The slot immediately after a buffered booking is not offered |
| C12 | Processing time (uses A9) | Another booking can be placed inside the processing gap |

---

## 6. Part D: Customer booking flows (public page)

All run from `http://localhost:3000/book/plus-1` in a guest context, so they reflect
what a real customer sees. Each booking is completed for real and its reference is
recorded.

### Single service

| ID | Test | Payment behaviour expected |
| --- | --- | --- |
| D1 | Book the simple service (A1) | No payment step at all |
| D2 | Book the deposit service (A4) | Card taken, £20 charged, balance shown as due |
| D3 | Book the full payment service (A5) | Card taken, £40 charged, nothing outstanding |
| D4 | Book the card hold service (A6) | Card saved, **£0 taken now**, no-show fee disclosed |
| D5 | Book the free service (A10) | Confirms with no payment step |

### Variants and add-ons

| ID | Test |
| --- | --- |
| D6 | Book a service choosing the **short** variant, and check the duration and price on the confirmation |
| D7 | Book the same service choosing the **long** variant and confirm the totals differ correctly |
| D8 | Book a variant carrying its own deposit (A8) and confirm the variant deposit is charged |
| D9 | Book a service and select **one** add-on, then confirm price and end time both move |
| D10 | Book a service and select **multiple** add-ons, then confirm both deltas accumulate |
| D11 | Book a service with a required (min 1) add-on group and attempt to skip it |
| D12 | Book a service with **variant plus add-ons together** (B11) and verify the arithmetic end to end |
| D13 | Book a full payment service **with add-ons** and confirm the charge is the price after add-ons, not the base price |

### Multi-service and group

| ID | Test |
| --- | --- |
| D14 | Book **two services in one visit**, back to back, same practitioner |
| D15 | Book **two services in one visit with different practitioners** |
| D16 | Book **three services**, at least one with a variant and one with add-ons |
| D17 | Multi-service where one service needs a deposit and one does not, expecting one combined charge |
| D18 | Multi-service where the combined duration crosses closing time, expecting refusal or absence |
| D19 | **Group booking** for two people, same service |
| D20 | Group booking for two people, **different** services and practitioners |
| D21 | Group booking where one person's service requires payment |

### Flow shape and entry points

| ID | Test |
| --- | --- |
| D22 | **Staff-first** flow: pick the practitioner before the service |
| D23 | Direct practitioner link `/book/plus-1/{practitioner}`, confirming the practitioner is locked |
| D24 | Book via the **collective** page `/book/c/plus-1` |
| D25 | Booking when nothing is available: **join the waitlist** |
| D26 | Abandon at the payment step, then return, confirming no phantom booking holds the slot |
| D27 | Use the browser back button mid-flow and confirm state is not corrupted |
| D28 | Two tabs racing for the **last remaining slot**, expecting the loser to get a clean error rather than a double booking |

### Compliance and consent

| ID | Test |
| --- | --- |
| D29 | Service with a required compliance form attached, which must be completed before booking |
| D30 | Marketing consent checkbox state is recorded against the contact |

---

## 7. Part E: Staff-side booking creation

From the dashboard calendar and the bookings list.

| ID | Test |
| --- | --- |
| E1 | Create a booking from the calendar by clicking an empty slot |
| E2 | Create a booking for a **deposit** service as staff, sending a payment link rather than taking the card |
| E3 | Create the same booking and **waive the deposit** (uses A12) |
| E4 | Create a booking and **override the price** (uses A11) |
| E5 | Create a booking with a **custom duration** different from the service default |
| E6 | Create a **walk-in** |
| E7 | Create a booking for a **card hold** service as staff and compare the hold behaviour with the public flow |
| E8 | Create a booking in the past (back-dating) |
| E9 | Deliberately **double book** a practitioner and check the conflict warning |
| E10 | Create a multi-service visit from the staff side |
| E11 | Create a booking for a brand new customer, not the saved contact |

---

## 8. Part F: Managing existing appointments

Run against the bookings created in parts D and E.

### Changing the booking

| ID | Test |
| --- | --- |
| F1 | **Reschedule** to a different time the same day |
| F2 | Reschedule to a different day |
| F3 | Reschedule to a slot that is not actually free, expecting refusal |
| F4 | **Change the practitioner** on an existing booking |
| F5 | **Add a service** to an existing booking and confirm price and end time update |
| F6 | **Remove a service** from a multi-service booking |
| F7 | **Change the variant** on an existing booking |
| F8 | **Add or remove an add-on** after booking |
| F9 | Extend the **duration** manually and confirm the calendar reflows |
| F10 | Confirm the customer is notified, or deliberately not notified, for each change per the notify toggle |

### Status transitions

| ID | Test |
| --- | --- |
| F11 | **Check in** an arriving customer |
| F12 | Mark **complete** |
| F13 | Mark **no-show** on a card hold booking, then **charge the no-show fee** |
| F14 | Mark no-show on a booking with **no card on file** and check the messaging is honest |
| F15 | **Cancel** as staff, with and without a refund |
| F16 | Cancel a booking with a paid deposit, checking the refund path and what the customer is told |

### Money

| ID | Test |
| --- | --- |
| F17 | Take the **outstanding balance** on a deposit booking |
| F18 | Record an **in-person or cash** payment |
| F19 | **Refund** a full payment |
| F20 | **Partial refund** |
| F21 | Confirm every one of the above is reflected in **Reports** |

### Communication and records

| ID | Test |
| --- | --- |
| F22 | **Resend the confirmation** email |
| F23 | **Message the customer** from the booking |
| F24 | Add an internal **note** and confirm it is not customer visible |
| F25 | Add a **tag** to the customer and confirm it persists on their contact record |

---

## 9. Part G: Customer self-service

| ID | Test |
| --- | --- |
| G1 | Open the `/manage/{bookingId}` link from the confirmation email |
| G2 | **Reschedule** from the guest manage link |
| G3 | **Cancel** from the guest manage link, inside and outside the cancellation window |
| G4 | Confirm the saved contact details autofill correctly and do not create a duplicate contact |
| G5 | Sign in to `/account` and view booking history |
| G6 | Manage **saved payment methods** in `/account` |
| G7 | Update profile details in `/account` and confirm they flow through to a new booking |
| G8 | Confirm a customer cannot open another customer's booking by changing the ID in the URL |

---

## 10. Part H: Notifications

Checked alongside the tests that trigger them rather than as a separate pass, but
recorded here so nothing is missed.

| ID | Test |
| --- | --- |
| H1 | Booking confirmation email content: correct service, variant, add-ons, price, time, practitioner |
| H2 | Confirmation for a **deposit** booking states what was paid and what remains |
| H3 | Confirmation for a **card hold** states clearly that nothing was charged |
| H4 | Reschedule notification |
| H5 | Cancellation notification |
| H6 | Reminder content, checked against the template and the scheduled job |
| H7 | Staff notification of a new booking |
| H8 | No em-dashes and no placeholder text anywhere in customer-facing copy encountered during the pass |

---

## 11. Part I: Cross-cutting checks

Applied continuously rather than as discrete steps, and logged whenever they fail.

- **Mobile layout** for the public booking flow at 375px width
- **Dark mode** where supported
- **Console errors** on every page visited
- **Slow or duplicated network requests** in the booking flow
- **Accessibility basics:** keyboard reachability of the booking flow, focus states, labelled inputs
- **Currency formatting** correctness at every surface showing a price
- **Time zone** correctness for slot times, confirmations and reminders

---

## 12. Findings log

Executed 20 August 2026 against the dev server, venue `plus-1`. Ten test services,
two add-on groups and eight real bookings were created. Covers Parts A, B, D
(partly), E, F and G (partly).

**19 findings: 18 defects (6 High, 5 Medium, 7 Low) and 1 reclassified as by design.**
**3 fixed (F7, G2a, F18). 15 defects outstanding: 4 High, 4 Medium, 7 Low.**

> Severities have moved as findings were investigated properly. F5 turned out to be
> deliberate behaviour, F18's mechanism was not what it first appeared and dropped
> from High to Medium, and the original Critical (G2) was withdrawn entirely. Each is
> explained where it appears rather than quietly amended.

> **Correction, and an important one.** An earlier version of this report carried a
> Critical finding, "G2: a long booking can be placed straight over a shorter one".
> **That finding was wrong and has been withdrawn.** The availability engine is
> correct. The first entry in 12.2 explains what actually happened and why it looked
> like a bug. No other finding depended on it, but the two that shared its label
> (G2a, G2b) were re-checked and both stand on their own evidence.

| ID | Test | Status | Severity | Summary |
| --- | --- | --- | --- | --- |
| **F7** | Change a variant | **FIXED** | High | Price updated but name and duration did not. Booking read "Basic, 30 min, £80.00". Fixed and verified, see 12.6. |
| **F5** | Swap a service in a visit | **By design** | Medium | The old price is pinned deliberately. Not a bug, but the pin is invisible so it reads as one. See 12.2. |
| **G2a** | Guest changes service | **FIXED** | High | Guest and venue saw different service names for the same booking. Fixed and verified, see 12.6. |
| **G2b** | Visit grouping | **Fail** | **High** | A cancelled service makes the whole visit render as Cancelled, hiding a live booking and removing its actions. |
| **F18** | Record cash | **FIXED** | Medium | Deposit actions were offered on bookings with no deposit, marking a £0.00 deposit "Paid". Severity corrected down from High, see 12.2. |
| A18 | Deposit greater than price | **Fail** | High | A £100 deposit saves against a £60 service. No validation anywhere. |
| D30 | Marketing consent | **Fail** | High | The opt-in checkbox is pre-ticked, so guests are opted in by default. |
| D6/D7 | Variant prices | **Fail** | High | The guest chooses between variants with no price shown at all. |
| A19 | Invalid price | **Fail** | Medium | A bad price is silently discarded, and a typo like `2S` saves as £2.00. |
| D13a | Full payment copy | **Fail** | Medium | A full payment is described to the guest as "this deposit". |
| D13b | Duration with add-ons | **Fail** | Medium | Guest is shown "30 min" while picking a slot for a 55-minute booking. |
| **F14a** | No-show before grace period | **Fail** | Medium | The action fails silently. The dialog closes as if it worked. |
| D10a | Validation copy | **Fail** | Low | The internal add-on group name leaks into guest-facing text. |
| B8a | "Used by" links | **Fail** | Low | Add-on library links to a service land at the top of an unfiltered list. |
| B2a | Add-on summary | **Fail** | Low | A time-only add-on advertises "+£0.00". Zero price and zero duration are treated inconsistently. |
| **F14b** | Error copy | **Fail** | Low | An em-dash in a user-facing error, against the project's own rule. |
| **F9a** | Modify diff | **Fail** | Low | The struck-through "before" time shows a time the booking never had. |
| **F6a** | Visit end time | **Fail** | Low | A removed service still stretches the visit's displayed end time. |
| **F6b** | Pluralisation | **Fail** | Low | "1 services in this visit". |
| A1 to A13, A21 | Service setup | **Pass** | | All four payment requirements, variants, variant deposits, buffers, processing time, free services. |
| B1 to B9 | Add-ons | **Pass** | | Groups, reuse across services, two groups on one service, min and max rules. |
| C1, C6, C9, C11 | Scheduling | **Pass** | | Hours, minimum notice, practitioner gating, buffer collision. |
| D1, D2, D8, D10, D13, D14, D17, D27 | Booking | **Pass** | | See the money verification below. |
| E1, E3, E5, E11 | Staff booking | **Pass** | | Deposit-waiver default, contact autocomplete, inline duration editing. |
| F1, F3, F6, F9, F11, F12, F15, F24 | Management | **Pass** | | Reschedule, conflict blocking, status machine, cancel, service removal, internal notes. |
| G1, G3, G4, G8 | Customer self-service | **Pass** | | Manage link loads, guest cancel works, contact dedupe, HMAC required. |
| D3, D4, F13, F16, F17, F19, F20 | Payment completion | **Blocked** | | Card entry cannot be driven in this environment. See 12.3. |

### 12.1 The money paths are correct

This was the main thing worth proving, and it holds up. Add-ons extend price and
duration but deliberately leave deposit and buffer alone, which is exactly the kind
of asymmetry that usually hides an arithmetic bug. It did not.

| Scenario | Expected | Actual | Server record |
| --- | --- | --- | --- |
| Deposit service, £60 service with £20 deposit | charge £20 | "Deposit due £20.00" | `deposit_amount_pence: 2000` |
| Full payment £40 **plus** £23 of add-ons | charge £63, not £40 | "Total due now £63.00" | `deposit_amount_pence: 6300`, `addons_total_price_pence: 2300` |
| Variant with a blank deposit | inherit the £10 service default | "Deposit due £10.00" | |
| Variant with its own £30 deposit | override to £30 | "Deposit due £30.00" | |
| Two services, only one needing a deposit | combined £105, one £30 deposit | exactly that | |
| Remove a service from the visit | recalculate and drop the deposit line | exactly that | |

Availability arithmetic is equally sound. With add-ons worth 25 extra minutes on a
30-minute service, the last offered slot was 21:00 against a 22:00 close, which is
only correct for a 55-minute booking. The buffer test resolved to the minute:

```
19:00 to 19:30   TEST A1 Simple Service
19:30 to 20:00   TEST A3 Buffered Service
20:00 to 20:15   A3's 15-minute buffer
20:15            first slot offered again
```

If the buffer were being ignored, 20:00 would have been offered. It was not.

### 12.1a Where the defects clustered: creation is right, modification was not

The booking **creation** path computes money correctly in every combination tested,
and so does the availability engine. The defects were concentrated in the paths that
write to a booking *after* it exists.

| Path | Verdict |
| --- | --- |
| Creating a booking (add-ons, variants, multi-service, mixed deposits) | Correct throughout |
| Availability and conflict detection, including processing gaps | Correct throughout |
| Removing a service from a visit | Correct, price recalculates |
| Recording cash against a real deposit | Correct, balance updates |
| Swapping a service in a visit | Keeps the quoted price **by design** (F5) |
| **Changing a variant** | Name and duration kept the old values (F7). **Fixed** |
| **Guest changing a service** | Name kept the old value (G2a). **Fixed** |
| **Deposit actions with no deposit** | Offered, and wrote a false Paid (F18). **Fixed** |

Reads and creates were sound; updates were not. Every appointment was created
correctly and could then be corrupted by editing it.

All three write-path defects came from the same shape of mistake: a rule that existed
somewhere in the code but was not applied to every path that needed it.

- F7 and G2a: the display-name snapshot columns are written by a BEFORE INSERT
  trigger, and the venue PATCH route re-snapshotted them only when the *service* id
  changed. A variant-only change fell through that guard, and the guest endpoint
  never re-snapshotted at all.
- F18: `send_payment_link` already refused bookings with no deposit to settle.
  `waive` and `record_cash` never carried the same check.

Each fix put the existing rule where it was missing rather than inventing a new one,
and the shared helpers added along the way (`hasSettleableDeposit`) exist so the
paths cannot drift apart again.

### 12.2 Detailed findings

#### G2 WITHDRAWN. Not a bug: this is processing time working correctly

An earlier version of this report carried this as Critical. **It was wrong.** The
availability engine is correct and no fix is needed. Recording it in full, because
the reasoning error is instructive and someone will otherwise re-report it.

**What was observed.** A 90 minute Root Tint was offered at 20:00 on a calendar that
already held a 20:30 to 21:00 booking, and booking it produced two apparently
overlapping confirmed appointments. Probing several services seemed to show a clean
rule: 45 and 60 minute services correctly refused an overlapping start, while 90 and
150 minute ones were offered slots that swallowed the existing booking whole. That
looked like the classic missing containment case in an interval-overlap test.

**What was actually happening.** The services split by duration purely by accident.
The real distinction was processing time:

| Service | Duration | Processing block | Verdict |
| --- | --- | --- | --- |
| Olaplex | 45 min | none | correctly refused |
| Cut & Blow Dry | 60 min | none | correctly refused |
| Root Tint | 90 min | 30 min gap from minute 30 | correctly **offered** |
| Full Head Foils | 150 min | 60 min gap from minute 45 | correctly **offered** |

Root Tint booked at 20:00 makes the practitioner busy 20:00 to 20:30, **free 20:30
to 21:00 while the colour develops**, then busy 21:00 to 21:30. The existing booking
sits exactly inside that free gap. The stylist is not double booked; they apply the
colour, take another client while it develops, and come back. That is the entire
purpose of the processing-time feature.

The one detail that should have stopped me was already in my own notes: Full Head
Foils was offered at 19:15 and 19:30 but **not** at 19:00, which a simple "enclosure
is never checked" bug cannot explain. Starting at 19:00 puts its busy tail at 20:45
to 21:30, which genuinely collides. I noticed the anomaly, could not explain it, and
wrote the finding up anyway. That was the mistake.

**How it was settled.** Six tests were written against `computeAppointmentAvailability`
reproducing the exact scenario. All passed immediately, proving the engine already
refuses a true enclosure. Two more were added for the processing-gap case. The full
availability suite is green at 402 tests.

The tests were kept, at
`src/lib/availability/appointment-engine.overlap-rules.test.ts`, because the
distinction is genuinely subtle and worth pinning down:

- a candidate with **no** gap that would enclose an existing booking is refused
- a candidate **with** a gap may host another booking inside that gap
- but its **busy** segments still refuse a collision

That middle rule is load-bearing. A future "fix" that treated a processing-gap
overlap as a conflict would silently destroy salon capacity, which is exactly the
change this false finding would have prompted.

**Lesson for the rest of this report.** Every other finding in it was verified
against stored server state rather than inference. This one was reasoned from a
behavioural pattern across services whose configuration I had not checked. Where a
finding rests on inference rather than a verified value, it now says so.

#### F5 By design, not a bug: a service swap in a visit keeps the quoted price

Reported as High. On investigation it is **intentional and documented**, so it has
been reclassified. What remains is a presentation problem, not a money bug.

**What was observed.** A visit held TEST A1 (£25) and TEST A3 (£30), total £55. The
second service was swapped to **Beard Trim**, which is £15 in the catalogue. The name
and duration updated correctly, but the line kept £30 and the visit total stayed £55:

```
TEST A1 Simple Service     £25.00
Beard Trim                 £30.00      <- Beard Trim is £15.00
Visit total (2 services)   £55.00
```

**Why it happens.** A multi-service visit is edited through
`/api/venue/visits/[groupBookingId]/services`, not the single-booking route. Its
swap branch (lines 703-726) deliberately pins the old price:

> The visit keeps the price it was quoted. An appointment's price is resolved live
> from the catalogue, so without pinning it here a swap would silently re-price the
> booking, which is not what changing a service is for.

An appointment's price is normally resolved live from the catalogue, so the swap
back-fills the previously resolved total into `booking_total_price_pence`, which
stops the live resolution moving it. The code does exactly what it says.

**What is still wrong.** Nothing in the interface says the price is being held. A
line reading "Beard Trim £30.00" is indistinguishable from a bug, and a staff member
has no way to tell a deliberately-held price from a wrong one. The visit total
inherits the same ambiguity.

**This is a product decision, not a defect to fix quietly.** Two reasonable options:

1. Keep the policy, show it. Mark a held line, for example "Beard Trim, held at
   £30.00", so the pin is visible and intentional-looking.
2. Re-price on swap, and protect the quote some other way (confirm before
   re-pricing, or keep the pin only when a deposit has already been taken).

Option 1 preserves the existing intent and is the smaller change. Option 2 reverses a
deliberate decision and should not be made without the product view. Left unchanged
pending that call.

#### F7 (High) FIXED. Changing a variant updated the price but not the name or the duration

A booking of TEST A8, variant **Basic** (30 min, £40), was changed to **Premium**
(60 min, £80) through the Modify dialog's dedicated Variant dropdown. Before saving,
the Duration field still read 30 and "Ends at 21:00", so changing the variant does
not drive the duration control. After saving:

```
booking_total_price_pence      : 8000      <- Premium's price, updated
service_variant_name_snapshot  : "Basic"   <- not updated
estimated_end_time             : 21:00     <- still 30 min, not updated
```

The booking detail renders this, verbatim, as **"Basic · 30 min · £80.00"**. Basic
is a £40 option; Premium is £80 and needs an hour.

Two harms. The guest sees "Basic" and is billed £80, a £40 overcharge with nothing
on screen to explain it. And only 30 minutes are reserved for a 60-minute treatment,
so availability believes 21:00 is free while the practitioner is still working.

**This is the mirror image of F5**, which is what makes the pair diagnostic:

```
staff, change SERVICE : name + duration update, price does NOT     (F5)
staff, change VARIANT : price updates, name + duration do NOT      (F7)
guest, change SERVICE : price + duration update, name does NOT     (G2a)
```

**Shared root cause**, `src/app/api/venue/bookings/[id]/route.ts:2604-2619`:

```js
if (nextServiceId && nextServiceId !== previousServiceId) {
    ... bookingUpdate.service_name_snapshot = nextName;
    ... bookingUpdate.service_variant_name_snapshot = null;
}
```

The entire re-snapshot block is gated on the *service id* having changed. Change only
the variant and the guard is false, so the variant name is never refreshed. Duration
comes from `resolveAppointmentModifyEndCoreHHmm(... defaultDurationMinutes:
appointmentSvcDurationMinutes)`, the service's default, so the variant's own duration
is never consulted. And nothing in the block re-derives price at all, which is F5.

The comment above that block is telling: it was added because a booking switched from
"Gents Cut" to "Beard Trim" "kept saying Gents Cut ... forever". The fix covered the
service-change case and stopped there.

**Fixed on 20 August 2026.** See 12.6 for the change and how it was verified. F5 is a
separate, deliberate behaviour on a different endpoint (above), and G2a below is the
same symptom through a third endpoint and still needs its own fix.

#### G2a (High) FIXED, and G2b (High) Stale names, and a live booking hidden behind a cancelled label

A guest used their manage link to change a booking from TEST A1 Simple Service to
Root Tint. Afterwards the venue dashboard showed
`service_name_snapshot: "TEST A1 Simple Service"` for what is now a 90-minute Root
Tint, while price (`6500`) and end time (`21:30`) had both updated correctly. The
**guest's own manage page correctly showed "Root Tint"**, so the guest and the venue
see different service names for the same appointment.

**Cause, verified separately from F5/F7.** The guest flow does not use the venue
PATCH route. It posts to `/api/confirm`, and that file contained no write to
`service_name_snapshot` anywhere. The column is populated by a BEFORE INSERT trigger
and was then never revisited, so a guest-side service change updated the ids, the
price and the end time while the display name stayed frozen at whatever was first
booked.

**Fixed on 20 August 2026.** See 12.6.

Worse, because that booking belonged to a visit whose other service had been
cancelled earlier, the bookings list collapsed the whole visit into a single row:

```
19:30-21:30 · Beard Trim · Andrew · Cancelled · 2 hr
   Services    : "Beard Trim, TEST A1 Simple Service"
   PRICE       : TEST A1 Simple Service £65.00 / Beard Trim £30.00
   Visit total : £95.00      Outstanding £95.00
   Actions     : only "New" and "Rebook"
```

The live 20:00 to 21:30 booking has no row of its own. Three consequences: staff
scanning the day see a **Cancelled** entry and would not know the appointment exists;
because the visit header is Cancelled the action set collapses, so there is no
Cancel, Modify, Start or No-Show and the live booking cannot be managed from the list
at all; and the £95 total sums a cancelled service while carrying both the F5 and
G2a wrong values.

The grouping should either exclude cancelled rows from the visit, or take the visit's
status from its active members.

#### F18 (Medium) FIXED. Deposit actions were offered on bookings with no deposit

**Severity corrected down from High, and the mechanism I originally described was
wrong.** Recording it properly, because the corrected version is a different bug
from the one first reported.

**What I originally claimed.** That "Record cash" never records the money, so
revenue undercounts every cash settlement. That is not what happens.

**What actually happens.** On a booking that genuinely has a deposit, `record_cash`
works correctly. Verified on TEST A4 (£60 service, £20 deposit):

```
before   deposit_status Pending    deposit_amount_pence 2000
after    deposit_status Paid       deposit_amount_pence 2000
         amount_paid_pence 2000    payment_state deposit_paid
         balance_due_pence 4000    (£60 total less the £20 deposit)
```

The money is recorded and the balance updates. Nothing is lost.

**The real defect.** The three deposit actions were rendered whenever
`deposit_status` was neither 'Paid' nor 'Refunded'. That includes **'Not Required'**,
the status every booking gets when its service asks for no deposit at all. On such a
booking `record_cash` wrote `deposit_status: 'Paid'` with `deposit_amount_pence: 0`,
so the row rendered "£0.00 - Paid" beside its real outstanding balance, and then
offered to "Refund deposit" for £0.

Reproduced on an ordinary seeded booking, not just test data: the 14:15 Olaplex
Treatment (£35, no deposit) offered Send payment link, Waive and Record cash.

**Why it still mattered.** Staff who have just taken £35 in cash see a button called
"Record cash", press it, and the screen says Paid. They would reasonably believe the
money is recorded. It is not, and the web dashboard has no way to record it, which is
a separate gap noted below.

**The giveaway.** `send_payment_link` in the same route already carried the correct
guard and refused these bookings with "This booking has no deposit to collect".
`waive` and `record_cash` never had it. The rule existed; two of the three actions
simply did not use it.

**Fix.** See 12.6.

**Separate product gap, not fixed here.** There is no way to record an in-person
balance payment from the web dashboard. That capability (`POST /charge` with
`method: 'cash'`, which writes a real ledger row) exists but is mobile-app only and
gated behind `venues.in_person_payments_enabled`, default false, per
`Docs/TAP_TO_PAY_DESIGN_AND_IMPLEMENTATION.md`. The absence of that surface on web is
exactly why staff reach for the deposit button instead. Worth deciding whether the
web dashboard should get the same Take payment surface.

#### A18 (High) Deposit may exceed the service price

Create a service priced at £60, choose "Custom deposit", enter £100, save. It saves
without complaint. The catalogue then returns `price_pence: 6000` and
`deposit_pence: 10000`. The guest is asked to pay £100 up front for a £60 service,
leaving a balance of minus £40.

The cause is in `src/app/api/venue/appointment-services/route.ts`. The `deposit`
branch of the validator (lines 132 to 141 on create, 213 to 222 on update) only
asserts `d > 0`. It never compares against `price_pence`. The neighbouring branches
show the pattern exists: `full_payment` validates that a price is set, and
`card_hold` enforces a minimum fee. Deposit simply has no upper bound. There is no
client-side guard either, so the dialog closes as if the save were clean.

#### D30 (High) Marketing consent is pre-ticked

On the public booking form the checkbox "Sign me up to receive offers and news from
this business by email" is already ticked when the details step first renders. This
was confirmed by reading the checkbox state on arrival, before touching the form.

`src/components/booking/DetailsStep.tsx:231` sets `marketingConsent: true` in the
form defaults. The line immediately above it, `acceptTerms: false`, shows the
intended pattern, which suggests an oversight rather than a decision. The value flows
through to the contact record, so the venue's marketing list fills with guests who
never actively opted in.

This matters beyond tidiness: UK GDPR Recital 32 states specifically that pre-ticked
boxes do not constitute consent. It is a one-line fix.

#### D6/D7 (High) Variant prices are never shown at the point of choice

The "Choose your option" step lists variants with a name and a duration and nothing
else:

```
Basic     30 min
Premium   60 min
```

Basic is £40 with a £10 deposit. Premium is £80 with a £30 deposit. The guest picks
between them, and between two different deposits, with only the duration to go on.
The price appears one step later on the practitioner card, and the deposit only on
the review step, after the variant is locked in and a time has been chosen.

`AppointmentBookingFlow.tsx:3689-3692` renders only `variant.name` and
`variant.duration_minutes` in the guest branch. There is no price element and no
condition guarding it, so this happens for every venue, every time.

This is not confined to the test data. The venue's own live services have priced
variants: Haircut is Short £25 and Long £35, Highlights is Short £65 and Long £85.
The card advertises "From £25.00" and the guest then selects "Long" without being
told it costs £35.

#### A19 (Medium) Invalid prices are discarded silently

Entering `-5.00` as a price saves the service with no price at all
(`price_pence: null`) and no error. Worse, and confirmed by test, entering `2S` saves
as **£2.00**: `parseFloat` reads the leading digit and the rest is dropped. The list
then shows £2.00 and the edit dialog reopens showing "2.00", so the operator has no
reason to suspect anything is wrong.

`poundsToPence()` returns `null` for negative or unparseable input, and the payload
builder does `price_pence: poundsToPence(...) ?? undefined`
(`appointment-service-form-to-payload.ts:163`), dropping the key from the request
entirely.

An explicit `0.00` correctly stores `price_pence: 0` and renders publicly as "Free",
so zero and unset are properly distinct states. That is what makes the silent null
harmful: it is a third state the operator never chose. Processing-time blocks in the
same form do validate and block the save with a clear inline message, so the pattern
to copy is already there.

#### D13a (Medium) A full payment is called a deposit

On the payment step for a `full_payment` service the heading correctly reads "Total
due now £63.00", and immediately beneath it:

> Refund cut-off has passed - this deposit is not refundable if you cancel.

£63.00 is the full price, not a deposit. The heading and the warning contradict each
other on the same screen, and the guest paying in full is told about "this deposit".

#### D13b (Medium) The duration shown while picking a slot ignores add-ons

After choosing add-ons worth 25 extra minutes, the practitioner step and the slot
step both still show "30 min". The engine itself is right, and the review step
afterwards correctly says "55 min", but for the two steps where the guest is actually
choosing their time they are told the appointment is half an hour when it is nearly
a full hour.

#### D10a (Low) Internal add-on group name shown to guests

Selecting too many options produces:

> "TEST B6 Pick Up To Two" allows at most 2 options.

The enforcement is correct, but the message uses the internal group name. The add-on
form describes that field as "Internal label. Only used in the dashboard unless
'Prompt to client' is empty", and this group does have a prompt. Venues name groups
things like "Upsell tier 2", so this can surface commercial wording to guests.

#### B8a (Low) "Used by" links do not go anywhere useful

In the add-on library each group lists the services using it as links. Clicking one
lands at the top of the full services list with no scroll, filter or highlight. On
this venue that is a list of more than 20 services, so the link reads as broken.
`AddonsLibraryView.tsx:351` builds a `?service=<id>` link, but
`AppointmentServicesView` only ever reads the `tab` param. The `service` param is
consumed by nothing.

#### B2a (Low) Zero values render inconsistently in the add-on summary

```
Gloss finish (price only)    +£12.00              <- zero duration correctly hidden
Deep condition (time only)   +£0.00 and +20 min   <- zero price shown anyway
```

Duration is suppressed when it is zero, price is not, so a time-only add-on
advertises "+£0.00". The public booking page gets this right, so it is the dashboard
summary that is out of step.

#### F14a (Medium) "Mark No-Show" fails silently before the grace period

Opening a booking whose start time is still in the future, clicking No-Show and
confirming, closes the dialog as though it worked. The booking stays `Booked`.
There is no toast, no inline error and nothing anywhere on the page. This was
checked by scanning the full page text and every `[role="alert"]` and
`[role="status"]` region after the attempt, all empty.

The only trace is in the network tab:

```
PATCH /api/venue/bookings/<id> -> 400
{"error":"Cannot mark as no-show yet — the grace period of 15 minutes
          after the start time has not elapsed"}
```

The rule itself is correct and documented in the help centre. Only the silence is
the defect. Either surface the message, or disable the button until the grace
period has passed, since the server already knows the venue's setting.

#### F14b (Low) Em-dash in a user-facing error

The message above is defined at `src/lib/table-management/lifecycle.ts:242` and
contains `—`, an em-dash. CLAUDE.md states: "Never use em-dashes in any
user-facing copy... This applies to every string a user or guest can read: ... and
error messages." Worth grepping the codebase for `—` while fixing, since this
one surfaced by accident rather than by looking for it.

#### F9a (Low) The "before" time in the modify diff is fabricated

Changing both the time and the duration of a booking produces a before/after diff
whose "before" side is not the saved value. A 15:15 to 15:45 booking, changed to
15:30 and 45 minutes, showed:

```
~~Thu 20 Aug - 15:15 – 16:00~~   ->   Thu 20 Aug - 15:30 – 16:15
```

15:15 to 16:00 is a time the booking never had. It applies the new duration to the
old start. The "from" side of a comparison should show what is actually saved.

### 12.2a What works well

Worth recording, because a defect list on its own gives a skewed picture.

- **The 60-second notify grace.** Rescheduling saves immediately but holds the
  customer notification for a minute, offering Notify now, Skip notify and Undo
  change. That directly prevents "I moved the wrong booking and they have already
  been texted."
- **Conflict handling.** Reschedules and duration changes that would clash are
  blocked with "Conflicts with another booking" and a disabled Save. Changing the
  duration re-filters the available slot list live.
- **The status machine.** No-Show disappears once a booking is Started; Completed
  collapses to Reopen, New and Rebook. Arrived is a marker with its own timestamp
  rather than a status, which is the right modelling.
- **Multi-service visits.** "Modify visit" exposes each service as its own dropdown
  with a Remove button plus an Add a service control, and re-lays the visit
  correctly when its contents change. Only the price fails to follow.
- **Staff defaults.** On the staff booking form, name and email are optional and
  phone is required, and "Require deposit" is unchecked by default so the booking
  confirms now and the money is taken in person.
- **The card-hold cash guard**, described under F18.

### 12.3 What could not be tested

Card entry could not be completed. The in-app preview browser cannot dispatch events
into Stripe's cross-origin iframes on `js.stripe.com`, and no Chrome instance was
connected to use as an alternative driver. This is an environment limit, not a
product defect.

Every payment **amount** was verified instead, from both the payment step totals and
the created booking record, which is where arithmetic bugs would live and where all
the money checks in 12.1 come from. What remains untested is Stripe's own
confirmation callback and the state transitions after a successful charge: D3 and D4
completion, and the whole of F13 and F15 to F20 (no-show charges, refunds, taking
balances).

Worth noting that the unpaid deposit booking behaved correctly while pending: it was
held as `Pending` and it continued to hold its slot against other bookings.

To finish these, run the pass in a browser where Stripe's iframe can be driven.

### 12.4 Not yet run

Parts C2 to C5, C7, C8, C10 and C12. D3 to D5, D9, D11, D12, D15, D16 and D18 to
D29. E2, E4, E6 to E10. F2, F4, F8, F10, F13, F16, F17, F19 to F23, F25.
G5 to G7, and all of H and I. From section 3, A14 to A17, A20 and A22.

With G2 withdrawn there is no blocking defect, so the remaining tests can be run in
any order. The highest-value untested areas are:

- **F8**, adding or removing an add-on after booking. This is the one member of the
  F5/F7/G2a snapshot family not yet probed, and the most likely place for a fourth
  variation of the same mistake.
- **E6 to E10**: walk-ins, back-dating, and the staff double-book warning.
- **Part I**: mobile layout, console errors, accessibility. Untouched so far.

### 12.5 A note on one thing that was checked and dismissed

Two early attempts to type an internal note landed in the tag field instead, which
looked like a focus bug with a real privacy consequence: a private note becoming a
customer-visible tag. On investigation it was a sequencing mistake in the test, not
a product defect. The customer-info editor was still open; once cancelled, clicking
the staff-notes field focused its textarea correctly and F24 passed. Recorded here
so it is not raised again.

---

### 12.6 Fixes made

#### F7: a variant change now carries its name and duration with it

Two halves, one in the API and one in the form.

**Server**, `src/app/api/venue/bookings/[id]/route.ts`. The block that writes
`service_variant_id` now re-snapshots `service_variant_name_snapshot` alongside it
whenever the variant actually changes, clearing it when the variant is removed. The
new variant is resolved through `loadActiveVariantForService`, which already checks
that it is active and belongs to both this service and this venue, and the route
returns the same 400 the reschedule path already returns if it does not. Previously a
variant-only edit reached the write with no validation at all.

The existing re-snapshot block above it stays as it is. It is gated on the *service*
id changing, which is correct for what it does; the variant case simply needed its
own handling rather than being folded into that guard.

**Client**, `src/components/booking/StaffAppointmentModifyForm.tsx`. The effect that
adopts a catalogue duration used to run only when the booking carried no end time
(`if (durationMinutes != null) return`), so switching variant left the field on the
old option's length and the form posted that stale value. It now also follows a real
service or variant change, tracked by a `durationSourceRef` holding the service and
variant the current duration was derived for.

Two things it deliberately does not do:

- It does not adopt on open. The ref is seeded with the booking's own service and
  variant, so a booking whose length differs from its catalogue entry (booked long,
  or trimmed by staff earlier) keeps that length. An existing test covers this and
  caught an earlier version of this fix that got it wrong.
- It does not overwrite a duration staff typed. That is tracked by an explicit
  `durationEditedByStaffRef` set from the duration input and the quick-duration
  buttons. Inferring it from `durationMinutes !== baselineDuration` was tried first
  and rejected: it forced `baselineDuration` to move, which hid the duration change
  from the form's dirty check and left Save disabled on a form that genuinely
  differed from the stored row.

**Verification.**

- Four new tests in `StaffAppointmentModifyForm.variant-duration.test.tsx`. Two of
  them fail on the unfixed code, confirmed by stashing the change and re-running:
  "adopts the new variant's duration when the variant is switched" and "switching
  back returns the duration to the original option".
- End to end on the dev server against the booking that produced the original
  finding. Switching Basic to Premium and saving now gives:

| Field | Before the fix | After |
| --- | --- | --- |
| `service_variant_name_snapshot` | "Basic" | **"Premium"** |
| `service_variant_price_pence` | 8000 | 8000 |
| `estimated_end_time` (from 20:30) | 21:00, 30 min | **21:30, 60 min** |

  The booking detail read "Basic, 30 min, £80.00" before and reads
  "Premium, 1 hr, £80.00" now.
- Conflict detection still holds. With another booking in the way, extending to
  21:30 was refused with "Conflicts with another booking" and Save stayed disabled,
  which is how the overlap was noticed and cleared before the final check.
- Full typecheck clean, lint clean on every changed file, 1537 tests green across
  `src/components/booking`, `src/lib/availability` and `src/lib/booking`, plus 76
  across the booking API routes.

#### G2a: a guest service change now carries the service name with it

`src/app/api/confirm/route.ts`. The guest self-reschedule update wrote the service
and variant ids but neither snapshot column, so the venue's calendar, day sheet,
bookings list and visit history all kept showing the service originally booked while
the guest's own manage page, which resolves the service live, showed the new one.

The update now also writes `service_name_snapshot`, and clears
`service_variant_name_snapshot`, when the reschedule lands on a different service.
It reuses the `serviceChanged` flag the route already computes a few lines above,
and clearing the variant name matches what the route already does with the variant
id itself: an option belonging to the old service cannot describe the new one.

Two deliberate choices:

- **Only on a service change.** When the service is unchanged the variant is carried
  as-is, so its existing snapshot is still the correct name and rewriting it would be
  pointless work.
- **Resolved before the slot re-check**, not next to the write. The route carries an
  SA-C1 comment about narrowing the window between that re-check and the write;
  putting an extra read inside it would have widened the very gap that comment
  exists to close.

**Verification.** Two guest self-reschedules through the real manage link on the dev
server, each changing the service:

| | Before | After |
| --- | --- | --- |
| Booked as | TEST A8 Variant Deposit Service, Premium | |
| Changed to Beard Trim | name stayed "TEST A8...", variant stayed "Premium" | **"Beard Trim"**, variant **null** |
| Then changed to Olaplex Treatment | | **"Olaplex Treatment"**, variant null, 45 min, £35 |

The venue dashboard and the guest manage page now report the same service for the
same booking, which was the substance of the finding. Typecheck and lint clean;
1736 tests green across `src/app/api`, `src/lib/booking`, `src/lib/availability` and
`src/components/booking`.

**Coverage gap, stated plainly.** There is no automated test for this. The confirm
route has no test file at all, and its dependencies (a chainable Supabase mock across
several tables, the availability engine, the slot re-check, compliance, cancellation
policy and comms) would need a large and brittle harness to stand one up. The change
is verified end to end against the real database through the real guest UI, twice,
which for this particular change is stronger evidence than a heavily mocked unit test
would be. It is not a substitute for the route having tests, and that absence is
worth its own piece of work.

#### F18: deposit actions now require a deposit to act on

Three parts, all following a rule the codebase already had.

**Shared helper**, `src/lib/booking/deposit-action-eligibility.ts`. A booking has a
settleable deposit only while `deposit_status` is `'Pending'` or `'Failed'`.
`send_payment_link` already enforced exactly that inline; the helper lifts it out so
the route and both booking-detail surfaces read the same rule and cannot drift apart
again, which is how the three actions diverged in the first place.

**Server**, `src/app/api/venue/bookings/[id]/deposit/route.ts`. `record_cash` and
`waive` now refuse with 409 `invalid_state` when there is no deposit to settle, with
messages matching the existing one. `send_payment_link` was refactored onto the same
helper with no behaviour change.

**UI**, `ExpandedBookingContent.tsx` and `BookingDetailContent.tsx`. Both rendered
the three buttons whenever the status was not 'Paid' and not 'Refunded'. Both now
gate on the same helper, so a button is never offered for an action the server will
refuse.

**Verification.**

- Four new tests in `route.card-hold.test.ts`. Three fail on the unfixed code,
  confirmed by stashing the route change and re-running: `record_cash` and `waive`
  returning 409 for 'Not Required', and `record_cash` returning 409 for 'Paid'. The
  fourth pins the path that must keep working, `record_cash` from 'Failed', which is
  the recovery route after a declined card.
- Live, on the no-deposit Olaplex booking: all three actions now return 409 and the
  booking is **unchanged** (`Not Required`, `deposit_amount_pence: null`, balance
  £35.00 intact). Before the fix `record_cash` wrote Paid/£0.
- Live, on TEST A4 which genuinely has a £20 deposit: the buttons still render and
  `record_cash` still works, moving it to Paid/£2000 with `amount_paid_pence: 2000`,
  `payment_state: 'deposit_paid'` and `balance_due_pence: 4000`. **This was the
  regression that mattered:** the fix removes a harmful action without removing a
  legitimate one.
- 1425 tests green across `src/app/api`, `src/lib/booking`, `src/components/booking`
  and `src/app/dashboard`. Typecheck clean, lint clean (the three warnings in
  `ExpandedBookingContent` are pre-existing, at lines this change does not touch).

**Residue.** The 15:30 TEST A1 booking still carries `deposit_status: 'Paid'` with
`deposit_amount_pence: 0` from the original investigation. It is a completed test
booking and there is no API action to reset it, so it stays until the test data is
cleared.

#### F5: not changed, by design

See the F5 entry in 12.2. The behaviour is deliberate and documented in the code, so
reversing it is a product decision rather than a fix. The presentation problem it
leaves is real and worth addressing; two options are set out there.

---

### 12.7 Every file changed, and why

For review before this goes to staging. Three defects fixed; no other behaviour
touched.

| File | Change |
| --- | --- |
| `src/lib/booking/deposit-action-eligibility.ts` | **New.** `hasSettleableDeposit`, the shared rule for when a deposit action is valid. |
| `src/app/api/venue/bookings/[id]/deposit/route.ts` | F18. `waive` and `record_cash` now refuse with 409 when there is no deposit to settle. `send_payment_link` refactored onto the shared helper, no behaviour change. |
| `src/app/dashboard/bookings/ExpandedBookingContent.tsx` | F18. Deposit buttons gated on the same helper. |
| `src/components/booking/BookingDetailContent.tsx` | F18. Same gate on the second detail surface. |
| `src/app/api/venue/bookings/[id]/route.ts` | F7. Re-snapshots `service_variant_name_snapshot` on a variant change, and validates the incoming variant as the reschedule path already did. |
| `src/components/booking/StaffAppointmentModifyForm.tsx` | F7. Duration now follows a service or variant change, guarded by two refs so it never overrides a booking's own length or a figure staff typed. |
| `src/app/api/confirm/route.ts` | G2a. Guest self-reschedule now re-snapshots the service name, and clears the variant name, when it lands on a different service. |

**Tests added**

| File | Covers |
| --- | --- |
| `src/lib/availability/appointment-engine.overlap-rules.test.ts` | **New, 8 tests.** Pins both directions of the overlap rule that the withdrawn G2 finding got wrong, including that a processing gap may legitimately host another booking. |
| `src/components/booking/StaffAppointmentModifyForm.variant-duration.test.tsx` | **New, 4 tests.** Duration follows a variant switch; a staff-typed duration survives one; a booking's own length is not overridden on open. |
| `src/app/api/venue/bookings/[id]/deposit/route.card-hold.test.ts` | **+4 tests.** The new 409 guards, plus the `Failed` recovery path that must keep working. |

Every new test that asserts a fix was confirmed to **fail without it**, by stashing
the change and re-running. Full repository state at the end of this work: **3,648
tests passing across 378 files**, typecheck clean, lint clean, production build clean.

### 12.8 Does resneo-app need updating?

The mobile app is an API consumer over Bearer auth, not a database client, so only
contract changes can affect it. Three were made. **I could not inspect the app's
source from this repository**, so the following is derived from the API contracts and
`Docs/MOBILE_API.md`, and the first item should be checked against the app before it
is treated as settled.

**1. It very likely carries the same F7 duration bug. This is the one to act on.**

The F7 duration fix was made in the **web** form, not the server. The server still
prefers a client-supplied `duration_minutes` over the variant's own
(`resolveAppointmentModifyEndCoreHHmm`, precedence: body duration, then body end
time, then the resolved variant duration). So any client that lets staff change a
variant and posts the previous duration reproduces the bug exactly: the booking saves
as the new variant, prices as the new variant, and keeps the old length.

`PATCH /api/venue/bookings/[id]` is a P0 migrated route, so the app uses it. If its
booking-edit screen exposes variant selection, it needs one of:

- send the newly chosen variant's `duration_minutes`, or
- **omit `duration_minutes` entirely** when the variant changes, which makes the
  server fall through to the variant's own duration. This is the smaller change.

**2. A new 400 on `PATCH /api/venue/bookings/[id]`.** Changing to a variant that is
inactive, belongs to another service, or belongs to another venue is now rejected
with `Invalid or inactive variant for this service`, the same message and status the
reschedule path in that route already returned. Sending the variant a booking already
has is unaffected: the guard only runs when the id actually changes. An app sending a
valid variant from the catalogue will not encounter this.

**3. New 409s on `POST /api/venue/bookings/[id]/deposit`.** `waive` and `record_cash`
now refuse with `code: 'invalid_state'` when the booking has no deposit to settle,
matching what `send_payment_link` already did. If the app offers these actions it
should hide them for bookings whose `deposit_status` is not `Pending` or `Failed`,
and surface the message otherwise. Per
`Docs/TAP_TO_PAY_DESIGN_AND_IMPLEMENTATION.md` the app's own "Record cash/other"
goes to `POST /charge`, not to this route, so this may not affect it at all.

**Not a concern:** `/api/confirm` is the guest manage endpoint and is not a venue
route the app authenticates against.

---

## 13. Severity definitions

| Severity | Meaning |
| --- | --- |
| **Critical** | Money is wrong, a booking is lost or double booked, or customer data leaks |
| **High** | A documented flow cannot be completed, or the customer is told something untrue |
| **Medium** | The flow completes but the result is wrong, confusing, or needs a workaround |
| **Low** | Cosmetic, copy, or minor inconsistency with no functional impact |

---

## 14. Test data currently on the dev server

Left in place deliberately so the outstanding tests can continue from here. Nothing
has been cleaned up yet.

**Services** (all prefixed `TEST`, all offered by both Andrew and David):

| Service | Duration | Price | Payment | Notes |
| --- | --- | --- | --- | --- |
| TEST A1 Simple Service | 30 min | £25 | none | |
| TEST A3 Buffered Service | 30 min | £30 | none | 15 min buffer |
| TEST A4 Deposit Service | 60 min | £60 | deposit £20 | |
| TEST A5 Full Payment Service | 30 min | £40 | full payment | linked to B6 |
| TEST A6 Card Hold Service | 30 min | £50 | card hold, £25 no-show fee | |
| TEST A7 Variant Service | 30 min | £30 | none | Short 30/£30, Long 60/£55, linked to B5 and B6 |
| TEST A8 Variant Deposit Service | 30 min | £40 | deposit £10 default | Basic 30/£40 inherits, Premium 60/£80 deposit £30 |
| TEST A9 Processing Service | 90 min | £85 | none | processing gap 30 to 75 min |
| TEST A10 Free Consultation | 30 min | £0 | none | renders as "Free" |
| TEST A13 Override Service | 45 min | £50 | deposit £15 | per-calendar duration, price and deposit overrides enabled |

**Add-on groups:** `TEST B5 Required Pick One` (pick exactly one: Gloss finish
+£12.00, Deep condition +20 min) and `TEST B6 Pick Up To Two` (max 2: Scalp massage
+£8.00 and +10 min, Hot towel +£5.00, Beard oil treatment +£15.00 and +15 min).

**Bookings created**, all as Andrew Courtney, 20 August:

| Time | Booking | Staff | Status |
| --- | --- | --- | --- |
| 15:30 | TEST A1 Simple Service | Andrew | Completed. Was 15:15, rescheduled in F1. Cash "recorded" in F18, so it carries the contradictory paid/outstanding state. |
| 16:00 | TEST A4 Deposit Service | Andrew | Pending, £20 deposit unpaid |
| 16:30 | TEST A13 Override Service | David | Cancelled in F15. Created staff-side with the deposit waived. |
| 17:00 | TEST A5 Full Payment + 2 add-ons | Andrew | Pending, £63 unpaid |
| 20:00 to 21:30 | Root Tint | Andrew | Booked. Overlaps the 20:30 appointment, but **legitimately**: that booking sits inside Root Tint's processing gap. See the G2 entry in 12.2. |
| 20:30 to 21:00 | TEST A8 Variant Deposit | Andrew | Booked. **Carries the F7 bug**: reads "Basic, 30 min, £80.00". |

The two Pending bookings are holding their slots, which is correct behaviour and
also why Andrew's availability has gaps this evening.

**One booking is deliberately left in a broken state as evidence.** The 20:30 TEST A8
shows the F7 chimera, "Basic, 30 min, £80.00", and is worth keeping until that is
fixed.

The 20:00 Root Tint overlapping it is **not** a defect, as the G2 entry in 12.2
explains, and can
be left or cleared freely. A cancelled Beard Trim row also remains from the F6
removal test, and the earlier 19:00 visit carries an internal staff note from F24.

No venue settings were changed, so nothing in section 5 needs restoring. The
baseline was recorded before the pass in case it becomes necessary:
`any_available_practitioner` and `staff_first_booking_flow` are both off,
`guest_self_reschedule` and `waitlist_v2` are on, hours are 09:00 to 22:00 with
Tuesday split into three periods.

---

## 15. Cleanup

At the end of the pass:

1. List every artefact created, by `TEST` prefix.
2. Cancel or delete the test bookings.
3. Deactivate or delete the test services, variants and add-on groups.
4. Restore the venue settings changed during part C to the starting values recorded
   there before they were changed.

Nothing is deleted until the findings that depend on it are written up.
