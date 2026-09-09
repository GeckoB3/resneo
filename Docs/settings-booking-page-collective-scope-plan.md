# Settings → Booking Page: manage the combined page from the Booking Page tab

Status: BUILT on staging 2026-09-09 (uncommitted at the time of writing). Written the same day
against the `staging` working tree (baseline `7807cf08` plus the day's uncommitted work). §8 records
the owner's decisions and the as-built shape; §3 is the design as approved.

## 1. What is being asked for

For a venue in a live venue collective, the **Booking Page** tab of Settings should open on the
**combined page's** settings by default, because that is the page the venue's guests actually
book on. A simple switch lets the user move between managing the combined page and this
venue's own page. The explanatory box at the top should say, briefly, that the venue is part of a
collective and shares a booking page with the other members, and then offer the switch. The
Linked accounts tab keeps its own "Manage combined page" entry; the two paths must stay in step.

## 2. Verified current behaviour

- **Booking Page tab** ([SettingsView.tsx](../src/app/dashboard/settings/SettingsView.tsx)
  around line 1581): when `collective` is set (the settings page loads it server-side with
  `findStaffCollectiveForVenue`, [page.tsx](../src/app/dashboard/settings/page.tsx) ~243), the tab
  renders `CombinedPageNotice` above the venue's own sections (URL & branding, widget & QR,
  booking page config…). The notice is two long paragraphs and two buttons: **Manage combined
  page** (hosts only; it sets `manageCollectiveId` and switches to the Linked accounts tab) and
  **Open Linked accounts**.
- **Manage combined page** lives in
  [CombinedPageManager.tsx](../src/components/linked-accounts/CombinedPageManager.tsx)
  (1,712 lines): a `Modal` with a footer ("Done" / "Save and close") and three internal tabs for
  a host, **Page** (address, headings, photos, branding), **Services & calendars** (offerings and
  provider calendars, staged and saved together), **Members**. A non-host member sees one
  paragraph ("your services appear… the host chooses which calendars…"). It needs a
  `CollectiveView` (from `GET /api/venue/collectives`) and `eligibleLinks` (the full-mutual
  links, computed in [LinkedAccountsSection.tsx](../src/app/dashboard/settings/sections/LinkedAccountsSection.tsx)
  from `/api/venue/account-links`), and calls `onChanged` after every write so the list and the
  sidebar's combined-page link refresh (`refreshLayout()`).
- **Entry today**: only from Linked accounts → Venue collectives list → **Manage combined page**
  (hosts) via [VenueCollectivesPanel.tsx](../src/components/linked-accounts/VenueCollectivesPanel.tsx)
  `manageTarget`, or via the Booking Page notice's button, which just performs the same
  tab switch and lets the panel open the modal once its list has loaded.
- **Tab URLs**: `?tab=<key>` is kept in the browser URL by `replaceWithTab` /
  `replaceSettingsTabInBrowserUrl` (history.replaceState, so `useSearchParams` does not react;
  see the collective-staff-booking memory).
- The collective note has `id`, `name`, `isHost`, `hostVenueName`, `adoptedThisVenue`.

## 3. Design

### 3.1 The tab gets a scope switch

At the top of the Booking Page tab, for a venue in a live collective only:

