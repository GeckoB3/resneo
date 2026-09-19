# One setup flow for linking venues and starting a collective

Written and built 2026-09-19 on staging. Owner request: setting up a link and creating a collective
were two processes with two consent requests to the other venue. They become one guided flow on
`/dashboard/settings?tab=linked-accounts`, with one request to the other venue, one banner for that
venue to review it, and a banner for the host afterwards that walks it through putting services and
calendars on the combined page. New users must never have to hunt for a setting.

Companions: `reserveni-linked-accounts-spec.md` (links, §5 and §6), `collective-one-venue-plan.md`
and `collective-one-venue-ux-spec.md` (collectives on shared services, J1, J3, J4, J5). Nothing here
changes the engine, the permission model or any decision D1 to D56. It changes when the collective is
created, how the two consents are collected, and what each side is shown next.

## 1. What was wrong

- Two wizards, two consents. A host sent a link request, waited, then created a collective, then the
  other venue got a second invitation. Each step lived behind a button on the twelfth settings tab.
- The link request form showed two three-field permission editors. A new owner had to know that a
  collective needs "full calendar detail" and "create, edit and cancel" in both directions before
  the "Create venue collective" button would even enable.
- After the member joined, the host got an email and nothing on the dashboard. The next steps
  (offer services, choose calendars) were on the Services page and in the Collective area.

## 2. Decisions

