**PRODUCT REQUIREMENTS DOCUMENT**

**Reserve NI**

*The booking and guest management platform for Northern Ireland
appointment, class, event and hospitality businesses*

  ------------------ ----------------------------------------------------
  **Version**        2.1

  **Date**           Updated May 2026 (originally February 2026)

  **Status**         Living product reference

  **Focus**          Pilot --- founding venues across appointments,
                     classes, events, resources and restaurants

  **Authors**        Founding Team
  ------------------ ----------------------------------------------------

**CONFIDENTIAL**

# 0. Document status (May 2026)

This PRD was originally written (v2.0, February 2026) as the **MVP build
specification for a restaurant-only product**. Reserve NI has since grown
into a **multi-model booking platform**, and the product strategy now
leads with **appointment-style businesses** (hair salons, barbers,
beauticians, massage therapists, dog groomers and similar), with classes,
ticketed events, bookable resources and restaurants supported on the same
core.

Read this document with that in mind:

- **Sections 1–2 (thesis, restaurant persona)** record the *founding*
  restaurant thesis. It remains broadly valid for the restaurant SKU but
  is **no longer the whole product**. A second primary persona — the
  independent appointment-business owner — now carries equal weight; see
  the roadmap docs below for that customer.
- **Section 3 (MVP feature set)** describes restaurant booking flows.
  These shipped. Appointments, classes, events and resources have since
  shipped alongside them as additional booking models. §3.10 (Linked
  Accounts) is current.
- **Sections 6 (pricing) and 11–12 (timeline / beyond MVP)** predate the
  Appointments Light/Plus tiers and the current roadmap. Treat the
  roadmap documents as authoritative where they conflict.

**Authoritative current documents:**

- `Docs/Resneo-Appointments-Review-And-Roadmap.md` — current state,
  competitive position, and the appointments-first development roadmap.
- `Docs/Resneo-Class-Event-Resource-Functionality-Review-And-Plan-May-2026.md`
  — classes, events and resources review.
- `Docs/Resneo_Booking_Models_Reference.md` — canonical definitions of
  the booking models.
- `Docs/Resneo_Unified_Booking_Functionality.md` — multi-model parity
  and delivery status.

A full rewrite of Sections 1–2 and 6–12 to a multi-model framing is
tracked as a separate task; this status section is the interim bridge.

# 1. Executive Summary

Reserve NI is a booking and guest management platform built specifically
for independent restaurants and hospitality venues in Northern Ireland.
It replaces the phone calls, email chains, spreadsheets, and
disconnected tools that most NI venues still rely on, with a single,
simple system that captures bookings from every channel, automates guest
communications, reduces no-shows through smart deposit collection, and
gives venue owners a clear picture of what is happening in their
business.

This document describes the Minimum Viable Product --- the tightest
possible feature set that delivers genuine, immediate value to a
Northern Ireland restaurant, can be built and launched within four
months, and is compelling enough to sign up a cohort of ten to twenty
founding venues. Everything in this document has been chosen because it
is essential to proving the core thesis. Everything that is not in this
document has been deliberately set aside.

  -----------------------------------------------------------------------
  The thesis we are proving: independent Northern Ireland restaurants
  will pay a flat monthly fee for a booking and no-show reduction system
  that is meaningfully better than their current workflow. If that is
  true, everything else follows. If it is not true, no amount of
  additional features will save the business.
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------

## 1.1 The Problem

Walk into almost any independent restaurant in Northern Ireland and ask
how they manage bookings. The answer is usually some version of the same
thing: a phone that rings constantly during busy periods, a reservations
book or a basic spreadsheet, a handful of emails they may or may not
have read, and a Friday night service clouded by the anxiety of not
knowing which of tonight's bookings will actually show up.

No-shows are the defining financial frustration of NI hospitality. A
table of four that does not arrive on a busy Saturday night is not just
lost revenue for that sitting; it is food prepped and wasted, staff paid
to serve nobody, and a table turned away earlier in the week because it
was already booked. Industry data consistently shows that NI and Ireland
have among the highest no-show rates in the UK and Ireland, and the
current tools available to venues do almost nothing about it.

Venues that have tried global booking platforms often find them worse in
different ways: per-cover commissions that become expensive as volume
grows, guest data owned by the platform rather than the venue, generic
tools not designed for how NI hospitality actually operates, and no
meaningful support when something goes wrong during service.

## 1.2 The Solution

Reserve NI gives independent restaurants one place to manage everything:
bookings from their own website, Google Maps, and phone calls all
appearing in the same dashboard; automated reminders and
confirm-or-cancel prompts that dramatically reduce no-shows before they
happen; deposit collection that financially commits guests at the point
of booking; and a clear daily view of every reservation that
front-of-house staff can run service from.

It is priced as a flat monthly fee. No per-cover charges, no percentage
of bookings, no surprises. It is built to be running and adding value
within a single onboarding session. And it is designed and supported by
people who understand the Northern Ireland market, not a global
enterprise sales team for whom Northern Ireland is a footnote.

## 1.3 What This Document Is

This is the MVP specification for Reserve NI. It defines exactly what
will be built for the initial pilot launch, what is explicitly out of
scope, how the product works, how the business makes money, and how we
intend to get the first venues signed up and using the system. It is a
build document and a sales alignment document, not a vision deck or an
investor pitch. Those are separate.

Compared to version 1.0 of this document, this version includes
significantly more build-level specification in areas that directly
affect engineering decisions: the availability and capacity model, the
cancellation policy structure, guest identity matching, the
communication template system, and the deposit payment architecture. It
also includes a competitive landscape section, a per-venue cost model, a
venue exit policy, and a set of future-proofing decisions designed to
prevent the MVP from creating technical debt that blocks later phases.

**2. Target Customer**

The MVP targets one specific customer type: the owner or manager of an
independent restaurant in Northern Ireland that takes reservations, has
a regular no-show problem, and is currently managing bookings through a
combination of phone, email, a paper book, or a basic tool that was
never designed for their needs.

  -----------------------------------------------------------------------
  We are not building for every hospitality format in Phase 1. Bars with
  predominantly walk-in trade, hotels with complex room and dining
  workflows, and multi-site groups all have materially different needs.
  Starting with independent, reservation-taking restaurants gives us a
  clean, consistent workflow to solve well.
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------

## 2.1 Primary Persona: The Independent Restaurant Owner/Manager

Age 30--55. Running a single-site restaurant in Northern Ireland --- a
neighbourhood bistro, a city-centre dining room, a gastropub that takes
table reservations. Takes between 20 and 150 covers per service,
multiple services per week. Has a loyal local customer base and relies
on word of mouth and Google for discovery.

Their current booking workflow involves at least two of: a phone they
answer between services, a Gmail or general inbox for email bookings, a
physical reservations book or a Google Sheet, and possibly a basic tool
like ResDiary that they use inconsistently because it was never properly
set up.

Their single biggest operational frustration is no-shows. They talk
about it with other venue owners. They lose sleep over it on busy
weekends. They have tried calling ahead to reconfirm but it takes staff
time they do not have. They would happily take deposits if the system
made it easy. Most have not taken deposits before simply because there
was no frictionless way to do it.

They are time-poor and tech-cautious. They will not read a manual. They
will not watch a 45-minute onboarding webinar. But they will spend 45
minutes with a founder who understands their problem and shows them
something that clearly solves it. If it works in their first week of
service, they will tell three other restaurant owners about it.

## 2.2 What They Need to See to Sign Up

Before any venue owner will commit to Reserve NI, even at a discounted
founding rate, they need to see four things clearly demonstrated:

-   **It captures bookings from everywhere they already take them.**
    Phone, website, Google Maps. Not a new channel that replaces
    existing ones; a system that consolidates all of them.

-   **It reduces no-shows with something that actually works.** Not just
    reminders --- a financial commitment at booking, and a one-tap
    confirm or cancel prompt. They want to believe this will make a
    measurable difference to Friday nights.

-   **Their staff can run service from it.** The day sheet view needs to
    be something a front-of-house manager can hand to the team at the
    start of a shift and say 'this is tonight'.

-   **It is not more work to maintain than what they are doing now.** If
    entering a phone booking takes longer in Reserve NI than writing it
    in a book, they will stop using the system. Speed matters.

# 3. MVP Feature Set

The MVP contains nine feature areas. Every one of them is load-bearing.
Removing any one of them would materially weaken the product's ability
to solve the core problem. Nothing is included that is not essential to
the pilot thesis.

  -----------------------------------------------------------------------
  Scope discipline: anything not listed in this section is explicitly out
  of scope for the MVP. This includes features that are planned,
  desirable, and will definitely be built later. The list of what is not
  in scope is as important as the list of what is.
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------

## 3.1 Venue Onboarding