> **Venue collective**
> This venue is part of **Plus 1 Staging** and shares one booking page with the other members.
> Guests who book with you use the combined page; this venue's own page is separate.
>
> [ Combined page (Plus 1 Staging) ] [ This venue's own page ]

A two-segment control (`role="tablist"`, keyboard-navigable, styled like the manager's own
tabs). **Default: combined page.** The choice is carried in the URL as `?tab=booking-page&scope=own`
(`scope=combined` is the default and omitted), so a link and a refresh land on the same view and
the Linked accounts tab can deep-link to it. It is not remembered beyond the URL: the owner's
rule is that the Booking Page tab means the page guests book on.

When `adoptedThisVenue` is true the intro adds one sentence: "The combined page is served at
this venue's own address, so its settings are what guests see there."

### 3.2 Combined-page scope renders the manager inline

Extract the body of `CombinedPageManager` into `CombinedPageManagerPanel` (the internal
tablist, the three host tabs, the member paragraph, error line, pending-changes state and the
`saveAndClose` / `requestClose` logic minus the "close"), and make `CombinedPageManager` a thin
`Modal` wrapper around it, so Linked accounts is unchanged in behaviour and the two entry points
share one implementation. Inline, the footer becomes a sticky bar under the panel with the same
"Save calendar changes" button and the unsaved-changes count; there is no "Done" because there is
nothing to close. Leaving the tab (or switching scope) with staged calendar changes prompts
exactly as `requestClose` does today.

Data: a small hook `useCollectiveManagement(collectiveId)` in `src/lib/linked-accounts/`
loads `GET /api/venue/collectives` (picking the one collective) and `GET /api/venue/account-links`
(filtered with the existing `fullMutualLinks`), exposes `{ collective, eligibleLinks, loading,
error, refresh }`, and is used by the Booking Page tab; `VenueCollectivesPanel` keeps its own
loading (it lists every collective, including invitations) and simply passes what it has to the
modal as now. `onChanged` in the inline panel calls `refresh()` and `refreshLayout()`.

### 3.3 Members (non-hosts)

A member's combined scope is read-only, and says more than today's single paragraph:

- the collective's name, the host venue, and the combined page address with **Open combined
  page** and **Copy link**;
- which of this venue's calendars and services take part (read from the collective catalogue,
  `GET /api/venue/collectives/[id]/catalogue`, filtered to this venue's providers), with the
  sentence that their price, length and availability come from this venue's own Services
  settings;
- "The host chooses which calendars are offered. To stop taking part, leave the collective
  under Linked accounts." with a link to that tab.

Members are never shown host controls; the API already refuses them.

### 3.4 Own-page scope

Exactly today's content below the intro (URL & branding, widget, config…), with one line under
the switch: "These settings shape this venue's own booking page at /book/{slug}. Guests in the
collective do not use this page unless they are sent its address."

### 3.5 Linked accounts stays as it is

Its **Manage combined page** button still opens the modal. The Booking Page notice's old
"Manage combined page" and "Open Linked accounts" buttons go: the switch replaces the first, and
the member view links to Linked accounts where that is the right place (leave collective,
invitations). `manageCollectiveId` in `SettingsView` and `onManageCollectiveOpened` on the panel
become unused and are removed.

Anything else that today sends people to Linked accounts to edit the combined page (the
sidebar's combined-page entry, help articles) is repointed to `?tab=booking-page`.

## 4. Out of scope

- Changing who may manage (hosts only; members stay read-only).
- Any change to the combined page's public rendering or its APIs.
- Remembering the last scope per user.

## 5. Test plan

1. `CombinedPageManagerPanel` renders inline without a `Modal` and the existing manager tests (if
   any) keep passing against the wrapper; staged calendar changes and "Save" behave the same.
2. Booking Page tab: with a live collective the scope switch is present and **defaults to the
   combined page**; without one it is absent and the own-page content shows as today.
3. `?scope=own` opens on the venue's own page; switching updates the URL; a refresh keeps the
   scope.
4. Host: the three manager tabs render inline and a settings write triggers `refresh` and
   `refreshLayout`. Member: read-only view with the address and this venue's participating
   calendars, no host controls.
5. Switching scope with unsaved calendar changes prompts, and cancelling keeps the changes.
6. Linked accounts → Manage combined page still opens the modal and edits the same data.
7. Live: on plus1 (host of Plus 1 Staging) the Booking Page tab opens on the combined page
   manager; edit a heading there and see it on `/book/c/plus-1`; switch to the own page and see
   the URL & branding section; sign in as Light 3 (member) and see the read-only view.

## 6. Sequencing and effort

1. Extract the panel from the modal (mechanical, the bulk of the work: about half a day).
2. The scope switch, URL param, intro copy, member view, data hook (half a day).
3. Repoint entry points, help article ([booking page settings](../src/lib/help/articles/) and the
   linked-accounts article), README row, memory.

About one day including tests and the live check.

## 7. Questions for the owner (answered, see §8)

- Member view: is the read-only summary above enough, or should members see the full manager
  with controls disabled?
- Should the sidebar's combined-page link open the Booking Page tab (proposed) rather than the
  public page?

## 8. Decisions and what was built

Owner's decisions (2026-09-09): a read-only summary is enough for members, with an explanation
that their combined page is managed by the host; the sidebar's combined-page link keeps opening
the public page; and the combined page settings must show the page's URL with a copy button.

As built:

- [CombinedPageManager.tsx](../src/components/linked-accounts/CombinedPageManager.tsx):
  `CombinedPageManagerPanel` holds everything the modal used to (tabs, catalogue, staged calendar
  changes, settings, members, dissolve) and takes `inline`, `onPendingChange` and an optional
  `onClose`. Inline it renders the body plus a sticky **Save calendar changes** bar while changes
  are staged (no Done); as a modal it is unchanged. `CombinedPageManager` is now the thin `Modal`
  wrapper used by Linked accounts. `CombinedPageAddressRow` shows the full address in a read-only
  field with **Copy link** (clipboard, "Copied" for two seconds, a prompt fallback) and **Open**;
  it sits at the top of **Booking page address** on the Page tab. `CombinedPageMemberSummary` is
  the member view: who hosts the page, the address row, this venue's calendars on the page with
  the offerings each provides (from the catalogue, filtered to `myVenueId`), and a link to Linked
  accounts to leave. The modal shows the same summary to a member.
- [collective-public-url.ts](../src/lib/linked-accounts/collective-public-url.ts):
  `collectivePublicPath` / `collectivePublicUrl` (adopted member address or `/book/c/{slug}`),
  used by the page adapter and the address row.
  [full-mutual-links.ts](../src/lib/linked-accounts/full-mutual-links.ts) is the shared
  `fullMutualLinks` (moved out of the collectives panel).
  [use-collective-management.ts](../src/lib/linked-accounts/use-collective-management.ts) loads
  the one collective and the invitable links for the tab.
- [CombinedPageNotice.tsx](../src/app/dashboard/settings/sections/CombinedPageNotice.tsx):
  `CombinedPageScopeSwitch` (the intro plus a two-tab `role="tablist"`, arrow keys supported)
  replaces the old notice and its two buttons; `SettingsCollectiveNote` stays here.
  [CombinedPageScopeContent.tsx](../src/app/dashboard/settings/sections/CombinedPageScopeContent.tsx)
  is the combined scope: the host's panel inline or the member summary, with `router.refresh()`
  after writes so the sidebar link and the tab's note keep up.
- [SettingsView.tsx](../src/app/dashboard/settings/SettingsView.tsx): `bookingPageScope` state
  (combined by default when in a live collective), `initialBookingPageScope` from
  [page.tsx](../src/app/dashboard/settings/page.tsx) (`?scope=own`), the URL writer keeps
  `scope=own` only on the Booking Page tab, and both tab and scope switches ask before discarding
  staged calendar changes. `manageCollectiveId` and the panel's `onManageCollectiveOpened` are gone.
- Help: the linked-venues and public-booking-page articles describe the new entry point and the
  copy button.
- Tests: `collective-public-url.test.ts`, `CombinedPageManager.inline.test.tsx` (inline tabs, no
  Done, staged change → save bar → `set_providers`, address row and copy, adopted address, modal
  wrapper, member summary), `CombinedPageNotice.test.tsx`, `CombinedPageScopeContent.test.tsx`.