| Id | Decision |
|---|---|
| L1 | One wizard, **Link with a venue**, replaces "Send link request" for new links. It asks for the venue, the level of link, and (at full access) whether to start a collective. The existing **Create a collective** dialog stays for venues that are already fully linked. |
| L2 | The level of link is three plain presets, mutual by default: **See each other's diaries** (full detail, no client details, read only), **Manage each other's bookings** (client details, edit existing), **Full access** (create, edit and cancel). "Customise" opens the per-direction editor that exists today. Only full access, both ways, with no calendar limits, unlocks the collective step (the gate `checkCombinedEligibility` already enforces). |
| L3 | The collective is **created when the request is sent**, exactly as the Create dialog creates it: host active, the other venue invited, page not live. The only difference is the mesh gate: the invitee is admitted on the strength of the *pending* link, which grants full access both ways. Nothing else about the collective's life changes. |
| L4 | The other venue gets **one** notice (email and bell) and **one** banner: "{host} wants to link with your venue and start {collective}". Reviewing it is one dialog that covers the link and, when a collective is proposed, everything the Join dialog covers today (what joining means, its services, its forms, the consent). One Accept does both; "Accept the link only" is offered on the same screen; Decline declines both. |
| L5 | Accepting is **two writes in order**: the link is accepted first, then the engine's join runs. If the join fails, the link stays accepted, the invitation stays open, the venue is told, and the collective row offers the join again. Nothing is half done silently. |
| L6 | If the recipient lowers what it grants below full access, it can still accept the link; the collective step is withdrawn from the dialog with the reason, and the invitation stays open for later. |
| L7 | A declined, cancelled or expired link closes the collective invitation that rode on it. If the collective then has nobody but the host, it is dissolved (`below_two`) so the host can start again. The host is told in the same notice. |
| L8 | The host is shown a dashboard banner, **Continue setting up {collective}**, while the collective has two active venues and no service with a calendar on the page. It opens the **Finish setting up** wizard: choose the services (the host's, pre-ticked when bookable online), then choose the calendars at every venue, then the page address and whether it is live. The same wizard opens from the collective's row. |
| L9 | Services are offered and calendars assigned in **two saves**, because a member's calendar cannot offer a service until its copy is applied (`COLLECTIVE_REPLICA_NOT_READY`). The wizard saves the offers, waits for the copies, then saves the calendars, and says which venue is still catching up. |
| L10 | A host with no services yet adds one inside the wizard (name, length, price) rather than being sent away to the Services page. |
| L11 | No migration. The invitation that belongs to a link request is the `venue_collective_members` row with `status = 'invited'` whose collective is hosted by the requesting venue. Both feeds derive it. |

## 3. The three flows

### 3.1 Sending (host or would-be partner): `LinkSetupWizard`

Steps: **Venue** (search by name or paste the booking address; a venue already linked says so and points at Create a collective) → **Level** (L2 presets, Customise) → **Collective?** (only at full access both ways: "Just link" or "Also start a collective", with what a collective is) → **Name and address** (the Create dialog's step 1) → **What changes** (the Create dialog's step 3, both venues named) → **Check and send** (venue, level in words, collective, note, what the other venue will read) → **Sent** (what happens next, in words).

The venue lookup returns, besides link eligibility, the venue's standing for a collective (timezone, currency, booking model, another collective, no appointments, plan), so the collective step is disabled with the reason before anything is sent.

One call: `POST /api/venue/account-links/setup { targetSlug, requestMessage?, grants, collective?: { name, slug } }`. It creates the pending link, then the collective with the invitation, then sends one notice. A refusal of the collective rolls back the link, so the wizard can show the reason on the step it belongs to.

### 3.2 Reviewing (the other venue): `ReviewLinkRequestDialog`

Opened from the banner (`?review={linkId}`) or the Received row. Steps: **The request** (who, the note, what each venue will be able to do, Adjust permissions) → when a collective is proposed: **The shared page** (the Join dialog's "what joining means", with both real addresses) → **Your services** → **Forms** (when any match) → **Check and accept** (summary and one consent line that covers the link and the collective). Footer: Decline (confirms), Accept the link only, Accept and join.

One call: `PATCH /api/venue/account-links/{id} { action: 'accept' | 'accept_with_changes', grants?, collective?: { collective_id, consent_version, same_name_choices, own_service_choices, form_choices } }`. The route accepts the link, then runs the join (L5), then sends the host one notice with the "continue setup" link.

The join preview (`GET /collectives/{id}/join?with_pending_link=1`) does not block on the mesh when a pending link between the two venues grants full access both ways, because the accept will make it so first.

### 3.3 Finishing (host): `CollectiveSetupWizard`

Opened from the banner (`?setup={collectiveId}`) or the host's collective row while the page is not live. Steps: **What is left** (who joined, the two steps) → **Services** (tick list of the host's services; add one inline; a member's asks appear as suggestions) → **Calendars** (one block per venue, tick boxes per calendar per service, "all" per venue; host calendars that already offer a service are pre-ticked) → **Done** (the address with Copy and Open, live or not live with the reason, links to design the page and the Collective area).

Calls: `POST /collectives/{id}/bulk` with `offer` ops, then with `assign` ops (L9); `POST /api/venue/appointment-services` for an inline service; the existing services and collectives reads.

## 4. Banners

`LinkedAccountBanner` reads `GET /api/venue/account-links/incoming`, which now carries:

- `incomingRequests[].collective: { id, name } | null` (L11), so the line names the collective;
- `collectiveSetup[]`: `{ collectiveId, name, memberNames }` for a host whose collective has two active venues and no service with a calendar (L8).

- `outgoingRequests[]`: the venue's own unanswered requests, each naming the collective sent with it, so the sender reads "Waiting for {venue} to review your link request and join {collective}. Once they accept, Continue setup appears here" (added 2026-09-19 after the owner's test run);
- `memberWaiting[]`: the collectives the venue has joined whose page is not live yet, so a member reads "{host} is setting up the services and the shared booking page, so nothing is needed from you yet".

The same two states show as a line on the collective's row in the Linked accounts tab (`la.row.host.waiting`, `la.row.member.waiting`) and on the sent request's row (`la.sent.collective`), and the review dialog ends on a receipt that says what happens next instead of closing (`respond.done.*`).

Dismissal stays local and 24 hours, as before.

## 5. Copy

New strings live in `collective-copy.ts` under `setup.*` (sender), `respond.*` (recipient),
`finish.*` (host) and `banner.*`, in the house style: plain, warm, second person, no em-dashes.
Existing `create.*` and `join.*` strings are reused where the screens are the same.

## 6. Files

- `src/lib/linked-accounts/link-levels.ts`: the presets and `levelForGrants`.
- `src/lib/linked-accounts/link-request.ts`: creating a pending link, factored from the route.
- `src/lib/linked-accounts/collective-create.ts`: creating a collective with invitations, factored from the route, with the mesh gate as an option.
- `src/lib/linked-accounts/collective-standing.ts`: one venue's standing for a collective, shared by the candidates list and the lookup.
- `src/lib/linked-accounts/proposed-collectives.ts`: the invitations that ride on link requests (L11) and the host's setup needs (L8).
- `src/lib/linked-accounts/link-setup.ts`: the one-call setup (L3).
- Routes: `account-links/setup` (new), `account-links/[id]` (accept with collective, reject and cancel cleanup), `account-links/incoming`, `account-links/lookup` (`&collective=1`), `account-links` (list carries `proposedCollectives`), `collectives/[id]/join` (`with_pending_link`), `cron/account-link-maintenance` (expiry cleanup).
- Components: `components/linked-accounts/setup/LinkSetupWizard.tsx`, `ReviewLinkRequestDialog.tsx`, `CollectiveSetupWizard.tsx`, `VenueSearchField.tsx`; `LinkedAccountBanner.tsx`; `LinkedAccountsSection.tsx` (wires the three, drops the two modals they replace); `VenueCollectivesPanel.tsx` (Continue setup, review-the-link on an invited row).

## 7. Tests

- `link-levels.test.ts`: every preset round-trips; a custom pair is `custom`.
- `proposed-collectives.test.ts`: the invitation that rides on a request; setup needs (no services, no calendars, live).
- `account-links/setup/route.test.ts`: link only; link and collective; collective refused rolls the link back; not full access refuses the collective.
- `account-links/[id]/route.test.ts`: accept with collective runs the join after the link; a join failure leaves the link accepted and says so; lowering below full access refuses the collective part.
- Component tests for the three dialogs: the steps, the disabled reasons, the calls made.

## 8. What did not change

The engine, the permission model, the Create and Join dialogs (still used), the Collective area, the
Services page. A venue that prefers the old two-step path can still send a link with any level and
create the collective later from Create a collective.