A venue must be able to go from signing up to having a live, bookable
presence within a single onboarding session. That session will be
conducted with a founder for every pilot venue --- not a self-serve
wizard. Manual-assisted onboarding is fine and preferable at this stage
because it lets us learn exactly where people get confused, which
informs the self-serve flow we build later.

  ---------------------------------------------------------------------------
  **What We Build**      **Why It Matters**                    **Priority**
  ---------------------- ------------------------------------- --------------
  **Venue profile        Name, address, cuisine type, price    **Must Have**
  setup**                band, opening hours, contact details, 
                         and a cover photo. Takes under 10     
                         minutes with founder assistance.      

  **Availability model   Venue chooses their slot model: fixed **Must Have**
  configuration**        intervals (every 15 or 30 minutes) or 
                         named sittings (e.g. 'Early Bird      
                         5--7pm', 'Main 7--9:30pm'). Sets max  
                         covers per slot or per sitting.       
                         Optionally enables turn-time logic    
                         with a configurable sitting duration. 
                         See section 3.9 for full              
                         specification.                        

  **Booking rules**      Set how far in advance guests can     **Must Have**
                         book, minimum party sizes, any days   
                         or times not available for online     
                         booking.                              

  **Deposit settings**   Choose whether to require a deposit   **Must Have**
                         (recommended), the amount per head,   
                         and which bookings require deposits   
                         (all, groups of 4+, weekends only).   
                         Cancellation policy is binary: full   
                         refund if cancelled 48 hours or more  
                         before the reservation, no refund     
                         after that point.                     

  **Communication        Edit the default wording for          **Must Have**
  template               confirmation, reminder, and thank-you 
  customisation**        messages. Venues add their name,      
                         tone, and any specific instructions.  
                         Pre-filled defaults work on day one.  
                         See section 3.6 for template variable 
                         specification.                        

  **Staff account        Add front-of-house staff logins. Two  **Must Have**
  creation**             permission levels: Admin (full        
                         access) and Staff (view and check-in  
                         only).                                

  **No-show grace period Venue configures how many minutes     **Must Have**
  setting**              after the reservation time a booking  
                         can be marked as a no-show. Default   
                         15 minutes. Configurable from 10 to   
                         60 minutes.                           
  ---------------------------------------------------------------------------

## 3.2 Hosted Booking Page & iFrame Widget

Every venue gets two ways for guests to book digitally without a
consumer app: a hosted booking page (a Reserve NI URL that is theirs)
and an iFrame widget they can embed in their own website. Both show live
availability, collect guest details, capture deposits, and feed every
booking into the same dashboard.

  ---------------------------------------------------------------------------
  **What We Build**      **Why It Matters**                    **Priority**
  ---------------------- ------------------------------------- --------------
  **Hosted booking       A clean, mobile-first booking page at **Must Have**
  page**                 a Reserve NI URL (e.g.                
                         reserveni.com/venues/the-merchant).   
                         Date picker, time slots, party size,  
                         guest details, dietary notes,         
                         occasion flag, deposit payment.       
                         Shareable link for Google Maps,       
                         Instagram bio, and email signatures.  

  **iFrame embed         Single line of code the venue pastes  **Must Have**
  widget**               into their website. Renders the full  
                         booking flow inside their own site.   
                         Uses postMessage API for parent-page  
                         communication. Stripe payment flow    
                         handled via Stripe's own iFrame       
                         (Stripe Elements) to meet PCI and     
                         security requirements. Venue can      
                         customise accent colour via a URL     
                         parameter.                            

  **QR code generation** Auto-generated QR code per venue      **Must Have**
                         linking to their hosted booking page. 
                         Print-ready. For table cards, menus,  
                         and window stickers.                  

  **Real-time            Both the hosted page and the widget   **Must Have**
  availability**         show only genuinely available slots   
                         pulled from the live availability     
                         engine. Update instantly when any     
                         booking is made through any channel.  

  **Mobile optimised**   The majority of bookings will come    **Must Have**
                         from smartphones. Both interfaces     
                         must be fast and fully functional on  
                         mobile browsers.                      

  **Dietary and occasion Guest can flag dietary requirements   **Must Have**
  capture**              and occasion type at booking. Stored  
                         against their record and surfaced to  
                         venue in the day sheet and            
                         communications.                       

  **Guest identity       All bookings require guest name and   **Must Have**
  capture**              either email or phone number. System  
                         matches against existing guest        
                         records using normalised email or     
                         phone. See section 5.3 for matching   
                         logic.                                
  ---------------------------------------------------------------------------

## 3.3 Unified Reservations Dashboard

This is the operational centre of the product. Every booking from every
channel appears here in real time. There are no separate views for
digital bookings versus phone bookings versus walk-ins. One screen,
everything on it.

  ---------------------------------------------------------------------------
  **What We Build**      **Why It Matters**                    **Priority**
  ---------------------- ------------------------------------- --------------
  **Live reservations    All upcoming reservations in          **Must Have**
  list**                 chronological order. Shows: guest     
                         name, time, party size, dietary       
                         flags, deposit status, booking        
                         channel, and confirmation status.     
                         Filterable by date.                   

  **Booking detail       Click any booking to see full         **Must Have**
  view**                 details: guest contact info, all      
                         dietary requirements, special         
                         requests, occasion, deposit status,   
                         and the full communication history    
                         for that booking.                     

  **Booking status       Mark bookings as: Confirmed, Arrived, **Must Have**
  management**           No-Show, Cancelled. Each triggers     
                         appropriate actions (refund trigger,  
                         no-show flag). No-show can only be    
                         marked after the venue's configured   
                         grace period has elapsed.             

  **Booking              Change party size, date, time, or     **Must Have**
  modification**         table notes for any booking. Guest    
                         notified automatically on change.     
                         Deposit amount adjusts only if party  
                         size increases (additional deposit    
                         request sent). Reductions in party    
                         size do not trigger partial refunds   
                         --- this is documented in booking     
                         terms.                                

  **Cancellation         Cancel a booking from the dashboard.  **Must Have**
  handling**             Deposit refund or forfeiture applied  
                         automatically per the venue's         
                         configured policy (full refund if 48+ 
                         hours before reservation, no refund   
                         otherwise).                           

  **Booking source       Every booking is labelled with its    **Must Have**
  label**                source: Website Widget, Booking Page, 
                         Phone, or Walk-in. Visible in the     
                         list view.                            

  **Availability         Block specific dates or time slots    **Must Have**
  management**           (private events, closures, bank       
                         holidays). Blocked slots unavailable  
                         across all booking channels           
                         instantly.                            

  **Connection status    A visible banner appears when the     **Must Have**
  indicator**            WebSocket connection to Supabase      
                         Realtime drops. Auto-polling fallback 
                         (30-second interval) activates to     
                         prevent stale data. Banner clears     
                         automatically when connection         
                         resumes.                              
  ---------------------------------------------------------------------------

## 3.4 Phone Booking Entry with Deposit Request

Phone bookings remain a significant part of how NI restaurants take
reservations --- especially from older customers and for special
occasions. Reserve NI does not try to eliminate this channel. It
captures it. When a staff member takes a booking over the phone, they
log it in the dashboard in under 30 seconds, and the system immediately
fires a deposit payment request to the guest.

  ---------------------------------------------------------------------------
  **What We Build**      **Why It Matters**                    **Priority**
  ---------------------- ------------------------------------- --------------
  **Quick phone booking  A minimal entry form: guest name,     **Must Have**
  entry**                phone number or email, date, time,    
                         party size, dietary note, and         
                         occasion. Completable in under 30     
                         seconds.                              

  **Automatic deposit    Immediately on logging the phone      **Must Have**
  payment request**      booking, the system sends the guest   
                         an email and SMS containing a secure  
                         Stripe payment link for their         
                         deposit. No staff action required     
                         after entering the booking.           

  **Deposit pending      Phone bookings awaiting deposit       **Must Have**
  flag**                 payment are flagged clearly in the    
                         reservations list. Staff can see at a 
                         glance which bookings are financially 
                         unconfirmed.                          

  **Auto-confirm on      Once the guest pays the deposit via   **Must Have**
  payment**              the payment link, the booking status  
                         changes to Confirmed automatically    
                         and the standard confirmation message 
                         is sent.                              

  **Unconfirmed booking  If a deposit payment link has not     **Must Have**
  reminder**             been acted on after two hours, the    
                         system sends one automated follow-up  
                         message to the guest.                 

  **Auto-cancel on       If a deposit payment link has not     **Must Have**
  non-payment**          been paid after 24 hours, the booking 
                         is automatically cancelled and the    
                         capacity is released. The guest is    
                         notified that their booking has been  
                         cancelled due to non-payment. Venue   
                         is notified of the auto-cancellation. 
  ---------------------------------------------------------------------------

## 3.5 Deposit Collection

The deposit feature is one of Reserve NI's most important selling
points. It is the mechanism that turns a booking from a vague intention
into a financial commitment. For the MVP, deposits are implemented using
Stripe Connect direct charges --- guest payments go directly to the
venue's connected Stripe account, and Reserve NI triggers refunds via
the Stripe API when a guest cancels within the allowed window. Reserve
NI never holds or controls deposit funds.

This direct charge model eliminates the regulatory complexity of a
platform-held deposit (which could engage FCA payment services
regulations under the Payment Services Regulations 2017) and is
significantly simpler to build, test, and explain to venues. A platform
hold model --- where Reserve NI collects and holds deposits centrally
before releasing them to venues --- is planned for Phase 2 once legal
review is complete and the direct charge model's limitations are
understood through real pilot data.

  -----------------------------------------------------------------------
  Architecture decision: The MVP uses Stripe Connect direct charges.
  Guest deposits are charged directly to the venue's connected Stripe
  account. Reserve NI never holds, controls, or routes deposit funds
  through a platform account. This means Reserve NI is not providing a
  payment service under the Payment Services Regulations 2017 and does
  not require FCA authorisation for the MVP deposit feature. A full
  platform hold model will be evaluated for Phase 2, subject to legal and
  payments compliance review.
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------

**Cancellation Policy**

The MVP implements a single, binary cancellation policy that applies to
all venues:

-   **Full refund:** Guest cancels 48 hours or more before the
    reservation time. Deposit is refunded automatically to the guest's
    card via the Stripe API.

-   **No refund:** Guest cancels less than 48 hours before the
    reservation time, or does not show. Deposit is retained by the venue
    (funds are already in their Stripe account).

This policy is communicated to the guest at three points: at the time of
booking (on the booking page and in the iFrame widget), in the booking
confirmation email, and in the confirm-or-cancel SMS sent 24 hours
before the reservation.

The 48-hour window is fixed for the MVP. Venue-configurable cancellation
windows (24 hours, 72 hours, etc.) are a Phase 2 enhancement. The
timezone used for all cancellation window calculations is Europe/London
(UK time).

  ---------------------------------------------------------------------------
  **What We Build**      **Why It Matters**                    **Priority**
  ---------------------- ------------------------------------- --------------
  **Deposit              Venue sets: deposit amount per head   **Must Have**
  configuration per      (recommended £5), and which bookings  
  venue**                require a deposit (all bookings,      
                         groups of 4+, weekends only).         
                         Cancellation policy is fixed at 48    
                         hours for the MVP.                    

  **Stripe direct charge Guest pays deposit via Stripe         **Must Have**
  collection**           directly to the venue's connected     
                         Stripe account at the point of        
                         booking (hosted page / widget) or via 
                         a payment link (phone bookings). Card 
                         details handled entirely by Stripe.   
                         Reserve NI never stores card data and 
                         never holds deposit funds.            

  **Direct charge model  Deposits are charged directly to the  **Must Have**
  (MVP)**                venue's connected Stripe account      
                         using Stripe Connect direct charges.  
                         Funds land in the venue's Stripe      
                         balance immediately (subject to       
                         Stripe's standard payout schedule).   
                         Reserve NI does not hold, route, or   
                         control deposit funds at any point.   
                         This eliminates regulatory risk under 
                         the Payment Services Regulations      
                         2017.                                 

  **Automatic refund on  If a guest cancels 48+ hours before   **Must Have**
  cancellation**         the reservation, Reserve NI triggers  
                         a refund via the Stripe API on the    
                         venue's connected account. The refund 
                         is returned to the guest's card       
                         automatically. If they cancel inside  
                         the 48-hour window, no action is      
                         taken --- the venue already has the   
                         funds. Webhook handlers must be       
                         idempotent. Daily reconciliation      
                         checks confirm Reserve NI's internal  
                         state matches Stripe's records.       

  **Stripe Connect venue Each venue completes a Stripe Connect **Must Have**
  onboarding**           onboarding during setup to enable     
                         deposit receiving. This must be a     
                         guided step in the venue onboarding   
                         flow --- not an optional extra.       
  ---------------------------------------------------------------------------

## 3.6 Guest Communications --- Email and SMS

Reserve NI automates the communications that venues currently handle
manually, inconsistently, or not at all. The MVP uses email and SMS.
WhatsApp Business API integration --- while planned and valuable ---
requires a separate application and approval process that could delay
launch. WhatsApp will be added in the first update post-launch.

  -----------------------------------------------------------------------
  Communication design principle: email is the primary channel for
  content-rich messages (confirmations, policy details). SMS is used for
  time-sensitive, action-required messages (confirm-or-cancel prompt,
  deposit payment request, last-minute updates). Not everything goes on
  both channels. Cost and consent are managed from the start.
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------

**Communication Architecture**

All communications are routed through a channel abstraction layer. The
communication service accepts a message type, a recipient, and a
payload, and routes it to the correct provider based on message type and
channel. SendGrid (email) and Twilio (SMS) are implementations behind
this interface. WhatsApp becomes a third implementation that plugs in
without touching business logic. This abstraction is a day-one
architectural requirement, not a future refactor.

  -------------------------------------------------------------------------------------
  **Communication**   **Channel**   **Timing**     **Details**           **Priority**
  ------------------- ------------- -------------- --------------------- --------------
  **Booking           Email         Immediately on Venue name, date,     **Must Have**
  confirmation**                    confirmed      time, party size,     
                                                   deposit amount,       
                                                   cancellation policy   
                                                   (48h window), venue   
                                                   address, dietary      
                                                   notes acknowledged.   
                                                   Includes link to      
                                                   manage/cancel         
                                                   booking.              

  **Deposit payment   Email + SMS   Immediately on Secure Stripe payment **Must Have**
  request**                         phone booking  link. Deposit amount, 
                                                   cancellation policy,  
                                                   booking summary. SMS  
                                                   contains short link   
                                                   only; email has full  
                                                   details.              

  **Deposit payment   SMS           2 hours after  One follow-up with    **Must Have**
  reminder**                        unpaid request payment link. Notes   
                                                   that booking will     
                                                   auto-cancel after 24  
                                                   hours if unpaid.      

  **Pre-visit         Email         48 hours       Booking details,      **Must Have**
  reminder**                        before         venue address,        
                                    reservation    dietary notes on      
                                                   file, cancellation    
                                                   policy reminder. This 
                                                   is also the last      
                                                   moment for a          
                                                   penalty-free          
                                                   cancellation.         

  **Confirm or cancel SMS           24 hours       Short link to a       **Must Have**
  prompt**                          before         simple web page with  
                                    reservation    two buttons: 'Confirm 
                                                   I'm Coming' and       
                                                   'Cancel My Booking'.  
                                                   The cancel button     
                                                   shows deposit         
                                                   implications before   
                                                   confirming. Not       
                                                   responding does NOT   
                                                   cancel the booking.   

  **Dietary digest**  Email         Morning of     All dietary           **Must Have**
                      (kitchen)     reservation    requirements and      
                                    day            allergies for the     
                                                   day's bookings,       
                                                   grouped by time slot. 
                                                   Sent to the venue's   
                                                   configured kitchen    
                                                   email address.        

  **Post-visit thank  Email         3 hours after  Thank you message     **Must Have**
  you**                             reservation    with optional review  
                                    end            prompt.               
                                                   Venue-customisable.   

  **Auto-cancel       Email + SMS   24h after      Informs guest their   **Must Have**
  notification**                    unpaid deposit booking was cancelled 
                                                   due to non-payment.   
                                                   Invites them to       
                                                   rebook.               
  -------------------------------------------------------------------------------------

**Template Variables**

All message templates support the following merge variables:
{{guest_name}}, {{venue_name}}, {{booking_date}}, {{booking_time}},
{{party_size}}, {{deposit_amount}}, {{cancellation_deadline}},
{{venue_address}}, {{dietary_notes}}, {{occasion}}, {{confirm_link}},
{{cancel_link}}, {{payment_link}}, {{manage_booking_link}}. Venues edit
tone and wording; they do not write from scratch. All templates have
sensible, tested defaults.

**The Confirm or Cancel Prompt**

This is the single most important communication in the no-show reduction
system. Sent by SMS 24 hours before a reservation, it contains a short
link to a simple, mobile-optimised web page showing the booking details
and two clear buttons: 'Confirm I'm Coming' and 'Cancel My Booking'. The
cancel button leads to a secondary confirmation page that clearly
restates the deposit implications (inside 48-hour window = no refund)
before completing the cancellation.

A single-link-to-web-page approach is used rather than two separate
links in the SMS body because it provides a cleaner SMS, allows the page
to show full booking details and deposit policy, enables proper tracking
of guest actions, and can be branded with the venue's name.

Critically: not responding to this message does NOT cancel the booking.
The design intent is to make cancellation easy --- to remove the social
awkwardness of cancelling by giving the guest a frictionless,
no-conversation way to do so.

## 3.7 Day Sheet View

The day sheet is what front-of-house staff run service from. It is a
single screen --- accessible on any device including a mounted tablet or
iPad at the host stand --- showing everything relevant to tonight's
service in a format that can be read at a glance under pressure.

  ---------------------------------------------------------------------------
  **What We Build**      **Why It Matters**                    **Priority**
  ---------------------- ------------------------------------- --------------
  **Today's bookings in  Time, guest name, party size, table   **Must Have**
  chronological order**  assignment (if set), dietary flags,   
                         occasion note, deposit status, and    
                         confirmation status. All on one line  
                         per booking.                          

  **Dietary and allergy  Allergy flags --- especially severe   **Must Have**
  highlighting**         ones like nut allergy --- displayed   
                         in a colour-coded format that cannot  
                         be missed. Shown prominently, not     
                         buried in a detail view.              

  **Guest check-in       One tap to mark a guest as arrived.   **Must Have**
  (arrived)**            Removes them from the 'expected' list 
                         and moves them to 'seated'. Status    
                         visible to all logged-in staff in     
                         real time.                            

  **No-show recording**  One tap to mark a guest as a no-show. **Must Have**
                         Only available after the venue's      
                         configured grace period has elapsed.  
                         Triggers deposit forfeiture if        
                         applicable.                           

  **Works on any         The day sheet is a responsive web     **Must Have**
  browser**              view. Works on a tablet, laptop, or   
                         phone. No separate app required for   
                         the MVP --- a browser tab pinned at   
                         the host stand is sufficient.         

  **Offline fallback**   Uses a service worker to cache the    **Should
                         last-loaded day sheet data. If        Have**
                         internet connectivity drops during    
                         service, the cached view remains      
                         visible with a clear 'Offline ---     
                         data may be stale' banner. Check-in   
                         actions taken while offline are       
                         queued locally and synced when        
                         connectivity resumes. The banner      
                         clears automatically on reconnection. 
  ---------------------------------------------------------------------------

## 3.8 Basic Reporting

Venues need to see whether Reserve NI is working. The reporting in the
MVP is deliberately minimal --- enough to demonstrate value and identify
patterns, not a full analytics suite.

  ---------------------------------------------------------------------------
  **What We Build**      **Why It Matters**                    **Priority**
  ---------------------- ------------------------------------- --------------
  **Bookings summary**   Total bookings by week and month.     **Must Have**
                         Breakdown by channel (website widget, 
                         booking page, phone, walk-in). Trend  
                         vs. prior period.                     

  **No-show and          No-show rate calculated as: (bookings **Must Have**
  cancellation rate**    marked no-show) / (bookings that      
                         reached their reservation time in     
                         Confirmed status). Cancellation rate  
                         calculated separately. Both tracked   
                         over time so venues can see           
                         improvement.                          

  **Deposit income**     Total deposits collected (charges on  **Must Have**
                         venue's Stripe account), deposits     
                         refunded, and deposits retained       
                         (no-shows and late cancellations).    
                         Gives venues clear visibility of the  
                         financial benefit.                    

  **Upcoming covers**    A simple forward-looking view: how    **Should
                         many covers are booked for the next 7 Have**
                         and 30 days, broken down by day.      
  ---------------------------------------------------------------------------

## 3.9 Availability and Capacity Model

The availability model is the foundation of the entire booking system.
It determines which slots guests see when they try to book, how
overbooking is prevented, and how the dashboard displays capacity. This
section provides the build-level specification that the rest of the
product depends on.

**Slot Models**

Each venue chooses one of two slot models during onboarding:

-   **Fixed intervals:** Venue selects an interval (15 or 30 minutes).
    Bookable slots are generated automatically based on opening hours.
    Example: a venue open 5pm--10pm with 30-minute intervals has slots
    at 5:00, 5:30, 6:00, and so on. Each slot has a maximum cover count.

-   **Named sittings:** Venue defines specific sittings with start and
    end times. Example: 'Early Bird' (5:00pm--6:45pm), 'Main'
    (7:00pm--9:30pm). Each sitting has a maximum cover count. Guests
    book into a sitting, not a specific time.

The slot model is set per venue and applies to all days. Venues can set
different max covers for different days of the week (e.g. 60 covers on
Friday, 40 on Tuesday).

**Turn-Time Logic (Optional)**

For venues using fixed intervals, turn-time logic is optional and
venue-configurable:

-   **If disabled:** Simple capacity model. Each slot has an independent
    max cover count. A booking at 7:00pm consumes capacity only in the
    7:00pm slot. The venue manages table turns manually.

-   **If enabled:** Venue sets an expected sitting duration (e.g. 90
    minutes). A booking at 7:00pm with a 90-minute sitting duration
    consumes capacity in the 7:00pm, 7:30pm, and 8:00pm slots. This
    prevents the system from overbooking when tables are still occupied
    from earlier sittings.

Turn-time logic is not applicable to named sittings (sittings already
define their own time boundaries). Default sitting duration is 90
minutes. Configurable from 60 to 180 minutes.

**Capacity Calculation**

When a guest selects a date and time (or sitting), the system calculates
available covers as follows:

-   **Simple model (no turn time):** Available = max_covers_for_slot −
    sum of party sizes of all Confirmed and Pending bookings in that
    slot.

-   **Turn-time model:** Available = minimum available covers across all
    slots that the sitting duration spans. A party of 4 at 7:00pm with
    90-minute turn blocks 4 covers in the 7:00, 7:30, and 8:00 slots.

Pending bookings (phone bookings awaiting deposit payment) consume
capacity. If the booking auto-cancels after 24 hours due to non-payment,
capacity is released immediately.

**Blocking**

Venues can block specific dates (Christmas Day, private event) or
specific time slots (private function in the early sitting). Blocked
slots show as unavailable across all booking channels. Blocking does not
affect existing confirmed bookings --- it only prevents new bookings.

## 3.10 Linked Accounts (Appointments SKUs --- Shipped)

Linked Accounts shipped after the original restaurant MVP for
**Appointments-family pricing tiers** (`light`, `plus`, `appointments`).
It is not part of the table-reservation MVP scope and is not listed in
section 4 as deferred work.

  ---------------------------------------------------------------------------
  **What We Built**      **Why It Matters**                    **Status**
  ---------------------- ------------------------------------- --------------
  **Pairwise venue       Independent venues link to share      **Shipped**
  links**                calendar visibility and limited
                         cross-venue booking actions (by
                         agreement). Each venue keeps its own
                         guests, bookings, and Stripe account.

  **Linked calendar      Staff see linked partners' bookings   **Shipped**
  view**                 on `/dashboard/linked-calendar` with
                         permission boundaries enforced in
                         APIs and RLS.

  **Venue collectives**  Optional combined public page at      **Shipped**
                         `/book/c/{slug}`; each booking still
                         belongs to one venue.

  **Settings and audit** Admins manage links under **Settings  **Shipped**
                         → Linked Accounts**; actions are
                         logged for compliance review.
  ---------------------------------------------------------------------------

Specification: `Docs/reserveni-linked-accounts-spec.md`. Calendar grid
integration scope: `Docs/archive/reserveni-linked-calendar-grid-integration-scope.md`.

# 4. What Is Not in the MVP

Every feature below has been discussed, evaluated, and deliberately
excluded from the original restaurant MVP. Some are planned for specific
later phases. Others have been set aside indefinitely. Capabilities that
have since shipped (for example Linked Accounts on Appointments SKUs) are
documented in section 3.10 and are not repeated here. The discipline of
this list is what makes the four-month build timeline achievable.

  -----------------------------------------------------------------------
  **Feature**            **When and Why**
  ---------------------- ------------------------------------------------
  **Consumer-facing app  Phase 2. The MVP is venue-facing. Guests book
  or discovery portal**  via venues' own channels, not through a Reserve
                         NI consumer marketplace.

  **Table management and Phase 2. The MVP manages covers and capacity,
  floor plan**           not individual tables. Table assignment is a
                         visual planning tool that adds build complexity
                         without changing the core booking workflow.

  **Reserve with Google  Apply for approval during MVP build (8--12 week
  integration**          approval process). Integrate immediately on
                         approval. This should be running before or soon
                         after pilot launch.

  **WhatsApp Business    First post-launch update. Requires separate Meta
  API**                  business verification. The communication
                         abstraction layer built for the MVP makes adding
                         WhatsApp a provider swap, not a rewrite.

  **Platform deposit     Phase 2 --- requires legal and FCA compliance
  hold model**           review. MVP uses direct charges to venue Stripe
                         accounts instead. See section 3.5.

  **Venue-configurable   Phase 2. MVP uses a fixed 48-hour full-refund
  cancellation windows** window for all venues.

  **Multi-venue          Phase 3. No pilot venue operates multiple sites.
  management dashboard** 

  **Integrated retail    Deliberately out of scope --- not on the product
  POS (chair-side        roadmap. Target customers (independents, sole
  checkout, inventory,  traders, collectives) already use separate
  stock control)**       terminals (SumUp, Zettle, bank readers).
                         Reserve NI handles booking deposits and
                         pre-payments via Stripe Connect; retail at the
                         chair is kept on existing hardware. See
                         `Docs/Resneo-Appointments-Review-And-Roadmap.md`
                         section 6.2.

  **Advanced analytics   Phase 2. MVP reporting covers the metrics needed
  and custom reports**   to prove the core thesis.

  **Data export to       Phase 2. Guest data is stored in a structure
  Mailchimp / Klaviyo**  that makes export straightforward when needed.

  **Loyalty or rewards   Phase 3. Requires consumer identity layer.
  programme**            

  **AI-powered demand    Phase 3. Requires six or more months of booking
  forecasting**          data per venue.

  **Native mobile app    Phase 2 or later. The responsive web dashboard
  (iOS / Android)**      is sufficient for the MVP. A native app adds
                         build time and app store review cycles.
  -----------------------------------------------------------------------

# 5. Technical Architecture

## 5.1 Technology Stack

  -----------------------------------------------------------------------
  **Component**          **Details**
  ---------------------- ------------------------------------------------
  **Frontend**           Next.js (React). Server-side rendered for SEO on
                         booking pages. Dashboard and booking page in the
                         same codebase but in clearly separated directory
                         structures with separate API routes. Shared
                         components live in a shared library folder. This
                         separation is a day-one architectural
                         requirement to enable clean separation in Phase
                         2 when the consumer-facing experience becomes a
                         distinct product.

  **Backend**            Next.js API routes with Supabase (hosted
                         PostgreSQL). Row-level security for venue data
                         isolation. Real-time subscriptions via Supabase
                         Realtime (WebSocket) with automatic polling
                         fallback on disconnection.

  **Hosting**            Vercel (frontend and API routes). Supabase
                         (database, auth, real-time). Both have generous
                         free tiers that cover the pilot phase.

  **Payments**           Stripe + Stripe Connect --- deposit collection
                         via direct charges to venue connected accounts.
                         Refunds triggered by Reserve NI via Stripe API.
                         PCI Level 1 certified. Reserve NI never stores
                         card data and never holds deposit funds.
                         Platform hold model planned for Phase 2 subject
                         to legal review.

  **Email**              SendGrid. Transactional emails for booking
                         confirmations, reminders, deposit receipts, and
                         thank-you messages. Routed through the
                         communication abstraction layer.

  **SMS**                Twilio. Confirm-or-cancel prompts, deposit
                         payment links, and time-sensitive notifications.
                         Routed through the communication abstraction
                         layer.

  **Communication        A channel routing service that accepts a message
  abstraction**          type, recipient, and payload, and routes to the
                         correct provider. SendGrid and Twilio are
                         implementations behind this interface. WhatsApp
                         will be a third implementation. Built on day
                         one.

  **Authentication**     Supabase Auth with email + password. Venue staff
                         invited by admin. Two roles: Admin and Staff.
  -----------------------------------------------------------------------

## 5.2 API Architecture

API routes are namespaced by consumer from day one to enable clean
separation as the product grows:

-   **/api/venue/** Dashboard endpoints. Authenticated venue staff only.
    Booking management, availability, settings, reporting.

-   **/api/booking/** Public booking widget and hosted page endpoints.
    Unauthenticated (guest-facing). Availability checks, booking
    creation, deposit payment, cancellation.

-   **/api/webhooks/** Stripe webhook receivers. Idempotent handlers for
    payment events, refund confirmations, and dispute notifications.

-   **/api/consumer/** Reserved namespace for Phase 2 consumer-facing
    app. Not implemented in the MVP but the namespace is claimed.

## 5.3 Data Model

The database schema uses PostgreSQL via Supabase. Key tables and their
relationships are described below. Configuration fields (booking_rules,
deposit_config, opening_hours, availability_config) are stored as JSONB
for flexibility, but each has a defined and validated JSON schema.
Validation happens on write. This ensures clean, queryable data when
cross-venue queries are needed in later phases.

  -----------------------------------------------------------------------
  **Table**              **Description**
  ---------------------- ------------------------------------------------
  **Venues**             Core venue profile. Name, address, cuisine type,
                         opening hours, contact details, cover photo,
                         timezone (default Europe/London). Contains JSONB
                         config fields: booking_rules, deposit_config,
                         opening_hours, availability_config (slot model,
                         turn-time settings), communication_templates,
                         no_show_grace_minutes (default 15).

  **Bookings**           Individual booking record. Links to venue and
                         guest. Status enum: Pending, Confirmed, Arrived,
                         No-Show, Cancelled. Source enum: Widget,
                         BookingPage, Phone, WalkIn. Party size, date,
                         time, dietary notes, occasion, special requests.
                         Deposit status: None, Pending, Paid, Refunded,
                         Forfeited. Stripe payment intent ID. The
                         cancellation policy version that was in effect
                         at the time of booking is stored on the record
                         (cancellation_policy_snapshot) so that policy
                         changes never retroactively affect existing
                         bookings.

  **Guests**             One record per unique guest per venue, matched
                         on normalised email or phone number. Name,
                         email, phone, dietary preferences, visit count,
                         no-show count, last visit date. Also contains a
                         global_guest_hash field computed from normalised
                         email or phone --- not used in the MVP but
                         enables cross-venue guest unification in Phase 2
                         without data migration.

  **Events**             Immutable event log. Every booking-relevant
                         action is recorded: booking_created,
                         booking_confirmed, guest_arrived,
                         no_show_recorded, deposit_paid,
                         refund_processed, booking_cancelled,
                         booking_modified. Each event has a timestamp,
                         event type, booking ID, venue ID, and a JSONB
                         payload with event-specific details. Nightly
                         materialised views for reporting are computed
                         from this table. When Phase 2 requires richer
                         analytics, this events table becomes the
                         foundation.

  **Staff**              Venue staff accounts. Linked to venue. Role:
                         Admin or Staff. Email, name.

  **Communications**     Log of every message sent. Message type,
                         channel, recipient, timestamp, delivery status,
                         template version. Used for debugging, audit
                         trail, and the booking detail communication
                         history view.
  -----------------------------------------------------------------------

**Guest Identity Matching**

When a booking is created, the system checks for an existing guest
record at that venue using the following logic:

-   **Email match:** If the booking email (lowercased, trimmed) matches
    an existing guest record's email at the same venue, the booking is
    linked to that guest. Visit count is incremented.

-   **Phone match:** If no email match is found, and the booking phone
    number (normalised to E.164 format) matches an existing guest
    record's phone at the same venue, the booking is linked to that
    guest.

-   **No match:** A new guest record is created. The global_guest_hash
    is computed from the normalised email (preferred) or phone number.

This logic runs automatically on every booking. Venues do not see or
manage it directly --- they simply see a guest's visit count and history
growing over time.

## 5.4 Security and Compliance

  -----------------------------------------------------------------------
  **Area**               **Approach**
  ---------------------- ------------------------------------------------
  **PCI DSS**            No card data stored on Reserve NI servers. All
                         card handling via Stripe. Reserve NI stores only
                         Stripe payment intent IDs. Deposit funds are
                         never held by Reserve NI --- direct charges go
                         to venue connected accounts.

  **Data protection (UK  Guest data stored in Supabase (EU-hosted
  GDPR)**                region). Privacy policy and booking terms
                         presented at the point of booking. Data
                         retention policies per UK GDPR requirements.
                         Venue is data controller for their guest data;
                         Reserve NI is data processor.

  **Row-level security** Supabase RLS ensures venues can only access
                         their own data. No cross-venue data leakage.
                         Enforced at the database level, not just the
                         application level.

  **Webhook security**   All Stripe webhooks verified using Stripe's
                         signature verification. Webhook handlers are
                         idempotent --- processing the same event twice
                         produces the same result. Failed webhooks are
                         retried with exponential backoff.

  **iFrame security**    Booking widget uses Content Security Policy
                         headers. Parent page communication via
                         postMessage with origin validation. Stripe
                         payment elements rendered in Stripe's own iFrame
                         for PCI compliance.
  -----------------------------------------------------------------------

## 5.5 Reconciliation and Data Integrity

A daily reconciliation job runs every morning and compares Reserve NI's
internal deposit and booking state against Stripe's records via the
Stripe API. Any discrepancies (deposit marked as Paid internally but not
found in Stripe, refund marked as processed but not confirmed by Stripe)
are flagged in an internal alert. At pilot scale with 20 venues, the
founding team reviews these alerts manually. This is the safety net that
catches any issues with webhook delivery, timing, or edge cases in the
direct charge refund flow.

# 6. Pricing and Revenue Model

## 6.1 Pricing Tiers

Reserve NI uses a flat monthly subscription model. No per-cover
commissions, no percentage-based charges. This is a genuine
differentiator against ResDiary (which charges per cover above certain
thresholds) and OpenTable (which charges per cover on all bookings). The
flat fee makes costs predictable and means venues are never penalised
for being busy.

  -----------------------------------------------------------------------
  **Tier**               **Details**
  ---------------------- ------------------------------------------------
  **Professional ---     The primary tier. Unlimited covers, full deposit
  £79/month**            system, all communications (email + SMS), full
                         reporting, iFrame widget, hosted booking page,
                         QR codes, day sheet, all features described in
                         this document. This is the tier all founding
                         partners start on.

  **Starter ---          For very small or seasonal venues. Pay-per-cover
  £1/cover, max 40       commission up to a hard cap of 40 covers per
  covers/month**         month. No deposit collection. Email and basic
                         SMS only (no confirm-or-cancel prompt). Limited
                         reporting. Designed as an entry point, not a
                         long-term home --- venues hitting 40 covers
                         regularly are naturally upgraded to Professional
                         where they save money.
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------
  Starter tier design: At £1 per cover with a 40-cover cap, a Starter
  venue pays a maximum of £40/month. The absence of deposits, the
  confirm-or-cancel prompt, and advanced reporting means the core no-show
  reduction features --- the reason most venues sign up --- are only
  available on Professional. This creates a clear upgrade incentive
  without making Starter feel crippled.
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------

## 6.2 Founding Partner Programme

The first 10--20 venues receive the Professional tier free for six
months. After six months, they move to the standard £79/month rate. This
gives the founding team enough time to demonstrate value and build
habit, while generating a willingness-to-pay signal by month seven.
Founding partners also receive:

-   **Priority support:** Direct phone/WhatsApp access to a founder for
    the first six months.

-   **Feature input:** Their feedback directly shapes what gets built
    next.

-   **Locked rate:** £79/month guaranteed for 24 months regardless of
    future price changes.

## 6.3 Revenue Streams

  -----------------------------------------------------------------------
  **Stream**             **Details**
  ---------------------- ------------------------------------------------
  **Professional         £79/month per venue. The primary revenue source.
  subscription**         Recurring, predictable, and not tied to booking
                         volume.

  **Starter per-cover    £1 per cover up to 40 covers per month.
  fees**                 Secondary revenue. Expected to be a small
                         proportion of total revenue as most target
                         venues will be on Professional.

  **Deposit processing   Not applicable in the MVP. The direct charge
  margin**               model sends deposits straight to venue Stripe
                         accounts with no platform margin. A processing
                         margin (1--1.5% of deposit value) becomes
                         possible in Phase 2 if the platform hold model
                         is implemented.
  -----------------------------------------------------------------------

## 6.4 Per-Venue Cost Model

Understanding the per-venue cost structure is essential for margin
viability, especially during the founding period when revenue is zero.

  -----------------------------------------------------------------------
  **Cost Component**     **Estimate**
  ---------------------- ------------------------------------------------
  **SMS (Twilio)**       UK SMS costs approximately 4--5p per message via
                         Twilio. A venue doing 80 bookings per week
                         generates roughly 240--320 SMS per month
                         (deposit requests, confirm-or-cancel prompts,
                         reminders). Estimated cost: £10--£16 per venue
                         per month.

  **Email (SendGrid)**   Transactional email cost is negligible at pilot
                         scale (SendGrid free tier covers 100
                         emails/day). At full scale, approximately £1--2
                         per venue per month.

  **Supabase**           Free tier covers the pilot. At scale,
                         approximately £0.50--£1 per venue per month for
                         database and auth.

  **Vercel**             Free tier covers the pilot. At scale,
                         approximately £0.50--£1 per venue per month for
                         hosting and serverless functions.

  **Stripe fees**        Borne by the venue (direct charges to their
                         account). Reserve NI pays no Stripe fees in the
                         MVP.

  **Total estimated cost £12--£20 per venue per month at pilot scale.
  per venue**            Against £79 revenue, this gives approximately
                         £59--£67 gross margin per paying venue
                         (75--85%).
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------
  SMS is the largest variable cost. The founding team should track SMS
  volume per venue from week one and model the break-even point at
  different venue counts. At 20 paying venues: £1,580 monthly revenue vs.
  £240--£400 in costs = strong unit economics. But during the six-month
  free period with founding partners, the costs are pure burn.
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------

## 6.5 Financial Runway

The founding team must have a clear view of monthly burn rate before
launching the pilot. Key components: hosting costs (minimal during
pilot), SMS and email costs (the primary variable expense), Stripe fees
(none for Reserve NI in the MVP), any third-party tool subscriptions,
and founder living costs. The six-month free period means zero revenue
until month seven at the earliest. The team should know exactly how many
months of runway they have and what triggers the decision to seek
investment, adjust pricing, or change strategy.

# 7. Pre-Sales and Venue Acquisition

## 7.1 Pre-Sales Strategy

Prove demand before building. The founding team should have five to ten
verbal commitments from venue owners before writing a line of production
code. These are not binding contracts --- they are handshake-level
confirmations that the product as described is something the venue owner
would use.

**Pre-Sales Conversation Structure**

Each conversation should follow this approximate structure:

-   **Open with their problem:** Ask how they currently manage bookings
    and what their no-show rate is. Let them talk. The goal is to
    understand their current workflow and pain, not to pitch.

-   **Show the solution:** Walk through the booking page, the dashboard,
    the day sheet, and the deposit flow. Use realistic scenarios. Show
    them how a Friday night would look in Reserve NI compared to their
    current system.

-   **Explain the deposit collection model:** Be clear that deposits go
    directly to their Stripe account, not held by Reserve NI. Explain
    the 48-hour refund window. Address concerns about guest friction
    honestly --- acknowledge that some guests may resist deposits, but
    frame it as filtering out the least committed bookings.

-   **Explain the founding partner offer:** Six months free, then
    £79/month. Locked rate for 24 months. Direct founder support. Their
    feedback shapes the product.

-   **Ask for the commitment:** Would you use this? Would you be one of
    our first ten venues? Can we onboard you in the first week of
    launch?

## 7.2 Self-Reported No-Show Baseline

  -----------------------------------------------------------------------
  Important measurement note: venue owners' self-reported no-show rates
  are unreliable. They tend to overestimate because they remember the
  painful Friday nights and forget the quiet Tuesdays. Before enabling
  deposits, Reserve NI should track a 2--4 week baseline measurement
  period during onboarding where the system records actual no-shows
  without deposits active. This gives a defensible before/after
  comparison that proves the product's value with real data, not memory.
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------

## 7.3 Competitive Positioning

The Northern Ireland market has two primary competitors that Reserve NI
will encounter in sales conversations:

**ResDiary**

The dominant booking platform in Northern Ireland and Ireland. Used by a
significant number of NI restaurants, particularly mid-to-upper-end
venues. Strengths: established, trusted, extensive feature set, good
Reserve with Google integration. Weaknesses for NI independents:
per-cover pricing becomes expensive at volume, complex interface with
features most independents never use, support is not NI-specific, and
the system is designed for larger operations. Reserve NI's positioning
against ResDiary: simpler, cheaper at volume (flat fee vs. per-cover),
built specifically for the NI market, and a more focused product that
does the essential things better rather than doing everything.

**OpenTable**

Global brand with strong consumer-side recognition. Strengths: large
consumer marketplace that drives inbound bookings, strong brand trust.
Weaknesses for NI independents: per-cover fees on all bookings
(including those the venue would have received anyway), guest data
belongs to OpenTable not the venue, and the NI market is not a priority
for OpenTable's product or support teams. Reserve NI's positioning:
venues own their guest data, no per-cover fees, and the deposit system
provides no-show reduction that OpenTable does not offer at this price
point.

**How to Handle 'We Already Use ResDiary'**

This will be the most common objection. The response is not to trash
ResDiary --- it is a good product. The response is: 'We know ResDiary
works for a lot of venues. Here is what we do differently: our pricing
is flat at £79/month regardless of how many covers you do, our deposit
system is designed from the ground up around no-show reduction, and we
are based here in Northern Ireland which means when something goes wrong
on a Friday night, you can call us.' The goal is to position Reserve NI
as the better fit for their specific situation, not the universally
superior product.

# 8. Venue Onboarding and Operations

## 8.1 Onboarding Process

All pilot venues are onboarded personally by a founder. Target: under 60
minutes per venue including Stripe Connect setup. The onboarding session
covers:

-   **Venue profile setup:** Enter venue details, upload cover photo,
    set opening hours.

-   **Availability configuration:** Choose slot model (fixed interval or
    named sittings), set max covers, optionally enable turn-time logic.
    Walk through a few scenarios to confirm the model matches reality.

-   **Deposit configuration:** Set deposit amount per head, choose which
    bookings require deposits. Explain the 48-hour cancellation policy.

-   **Stripe Connect setup:** Walk through Stripe Connect business
    verification together. This is the step most likely to cause
    friction --- do not leave it for venues to complete alone. Sole
    traders and partnerships may need specific documents. Have a
    checklist ready.

-   **Communication templates:** Review default message templates,
    customise with venue name and tone. Test a confirmation email and
    SMS.

-   **Staff accounts:** Set up admin and staff logins. Show staff the
    day sheet and check-in flow.

-   **Booking page and widget:** Deploy the hosted booking page and
    iFrame widget. Test a live booking end-to-end including deposit
    payment. Install widget code on venue's website if they want it.

-   **QR code:** Generate and provide QR code. Discuss placement: table
    cards, menus, window sticker.

-   **Baseline measurement:** Explain the 2--4 week baseline period
    where the system tracks actual no-shows before deposits are
    activated.

## 8.2 Launch Checklist

Every item must be confirmed before the first venue goes live:

-   **Stripe Connect:** Direct charge architecture confirmed and tested
    end-to-end with real money (small amounts on founder cards).

-   **Reconciliation:** Daily deposit reconciliation check (Reserve NI
    state vs. Stripe records) built and tested.

-   **Communications:** All message templates tested across email and
    SMS. Confirm-or-cancel page functional on mobile.

-   **Availability engine:** Both slot models (fixed interval and named
    sittings) tested with turn-time enabled and disabled.

-   **WebSocket fallback:** Connection status indicator and polling
    fallback tested under disconnection conditions.

-   **Offline day sheet:** Service worker caching and action queuing
    tested (if included in MVP).

-   **Booking flow:** End-to-end booking tested on hosted page and
    iFrame widget, including deposit, confirmation, modification,
    cancellation, and refund.

-   **Webhook idempotency:** Stripe webhooks tested for duplicate
    delivery. Same event processed twice produces same result.

-   **Privacy and terms:** Privacy policy, booking terms, and
    cancellation policy live and presented at point of booking.

-   **Reserve with Google:** Application submitted. Integrate
    immediately on approval (8--12 week process).

## 8.3 Ongoing Venue Support

During the pilot period, the founding team is the support team. Every
venue has direct phone or WhatsApp access to a founder. Response time
target: under one hour during service hours, under four hours outside
service hours. Structured weekly check-ins for the first month, then
fortnightly. The purpose of these check-ins is not just support --- it
is product intelligence. What is working? What is confusing? What do
they wish the system did? What did their staff complain about? This is
the richest product feedback source available and should be treated as
such.

## 8.4 Venue Exit Policy

If a venue decides to leave Reserve NI, the following applies:

-   **Notice period:** 30 days from date of cancellation request.

-   **Data export:** Venue receives a full export of their booking
    history and guest data in CSV format within 7 days of request. This
    is their data; they are entitled to it under UK GDPR.

-   **Pending bookings:** All future bookings with deposits already paid
    remain active through the notice period. Deposits already in the
    venue's Stripe account are not affected (Reserve NI never held
    them). The venue must honour the cancellation policy for existing
    bookings.

-   **Stripe Connect:** The venue's Stripe Connect account is
    disconnected from the Reserve NI platform at the end of the notice
    period. Their Stripe account itself is unaffected --- they retain
    full access.

-   **Booking page:** Deactivated at the end of the notice period.
    iFrame widget stops accepting bookings.

# 9. Success Metrics

These are the numbers that tell us whether Reserve NI is working. They
are deliberately minimal --- a small number of metrics tracked
rigorously is more useful than a dashboard of vanity metrics. The
founding team should review these weekly.

## 9.1 Primary Metrics (Prove the Thesis)

  -----------------------------------------------------------------------
  **Metric**             **Target and Method**
  ---------------------- ------------------------------------------------
  **No-show reduction**  Target: 30% reduction in no-show rate vs.
                         baseline. Measured as: no-show rate during
                         deposit-active period compared to no-show rate
                         during 2--4 week baseline measurement period.
                         Baseline is actual system-recorded data, not
                         venue owner estimates.

  **Venue retention at   Target: 80%+ of founding venues convert to
  month 7**              paying £79/month after the six-month free
                         period. This is the single most important
                         business validation metric.

  **Active daily use**   Target: founding venue staff log in and interact
                         with the dashboard on every day they are open
                         for service. Measured by session data. If a
                         venue stops using the dashboard, that is a churn
                         signal regardless of whether they are paying.
  -----------------------------------------------------------------------

## 9.2 Secondary Metrics (Understand the Business)

  -----------------------------------------------------------------------
  **Metric**             **What It Tells Us**
  ---------------------- ------------------------------------------------
  **Bookings per venue   Track volume and growth. Expect 30--100 bookings
  per week**             per week per active venue. Monitor channel mix
                         (widget vs. booking page vs. phone vs. walk-in).

  **Confirm-or-cancel    What percentage of guests tap one of the two
  response rate**        buttons in the SMS prompt? Non-response is
                         acceptable (booking stands), but high response
                         rates indicate guest engagement.

  **Deposit compliance   What percentage of bookings that require a
  rate**                 deposit result in a paid deposit? For phone
                         bookings specifically, what percentage pay
                         within 24 hours vs. auto-cancel?

  **SMS cost per venue   Track actual Twilio spend per venue. Validate
  per month**            against the cost model in section 6.4. Flag any
                         venue generating significantly more SMS than
                         expected.

  **Refund success       What percentage of eligible refunds (guest
  rate**                 cancels 48+ hours before) complete successfully
                         via the Stripe API? Any failure requires
                         investigation.

  **Time from signup to  How quickly do onboarded venues start receiving
  first live booking**   real bookings through the system? Target: first
                         booking within 48 hours of onboarding.
  -----------------------------------------------------------------------

## 9.3 Reporting Calculation Definitions

To ensure metrics are consistent and defensible:

-   **No-show rate:** (Bookings marked No-Show) / (Bookings that reached
    their reservation time in Confirmed status). Cancelled bookings are
    excluded from the denominator. Walk-ins are excluded (they cannot
    no-show).

-   **Cancellation rate:** (Bookings cancelled by guest or
    auto-cancelled) / (Total bookings created). Includes both
    guest-initiated cancellations and auto-cancellations from unpaid
    phone booking deposits.

-   **Deposit retention rate:** (Deposits forfeited due to no-show or
    late cancellation) / (Total deposits paid). Shows the financial
    consequence of no-shows and late cancellations.

# 10. Risks and Mitigations

Risks are ranked by a combination of likelihood and potential impact on
the pilot's success.

  ------------------------------------------------------------------------------
  **Risk**        **Level**    **Description**          **Mitigation**
  --------------- ------------ ------------------------ ------------------------
  **Guest deposit **High**     Some guests will abandon Frame deposits as a
  resistance**                 the booking flow when    guarantee of the table,
                               asked for a deposit.     not a penalty.
                               This is most likely with Communicate clearly at
                               first-time guests and    every touchpoint. Allow
                               older demographics       venues to configure
                               unfamiliar with          which bookings require
                               deposit-based booking.   deposits (e.g. groups of
                                                        4+ only) so they can
                                                        ease in. Track booking
                                                        completion rate with and
                                                        without deposits to
                                                        measure actual drop-off.

  **Deposit       **Medium**   With direct charges,     Monitor refund success
  refund                       refunds depend on the    rates from week one.
  reliability**                venue's Stripe account   Daily reconciliation
                               having sufficient        between Reserve NI state
                               balance. If a venue has  and Stripe records. At
                               withdrawn all funds and  20 pilot venues, founder
                               a guest cancels, the     relationships allow
                               refund could fail or     direct intervention.
                               Stripe may attempt to    Track frequency --- if
                               debit the venue's linked refund failures become a
                               bank account.            recurring problem, this
                                                        is the strongest signal
                                                        to prioritise the
                                                        platform hold model in
                                                        Phase 2.

  **SMS cost      **Medium**   Twilio costs are the     Track SMS volume per
  overrun**                    largest variable         venue weekly from
                               expense. A venue         launch. Set per-venue
                               generating more bookings monthly SMS budget
                               than expected could push alerts. If costs exceed
                               per-venue SMS costs      model, evaluate: can
                               above the modelled       some messages move to
                               range, compressing       email-only? Can SMS be
                               margins.                 batched? Is the cost
                                                        justified by the no-show
                                                        reduction value? Build
                                                        the cost model into the
                                                        weekly review cadence.

  **Stripe        **Medium**   Some venue owners will   Do the Stripe Connect
  Connect                      struggle with business   onboarding together with
  onboarding                   verification steps in    every founding partner
  friction**                   Stripe Connect,          during the onboarding
                               particularly if they are call. Never leave it as
                               sole traders or have     a self-serve task.
                               complex ownership        Prepare a document
                               structures.              checklist for common
                                                        business types (sole
                                                        trader, partnership,
                                                        limited company).

  **ResDiary      **High**     Venues already using     Do not require venues to
  switching                    ResDiary may be          switch entirely. Offer a
  inertia**                    reluctant to switch even parallel run period
                               if they are unhappy with where they use both
                               it. The switching cost   systems. Focus sales
                               (learning new system,    conversations on the
                               migrating bookings) is a deposit feature that
                               real barrier.            ResDiary does not match
                                                        at this price point.
                                                        Target venues that are
                                                        not currently using any
                                                        platform, not just
                                                        ResDiary users.

  **Venue owner   **Medium**   Some NI restaurant       Founder-led onboarding
  tech                         owners are not           handles initial setup.
  resistance**                 comfortable with         The day sheet is
                               technology. They may     deliberately designed to
                               agree to sign up but     be simpler than what
                               struggle to use the      they use now. Weekly
                               system consistently.     check-ins catch usage
                                                        drop-offs early. If a
                                                        venue is struggling,
                                                        offer a second training
                                                        session with their
                                                        front-of-house team
                                                        specifically.

  **Build         **Medium**   Four months is           Identify a soft-launch
  timeline                     achievable but tight for feature set that could
  overrun**                    three founders building  ship in 3 months with
                               with AI-assisted         the remaining features
                               development. The         following 2--4 weeks
                               availability engine and  later. The availability
                               Stripe integration are   engine and deposit
                               the highest-risk areas.  system are the critical
                                                        path --- build these
                                                        first, not last. Build
                                                        in a 2-week buffer.

  **Data loss or  **Low**      Supabase or Vercel       Offline day sheet
  service                      experiences an outage    fallback preserves the
  outage**                     during a venue's         most critical view.
                               service. Bookings cannot Database backups via
                               be viewed or created.    Supabase's built-in
                                                        backup system.
                                                        Connection status
                                                        indicator prevents staff
                                                        from relying on stale
                                                        data unknowingly. At
                                                        pilot scale, the
                                                        founding team can
                                                        provide manual support
                                                        during any outage.
  ------------------------------------------------------------------------------

# 11. Build Timeline

Four-month build from start of development to first venue live. The
founding team consists of two people building with AI-assisted
development tools. The critical path runs through the availability
engine, the deposit system, and the communication engine. These three
systems are interdependent and must be built in order.

  -----------------------------------------------------------------------
  Sequencing principle: the availability engine is the foundation
  (everything depends on knowing what slots are available), the deposit
  system sits on top of it (deposits require a confirmed booking in a
  valid slot), and the communication engine wraps around both (every
  booking and deposit event triggers messages). Build in this order.
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------

## 11.1 Pre-Build (Weeks 0--2)

Before any production code:

-   **Pre-sales conversations:** 5--10 venue owner conversations to
    validate demand and gather workflow details.

-   **Stripe Connect setup:** Create platform account, configure direct
    charge settings, test end-to-end with real money.

-   **Reserve with Google:** Submit application immediately. 8--12 week
    approval process runs in parallel with the entire build.

-   **Design and schema:** Finalise database schema including JSON
    schemas for JSONB config fields. Define API route structure with
    namespacing. Wireframe key screens: booking page, dashboard, day
    sheet.

## 11.2 Phase A: Core Foundation (Weeks 3--6)

-   **Database and auth:** Supabase setup, schema creation, row-level
    security policies, staff authentication.

-   **Availability engine:** Both slot models (fixed interval and named
    sittings), turn-time logic (optional), capacity calculation,
    blocking. This is the most complex piece of logic in the product and
    must be thoroughly tested.

-   **Venue onboarding flow:** Profile setup, availability
    configuration, booking rules, deposit settings.

-   **Events table:** Immutable event logging for all booking actions
    from day one.

## 11.3 Phase B: Booking and Payments (Weeks 7--10)

-   **Hosted booking page:** Guest-facing booking flow with real-time
    availability, guest details capture, dietary and occasion fields.

-   **iFrame widget:** Embeddable version with postMessage communication
    and Stripe Elements integration.

-   **Deposit system:** Stripe Connect direct charge integration,
    payment link generation for phone bookings, refund logic for 48-hour
    cancellation window, webhook handlers with idempotency.

-   **Phone booking entry:** Quick entry form, automatic deposit
    request, 24-hour auto-cancel on non-payment.

-   **Reconciliation:** Daily reconciliation job comparing internal
    state to Stripe records.

## 11.4 Phase C: Dashboard and Communications (Weeks 11--14)

-   **Reservations dashboard:** Live booking list, detail view, status
    management, modification handling, availability management.

-   **Day sheet:** Service view with dietary highlighting, check-in,
    no-show recording with grace period, connection status indicator and
    polling fallback.

-   **Communication engine:** Channel abstraction layer, SendGrid and
    Twilio integrations, all message templates, confirm-or-cancel web
    page, template variable system.

-   **Reporting:** Materialised views computed from events table.
    Booking summary, no-show rate, cancellation rate, deposit income.

-   **QR codes:** Auto-generation per venue.

## 11.5 Phase D: Testing and Launch (Weeks 15--16)

-   **End-to-end testing:** Full booking lifecycle tested: online
    booking with deposit, phone booking with deposit link, confirmation,
    reminder, confirm-or-cancel prompt, arrival, no-show, cancellation
    with refund, cancellation without refund.

-   **Real money testing:** Test deposits and refunds with real cards
    (founder accounts). Stripe test mode does not reproduce all timing
    and failure modes.

-   **Onboarding dry run:** Onboard one or two friendly venues and
    observe their first week of real service. Fix everything that breaks
    or confuses.

-   **Pilot launch:** Begin onboarding the founding partner cohort.

  -----------------------------------------------------------------------
  Buffer: the timeline includes a 2-week buffer (weeks 15--16) that can
  absorb overruns from earlier phases. If the build runs to schedule, use
  this time for the offline day sheet fallback and additional testing. Do
  not fill buffer time with new features.
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------

# 12. Beyond the MVP

These are the features and capabilities planned for after the MVP is
live and the founding cohort is active. They are listed to show where
the product is heading, not to commit to specific timelines. Priorities
will be adjusted based on what is learned during the pilot.

## 12.1 Phase 2 --- Platform Deepening (Months 5 to 10)

-   **Platform deposit hold model:** Subject to legal and FCA compliance
    review, migrate from direct charges to a platform hold model where
    Reserve NI collects and holds deposits centrally before releasing to
    venues. Enables guaranteed refund reliability, processing margin
    revenue, and tighter guest experience control. Only pursued if pilot
    data from the direct charge model reveals refund reliability as a
    genuine problem.

-   **WhatsApp Business API:** If not completed at end of MVP phase,
    WhatsApp is the first Phase 2 communication addition. Plugs into the
    communication abstraction layer built in the MVP.

-   **Venue-configurable cancellation windows:** Allow venues to set
    their own cancellation deadline (24 hours, 48 hours, 72 hours) and
    optionally define partial refund tiers.

-   **Consumer-facing booking experience:** A consumer-facing portal
    where guests can discover venues, view availability, and book.
    Leverages the global_guest_hash for cross-venue guest unification.

-   **Table management and floor plan:** Visual table layout, table
    assignment, and table-level availability (as opposed to cover-level
    only).

-   **Guest CRM depth:** Guest preferences, visit history across the
    venue, spend tracking, VIP flags, birthday and occasion reminders.

-   **Reserve with Google integration:** Live integration once approval
    is granted (application submitted during pre-build).

-   **Advanced reporting and analytics:** Real-time dashboards,
    revenue-per-cover analytics, peak time analysis, cancellation
    pattern analysis.

-   **Native mobile app:** iOS and Android apps for venue staff with
    push notifications for new bookings, cancellations, and deposit
    payments.

## 12.2 Phase 3 --- Market Expansion (Months 11 to 18)

-   **Multi-venue management:** Dashboard for restaurant groups managing
    multiple sites from one login.

-   **Loyalty and rewards:** Guest-facing loyalty programme integrated
    with the consumer booking experience.

-   **AI-powered demand forecasting:** Predict busy periods and no-show
    likelihood based on historical patterns, weather, local events.

-   **Data products:** Anonymised, aggregated industry benchmarks for NI
    hospitality (no-show rates by area, cuisine, day of week).

-   **Geographic expansion:** Expand beyond Northern Ireland to Republic
    of Ireland and other UK regions.

# 13. Future-Proofing Decisions

These are architectural and data model decisions made during the MVP
build that cost little or nothing to implement now but prevent
significant technical debt or painful migrations when later phases
arrive. Each one has been included because the cost of not doing it now
is disproportionately high relative to the effort required.

  -----------------------------------------------------------------------
  **Decision**           **Rationale**
  ---------------------- ------------------------------------------------
  **Global guest hash**  A global_guest_hash field on the Guests table,
                         computed from normalised email (preferred) or
                         phone number. Not used in the MVP. Not exposed
                         in any UI. When Phase 2 introduces the
                         consumer-facing experience, this hash enables
                         cross-venue guest unification without a data
                         migration. Effort: 10 minutes of schema work.

  **Communication        All messages routed through a channel service
  abstraction layer**    that accepts message type, recipient, and
                         payload, then routes to the correct provider.
                         SendGrid and Twilio are implementations behind
                         this interface. When WhatsApp arrives, it plugs
                         in as a third implementation without touching
                         business logic. Effort: approximately one day
                         during MVP build.

  **Events table**       Every booking-relevant action recorded as an
                         immutable event with timestamp, type, and
                         payload. Nightly materialised views for MVP
                         reporting are computed from this table. When
                         Phase 2 requires real-time analytics, the events
                         table is the foundation. Effort: approximately
                         half a day during MVP build.

  **API namespace        Routes namespaced as /api/venue/, /api/booking/,
  separation**           /api/webhooks/, and /api/consumer/ (reserved).
                         When the consumer app arrives in Phase 2, it has
                         a clean namespace without refactoring existing
                         routes. Effort: zero --- it is a naming
                         convention.

  **Codebase directory   Dashboard and booking page code in clearly
  separation**           separated directories with separate API routes.
                         Shared components in a shared library folder.
                         When Phase 2 requires separating these into
                         distinct deployments, the separation is already
                         done. Effort: zero --- it is a file organisation
                         convention.

  **JSONB schema         All JSONB config fields (booking_rules,
  validation**           deposit_config, opening_hours,
                         availability_config) have a defined JSON schema
                         validated on write. When Phase 2 requires
                         cross-venue queries, the data is clean and
                         consistently structured. Effort: approximately
                         two hours.

  **Cancellation policy  The cancellation policy in effect at the time of
  snapshot**             booking is stored on the booking record. When
                         venue-configurable cancellation windows arrive
                         in Phase 2, existing bookings are unaffected by
                         policy changes. Effort: one additional field per
                         booking.

  **Connection status    WebSocket connection status indicator and
  and polling fallback** 30-second polling fallback built into the
                         dashboard from day one. Prevents stale data
                         during service when WiFi conditions degrade.
                         Effort: approximately half a day.
  -----------------------------------------------------------------------

# 14. Glossary

  -----------------------------------------------------------------------
  **Term**               **Definition**
  ---------------------- ------------------------------------------------
  **Availability         The system that calculates which time slots or
  Engine**               sittings have available capacity for new
                         bookings. Accounts for slot model (fixed
                         interval or named sittings), max covers,
                         turn-time logic (if enabled), existing bookings,
                         and blocked dates/slots.

  **Booking Page**       A hosted, public-facing web page where guests
                         can view availability and make reservations
                         directly. Each venue gets a unique URL.

  **Channel Abstraction  An internal service that routes all guest
  Layer**                communications through a unified interface.
                         Individual providers (SendGrid, Twilio,
                         WhatsApp) are implementations behind this
                         interface, allowing new channels to be added
                         without changing business logic.

  **Confirm-or-Cancel    An SMS sent 24 hours before a reservation
  Prompt**               containing a link to a web page where the guest
                         can confirm attendance or cancel. Designed to
                         make cancellation frictionless and reduce
                         no-shows.

  **Day Sheet**          A single-screen view of all reservations for a
                         given day, designed to be used by front-of-house
                         staff during service. Shows times, guest names,
                         party sizes, dietary flags, and booking status.

  **Deposit Model (MVP:  In the MVP, guest deposits are charged directly
  Direct Charge)**       to the venue's connected Stripe account via
                         Stripe Connect direct charges. Reserve NI never
                         holds deposit funds. Refunds for eligible
                         cancellations are triggered by Reserve NI via
                         the Stripe API. A platform hold model is planned
                         for Phase 2.

  **Events Table**       An immutable log of every booking-relevant
                         action in the system. Used as the source of
                         truth for reporting and analytics. Each event
                         has a timestamp, type, booking ID, venue ID, and
                         payload.

  **Fixed Interval       A slot model where bookable times are generated
  Slots**                automatically at regular intervals (every 15 or
                         30 minutes) within the venue's opening hours.

  **Global Guest Hash**  A hash value computed from a guest's normalised
                         email or phone number, stored on the guest
                         record. Not used in the MVP but enables
                         cross-venue guest identification in Phase 2
                         without data migration.

  **iFrame Widget**      An embeddable booking interface that venues
                         place on their own website. Renders inside an
                         iFrame and communicates with the parent page via
                         postMessage.

  **Named Sittings**     A slot model where the venue defines specific
                         booking periods with start and end times (e.g.
                         'Early Bird 5--7pm', 'Main 7--9:30pm'). Guests
                         book into a sitting rather than a specific time.

  **No-Show Grace        The number of minutes after a reservation time
  Period**               that must elapse before staff can mark a booking
                         as a no-show. Configurable per venue. Default 15
                         minutes.

  **Platform Hold        A deposit architecture (planned for Phase 2)
  Model**                where Reserve NI collects deposits centrally and
                         holds them before releasing to venues. Provides
                         guaranteed refund reliability but requires legal
                         and FCA compliance review.

  **Reconciliation**     A daily automated check that compares Reserve
                         NI's internal booking and deposit state against
                         Stripe's records. Flags discrepancies for manual
                         review.

  **Row-Level Security   A Supabase/PostgreSQL feature that restricts
  (RLS)**                data access at the database level, ensuring
                         venues can only query their own data.

  **Stripe Connect**     Stripe's infrastructure for platforms that
                         process payments on behalf of third parties.
                         Reserve NI uses Stripe Connect with direct
                         charges to collect deposits from guests into
                         venue connected accounts.

  **Turn-Time Logic**    An optional availability feature where a booking
                         consumes capacity across multiple time slots
                         based on an expected sitting duration. Prevents
                         overbooking when tables from earlier sittings
                         are still occupied.

  **Linked Accounts**    **Shipped** for Appointments-family venues
                         (`light`, `plus`, `appointments`). Pairwise links
                         between independent subscriptions for shared
                         calendar visibility and agreed cross-venue
                         actions; optional venue collectives at
                         `/book/c/{slug}`. Data is never merged. See
                         section 3.10 and
                         `Docs/reserveni-linked-accounts-spec.md`.

  **Venue collective**   A combined public booking page (`/book/c/{slug}`)
                         joining two or more linked venues under shared
                         branding. Bookings still belong to one venue each.
  -----------------------------------------------------------------------

*End of Document*
