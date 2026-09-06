# R26 web response (2026-09-06)

Reply to `C:\Resneo-app\Docs\R26_WEB_HANDOVER.md` (releasing a deferred guest email for a
linked booking), from the web repo on `staging`.

## The route now takes a linked booking

Done as asked, and nothing else changed. `POST /api/venue/bookings/[id]/guest-modification-notify`
loads the booking through `loadStaffAccessibleBooking(staff, id)`, refuses with the existing
messaging 403 unless `linkedGrantAllowsMutation(linkedGrant, isOwnVenue)`, and hands the
booking's `venue_id` (the owner venue) to `executeBookingModificationGuestNotification`, which
reads the booking, the modification policy, the guest and the venue's sender details by that
id. The shape is `resend-confirmation/route.ts`'s. The own-venue path is unchanged: the same
call with the caller's venue id, and no link lookup.

Confirmed before changing it: the route filtered on `staff.venue_id` and answered 404 for a
partner's booking, so on the web the follow-up bar's Notify button showed "Booking not found"
after a linked move and its countdown failed the same way silently
(`BookingModifyNotifyFollowUp.tsx` and the timer in `PractitionerCalendarView.tsx` both call
this route with no other fallback).

Statuses, for the app's handling:

| Case | Status | Body |
| --- | --- | --- |
| no staff row for the token | 401 | bare `{ "error": "Unauthorised" }`, as before |
| booking does not exist | 404 | `{ "error": "Booking not found" }` |
| booking on a venue the caller is not linked with | 403 | `{ "error": "You do not have access to this booking." }` |
| link scoped to specific calendars that exclude the booking's | 403 | `{ "error": "This link does not include that calendar." }` |
| link without an edit grant (`act: 'none'`) | 403 | `{ "error": "This link does not allow messaging guests on the other venue’s bookings." }` |
| own booking, or linked with `edit_existing` or `create_edit_cancel` | 200 | `{ ok: true, emailSent, smsSent, skipped, skippedReason? }`, unchanged |

No audit entry is written for the send: neither `message` nor `resend-confirmation` writes one,
and the move that deferred the message was already audited as `edited_booking` by the PATCH.
Say if the app wants one and it can follow the `recordBookingWriteAudit` pattern.

Files:

- `src/app/api/venue/bookings/[id]/guest-modification-notify/route.ts`
- `src/app/api/venue/bookings/[id]/guest-modification-notify/route.linked.test.ts` (new): the
  six cases above plus the own-venue path, asserting the executor receives the owner venue id
  and is never called on a refusal.
- `Docs/MOBILE_API.md`: a dated section, "Deferred guest notification for a linked booking
  (R26, 2026-09-06)".

## What to expect on the app side

A partner's move can now send `defer_modification_guest_notification: true` and offer Notify,
exactly as for an own booking; the 200 body is the one the app already formats for its own
bookings. `skip_booking_modification_guest_notification: true` keeps working, so the current
app build is unaffected until it flips the flag. No request field changed anywhere.

## Status

On the web `staging` working tree at the time of writing: the new route test (7 tests), the
bookings route suites and the follow-up bar tests (109 tests), the full typecheck and lint
pass; the commit follows once the owner has reviewed. Not exercised end to end against two
linked venues, because doing so sends a real guest message; the unit test pins the scoping and
the sender itself is untouched.

---

# R26 second ask: a partner's guest's Records (2026-09-06)

Reply to the "Second ask" section of `C:Resneo-appDocsR26_WEB_HANDOVER.md`.

## Done, with one deliberate difference on delete

All five routes now take `owner_venue_id`. The scoping lives in one place,
`src/lib/guests/linked-guest-access.ts`, so the five agree by construction:

| Gate | Applies to |
| --- | --- |
| link resolves, `calendar === 'full_details'` AND `grant.pii` | all five |
| plus `linkedGrantAllowsMutation` (edit grant) | sign, complete |
| plus `linkedGrantAllowsCancel` (FULL MANAGEMENT) | delete |

The difference from the ask: **delete needs the full management grant, not an edit grant.**
Every other destructive cross-venue action in the codebase uses `linkedGrantAllowsCancel`
(booking cancel at `bookings/[id]/route.ts:864`, booking delete at `:3097`, and the linked
calendar booking route), and destroying a file the owner venue holds is at least as final as
cancelling their booking. So an "Edit existing" partner can add a document and mark it
uploaded, but only a "Full management" partner can remove one. If the owner wants delete at
the edit level, it is a one-word change and I will make it on request.

The PII gate is also stated explicitly rather than implied: a `full_details` link that
withholds personal data shows a booking without guest identity, so it must not read that
person's files. That is the same rule the bookings list applies to guest history.

Everything else is as asked. The storage path and `guest_documents.venue_id` are the OWNER
venue's, so the file appears in their Records as one of their own. The contact audit event
is written against the owner venue, with `acting_venue_id` and `link_id` in the metadata.
A guest that does not belong to the resolved venue answers 404, not 403, so an unrelated
guest id cannot be probed.

Statuses the app will see on the five:

| Case | Status | Body |
| --- | --- | --- |
| no staff row | 401 | bare `{ "error": "Unauthorised" }` |
| no link, or link without full_details, or without PII | 403 | `You do not have access to that venue’s client records.` |
| sign or complete without an edit grant | 403 | `This link does not allow changing the other venue’s client records.` |
| delete without full management | 403 | `This link does not allow deleting the other venue’s client records.` |
| guest not on the resolved venue | 404 | `Guest not found` |
| allowed | 200 | response shapes unchanged |

`PATCH` on a document (rename and category) is the sixth handler on those paths and stays
own-venue only: it was not asked for and has no caller.

## The web now shows the card too

The handover framed the goal as the panel matching, so the web half is done as well rather
than left for later. The booking panel no longer hides Records on a linked booking
(`ExpandedBookingContent.tsx`): the card passes `ownerVenueId`, hides "Add documents or
photos" without an edit grant, and hides "Remove" without full management. When the link
does not share records at all, the routes 403 and the card shows that sentence, which is the
web's equivalent of the app's "held by {venue}" line.

Files:

- `src/lib/guests/linked-guest-access.ts` (new) and `linked-guest-access.test.ts` (new, 7 tests)
- the five route files under `src/app/api/venue/guests/[guestId]/documents/`
- `src/components/dashboard/contacts/ContactDocumentsSection.tsx`, `GuestRecordsSection.tsx`
- `src/app/dashboard/bookings/ExpandedBookingContent.tsx`

## The two you listed as minor

Neither is done, and neither needs an app change to stay correct. Customer notes and tags on
a partner's guest still write through `PATCH /api/venue/guests/[guestId]`, which is
own-venue only, so read only in the app is right. The list route still ignores
`owner_venue_id` alongside `group_booking_id`, so a partner's multi-service visit shows no
"other services" cards. Say if either is worth a round of its own.

## Status

On the web `staging` working tree: the new unit tests, the guests and contacts suites (45
tests), the full typecheck and lint all pass. Not exercised end to end against two linked
venues, because that needs a real cross-venue upload; the unit tests pin every gate.
