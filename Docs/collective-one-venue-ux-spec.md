# Venue collectives as one venue: page-by-page specification

Status: PLAN, not implemented. Companion to `Docs/collective-one-venue-plan.md`, which defines the
requirements (R1 to R14), the decisions (D1 to D51) and the red-team findings (RT1-1 to RT1-17,
RT2-1 to RT2-28) this document refers to; read that first. Written 2026-09-13 against `staging` at
`c6020eb6`; line numbers are anchors at that commit plus the two commits the plan's header names (`818ed5a`, `973bd3e`), and the plan's "Reading the citations" note applies here too. Reviewed 2026-09-14 at `c0b5eb0`, which added the surfaces in §2 items 15 to 17 and the copy they need. It says exactly what a host, a member and a guest see and can do on every surface, with every string of copy. Where it says "open question", the matching decision in the plan is still to be taken.

## 1. Where each fact is edited

Rule for every row: one stored truth, one screen that edits it (or one shared dialog opened from two labelled doors), and every other surface shows the same value read-only with the owner named. "Host admin" = admin of the host venue; "member admin" = admin of a non-host venue; "staff" = non-admin linked to the calendar. Ids refer to the copy deck.

#### A. Service definition (host master; each member holds a locked copy)

| Fact | Edited in, while in a live collective | Who may edit | Host surfaces show | Member surfaces show | Guests and combined page show |
|---|---|---|---|---|---|
| Name, description | Host Services page, Edit service dialog (`AppointmentServicesView.tsx:1481-1639`, `AppointmentServiceFormFields.tsx:106-126`) | Host admins | Card title; `Collective` pill when offered | "From {host}" card; read-only View dialog (`svc.member.view.*`); same name in Calendar Availability | Same name on `/book/c/{slug}`, emails, diary, `service_name_snapshot` |
| Heading assigned to a service | Host Edit service, Category select (`AppointmentServiceFormFields.tsx:128-150`) | Host admins | Grouping | Grouped under the same heading, locked | Same heading |
| Heading names and order | Host Services, Categories tab (`ServiceCategoriesManager.tsx`) | Host admins | `Collective` pill on headings used by offered services | `From {host}` pill; Rename and Delete disabled (`cat.member.lockedTooltip`); reorder only changes member's own lists | Host names and order |
| Service order on the page | Host Services drag and arrows (`AppointmentServicesView.tsx:1114-1193`) | Host admins | Hint `svc.reorder.hint.host` | "From {host}" list follows host order, no drag handle | Host order |
| Length, buffer, processing periods, start-time grid, service schedule | Host Edit service | Host admins | Form | Locked in View dialog | Every calendar, unless a calendar value applies |
| Price; payment rule; deposit or no-show fee | Host Edit service, with commercial change ask (`svc.commercial.*`) | Host admins | Form; save summary | Locked; immediate email `N6` | Price per calendar; `public.price.from` when calendars differ |
| Options (variants) and their prices | Host Edit service (`AppointmentServiceFormFields.tsx:194-544`) | Host admins | Form | Locked | Same options on every calendar |
| Cancellation notice, advance window, min notice, same-day | Host Edit service (`AppointmentServiceFormFields.tsx:677-732`) | Host admins | Form | Locked | Same rules |
| Add-ons linked to a service | Host Edit service, Add-ons section (`AddonGroupsSection.tsx`) | Host admins | `svc.form.addons.reach` | Locked list | Same add-ons |
| Add-on group settings and options | Host Add-ons tab or inline group editor (`AddonsLibraryView.tsx`, `AddonGroupEditor.tsx`) | Host admins | `Collective` pill, `reach.library.addonGroup` | "From {host}" section, View only; hidden from pickers on member-only services | Same options |
| Forms required for a service | Host Edit service, `ComplianceRequirementsEditor`, or host Settings, Compliance, Requirements | Host admins | `svc.form.compliance.reach` | Locked rows `comp.req.member.replicaRow` | Forms asked on every calendar (owning venue's copy of the form) |
| Form content and versions | Host Settings, Compliance, Templates and types, `/dashboard/compliance-types/[id]/edit` | Host admins | `comp.editor.host.banner` | Managed form View only, `From {host}` pill | Same form |
| Forms for all bookings | Each venue's Settings, Compliance, Requirements, "All bookings" | That venue's admins | Host rows also reach members (`comp.req.host.allBookings`) | Member rows apply to its own services and on top of host services (`comp.req.member.allBookings`) | Both sets asked at the member |
| Location type | Host Edit service | Host admins | Form | Locked | Same |
| Online meeting link, joining information | Each venue on its own copy: host in Edit service (`svc.form.location.linkLabel`), member in View dialog | That venue's admins | Host value | Member value | Link of the booked calendar's venue |
| Colour | Host Edit service | Host admins | Form | Locked | Diary colour |
| Staff permission flags (`staff_may_customize_*`) | Host Edit service, "Optional overrides per calendar" (`AppointmentServiceFormFields.tsx:877-922`) | Host admins | `svc.form.staffMay.reach`; name and description flags disabled on offered services (open question) | Locked; decide what member staff and admins may set | n/a |
| Active (visible to guests) | Host card switch (`AppointmentServicesView.tsx:1426-1454`) or form toggle | Host admins | Ask `svc.deactivate.*` when offered | `Turned off by {host}`; no switch | Hidden everywhere |
| On the collective page | Host card switch `svc.card.onPageSwitch`, Add service checkbox, or Booking Page, Services, the Collective area's grid (item 15) | Host admins | `Collective` pill | New "From {host}" card, or moves to "No longer offered by {host}" | Appears once a calendar offers it |
| Delete service | Host Services (blocked while offered, `svc.delete.blocked.*`) | Host admins | Blocked dialog | Copies have no Delete | n/a |
| Service photo | Host Booking Page tab, Page, services photos (writes host service photo) | Host admins | Page editor | None; copies arrive on leave | Host photo for every calendar |

Server backstops for table A: a member write that changes a locked field returns 409 `COLLECTIVE_MANAGED_SERVICE`; managed add-on groups `COLLECTIVE_MANAGED_ADDON_GROUP`; managed forms `COLLECTIVE_MANAGED_COMPLIANCE_TYPE`; deleting an offered service `COLLECTIVE_OFFERED_SERVICE`. Member saves of calendars and the online link pass. The old catalogue route maps `create_item` to offer, `archive_item` to withdraw, heading actions to `COLLECTIVE_HEADINGS_FOLLOW_SERVICES`.

#### B. Calendars

| Fact | Edited in | Who may edit | Host surfaces show | Member surfaces show | Guests show |
|---|---|---|---|---|---|
| Host calendar offers a service | Host Edit service calendars; host Calendar Availability, Edit calendar; host staff "Offer on your calendars" | Host admins; host staff for own calendars | Ticks and pills | Not shown | Listed under the service |
| Member calendar offers a collective service (one record, two labelled doors) | Member Calendar Availability, Edit calendar, "From {host}" group; member View dialog; member staff card toggles; AND host Edit service, `CollectiveCalendarsSection` | Member admins and staff (own calendars); host admins | Tick under the member venue with `svc.cal.lastChanged` | Tick with `svc.cal.lastChanged`; `N11` when the host changed it | Listed straight away |
| Per-calendar values (length, buffer, price, deposit, colour; name and description only on services not on the page) | `CalendarServiceValuesDialog`, from the calendar row (host form, member View dialog) or "Edit your settings" (staff) | Calendar staff within flags; that venue's admins; host admins for any calendar | Value chips; "Compare values" table | Same chips; `N14` when the host changed one | That calendar's values |
| Calendar hours, breaks, closures, amended hours | Owning venue's Calendar Availability | Owning venue admins and linked staff | Diary only | Editable | Slots |
| Calendar name, active, delete, booking link segment | Owning venue's Calendar Availability (`BookableCalendarsPanel.tsx`) | Owning venue admins | Name updates in host form | Warnings `cal.edit.active.warn`, `cal.delete.collectiveLine` | Calendar leaves the page when inactive |

Stale calendar sets return 412 `STALE_RESOURCE` (`cal.stale.*`); the overrides route accepts all seven fields and admins.

#### C. Collective page, membership and venue settings

| Fact | Edited in | Who may edit | Host shows | Member shows | Guests show |
|---|---|---|---|---|---|
| Page name, address, branding, tabs, About, gallery, team bios | Host Booking Page tab, `{collective}` page scope, Page tab (`CombinedPageManager.tsx:713-726`) | Host admins | Editor | `CombinedPageMemberSummary` read-only | Page header |
| Header address, phone, website | Host Settings, Profile | Host admins | `reach.settings.hostProfile` | About section names host | Header; trader line shows the booked venue |
| Header opening hours | Host Settings, Business hours | Host admins | `reach.settings.hostHours` | Read-only | About tab |
| Any available, staff-first | Host Settings, Booking Settings (`FeatureFlagsSection.tsx`) | Host admins | `reach.settings.hostFlag` | none | Page behaviour |
| Guest sign-in requirement | Each venue's Booking Settings (`RequireAccountLoginSection.tsx`) | Each venue's admins | `reach.settings.hostFlag` | `reach.settings.memberLogin` | Asked if any venue requires it (open question) |
| Members: invite, cancel invite, remove | Host Booking Page, Members tab (`MembersSection`) | Host admins | Members list with health | Linked accounts row | Calendars appear or leave |
| Host transfer | Host Members, `bp.members.askToHost`; candidate accepts in Linked accounts | Host admin asks; candidate admin accepts | `la.row.hostMoveScheduled` | `N21`, row line | Header switches on the date |
| End the collective | Host Members, `dissolve.button` | Host admins | Row "Ended" | `N19`, review panel | Dissolved page |
| Leave | Member Linked accounts row | Member admins | `N16` | Review panel | Member's own page returns |
| Timezone | Locked while live (`VenueProfileSection.tsx:511-533`) | Nobody | `profile.timezone.locked` | Same | n/a |
| Currency | Not editable; must match at invite | Nobody | n/a | n/a | n/a |
| Stripe connection | Each venue's Settings, Payments | That venue's admins | Warnings in host form | `payments.member.note` | Calendars without card payments hidden online for paid services |
| Compliance records on or off | Each venue's Compliance, General; locked on while collective services ask for forms | That venue's admins | `comp.general.lockedHost` | `comp.general.lockedMember` | Forms asked |
| Own booking page settings | Each venue's Booking Page, "Your own page"; read-only while redirecting (`bp.own.redirecting.*`) | That venue's admins when showing | Status line | Status line | Redirect or own page |
| Embed and QR | Booking Page, Share and embed (`WidgetSection.tsx`) | Each venue's admins | Collective snippet `/embed/c/{slug}` | Same | Collective page |
| Clients, bookings, payments, compliance records, waitlist | Owning venue only | Owning venue | Partner bookings per D17 as amended by D41 (edit and cancel rights stand; typed client details do not apply inside a live collective) (`staff.detail.onlyOwner`) | Own | Owning venue's manage page |
| Communications templates, reminders | Each venue; owning venue's templates apply | That venue's admins | none | none | Differ by calendar's venue (open question) |
| Notification preferences | Each venue, `NotificationPrefsCard` | That venue's admins | Own | Own | n/a |

## 1.5 Where the collective lives: navigation

Added 2026-09-14, because the owner asked that the menus be as clear and sensible as possible, and because the first draft specified pages without saying how anyone reaches them.

**Today.** The sidebar is built from `BASE_NAV_ITEMS` (`DashboardSidebar.tsx:47-56`, assembled `:257-370`): an appointments admin sees Home, Appointments, Appointment Calendar, New Appointment, Contacts, Compliance, Services, Waitlist, Calendar Availability, Settings, then one or two external booking links (`:552-578`). Settings holds exactly twelve tabs (`SettingsView.tsx:110-172`), and collective work lives in tabs 4 and 12, the two ends of the strip.

Click counts today: create 5; invite 6 or 7 by two different routes to the same panel; edit the page 2; choose services 3 plus a tick each; leave 4. And **"is a member up to date" is not answerable in any bounded number of clicks**: the only signal is one badge per service per calendar inside the manager's Services and calendars tab (`CombinedPageManager.tsx:2221-2290`), up to sixty badges with no filter. A member admin has no sync signal at all.

**The judgement.** The case for leaving it in Settings is real: it is configuration rather than daily operation, most venues are in no collective and none is in more than one, a conditional sidebar entry makes the menu change shape under the user, and two clicks to the page editor is already a record worth protecting. The case against is that this redesign changes behaviour on **eight of the twelve settings tabs** and four sidebar destinations. A thing that changes the meaning of eight settings tabs is not a setting; it is a mode the whole dashboard is in, and a mode needs somewhere you can go and ask what it is doing. The bulk lane settles it: a table with a sticky selection bar, filters and search cannot live at depth four on a 343px content column, and nesting it there is how it quietly gets dropped.

**The split, by question rather than by object:**

| The user is asking | Where it lives | Why |
|---|---|---|
| "How does my booking page look, and what do guests see?" | **Settings, Booking Page** (unchanged) | Under D3 the collective page **is** the venue's booking page. Splitting the page guests see across two areas would be worse than today. The scope switch already frames the combined page and the own page as two views of one thing, which is the right model. Two clicks preserved exactly |
| "Who is in this, and is it working?" | A new top-level area, **Collective** | Health, the services-by-venue grid, the bulk lane, venues and invitations, history |
| "Which other venues share a diary with me?" | **Settings, Linked accounts** (unchanged) | Account links outlive collectives and are a different relationship |

**The sidebar entry.** Label `nav.collective` ("Collective"), fixed, with the collective's name on a second line so the label never moves while the name varies. Placed immediately after Services, because that is what it most changes. Shown to admins of a venue in a live collective, and to members as well as hosts: a member's shop front is now the collective page, so hiding the area from them would be the same mistake the sidebar already makes (below). Settings stays at twelve tabs.

**Tabs inside it.** Host: Overview, Services, Venues, History. Member: Overview, Services, History. The Services tab is the grid and bulk lane specified in item 16 below; Overview is the health strip and "what needs you"; Venues is membership, invitations and hosting; History is the audit trail with its own filters and export.

**Three sidebar defects to fix while in there**, all live today and none collective-specific in cause:

1. `DashboardSidebar.tsx:489-491` matches `/dashboard/calendar-availability` with `startsWith('/dashboard/calendar')`, so two nav items highlight at once on every appointments venue.
2. The sidebar hides "Your Booking Page" once two members are active (`collectives.ts:886`), but a member's own page only actually hands over when `solo_page_behavior = 'redirect'` (`catalogue.ts:634`), which defaults to `keep_live` and **has no UI anywhere**. So today's normal case is a live own page its owner can no longer find in the nav. D3 settles the behaviour; the nav has to follow it rather than pre-empt it.
3. `/dashboard/linked-calendar` has no inbound link at all; the control that looks like its door points at `/dashboard/calendar` (`LinkedAccountsSection.tsx:456-463`).

**Breadcrumbs and titles.** Every collective screen states whose thing is being edited in its `PageHeader`: the collective's name as the title on collective screens, the venue's name as an eyebrow on venue screens that a collective changes (Services, Calendar Availability). A host editing a service that is on the page must never have to infer which of the two they are changing.

## 2. Pages

### 0. Conventions on every page

**0.1 Badges** (`Pill`, `src/components/ui/dashboard/Pill.tsx`), one meaning each, in new `src/components/linked-accounts/collective/CollectivePills.tsx`:
- `CollectivePill`: brand, dot, `common.pill.collective`, sr-only `common.srOnly.collective`. Host only: offered services, and headings, add-on groups and forms they use.
- `FromHostPill`: info, lock icon (aria-hidden), `common.pill.fromHost`. Member only: copies, managed headings, groups, forms.
- `OnlyAtVenuePill`: neutral, `common.pill.onlyAt`. Both roles: services not on the page.
- `VenueSyncPill`: `Up to date` (success), `Updating` and `Setting up` (info, dot), `Could not update` (danger), `Hidden at {venue}` (warning), `Paused` (warning). Text always carries the state.

**0.2 Reach lines.** New `EditReachNote` renders fixed sentences from `src/lib/linked-accounts/collective-copy.ts` (the only home of these strings; unit test fails on U+2014 and unfilled placeholders). Rule: every control that writes a fact other venues see shows its reach line in the same visual group, and every dialog that saves such a fact repeats it as the dialog description. `formatVenueList`: "A", "A and B", "A, B and C", then "A, B and {n} more".

**0.3 Confirmations.** Extract `ConfirmContext`, `useAskConfirm` and `ConfirmDialog` from `CombinedPageManager.tsx:72-117` into `src/components/ui/confirm/AskConfirmProvider.tsx`, rendering the primitive `ConfirmDialog` (`src/components/ui/primitives/ConfirmDialog.tsx`: `message`, optional `body`, `destructive`). Mount in `AppointmentServicesView`, `AppointmentAvailabilitySettings`, `SettingsView`, `AddonsLibraryView`, `ImportHub`. Replace native confirms on touched surfaces: `AppointmentServiceFormFields.tsx:216-224`, `AddonsLibraryView.tsx:189`, `SettingsView.tsx:1166`, `AppointmentAvailabilitySettings.tsx:319, 923, 969, 1814`, `ComplianceFormBuilder.tsx:564`, `ImportHub.tsx:185, 206`; also the inline pending panel in `MembersSection` (`CombinedPageManager.tsx:1308-1329`) and `ConfirmModal` (`VenueCollectivesPanel.tsx:546-575`).

**0.4 Data.** `CollectiveContextProvider` in `src/app/dashboard/layout.tsx` (already loads `collectiveBookingLinks` at :188) supplies `{ collectiveId, name, slug, role, hostVenueName, venues[{id,name,isHost,status,sync}], pageLive, ownPageRedirecting, ownPageReason }` from the one live-collective resolver that also drives redirects, sidebar and email links. GET `/api/venue/appointment-services` adds `collective` per service and `collective_calendars` (host admins).

**0.5 Errors.** Codes are additive in `API_ERROR_CODES`, prose stays in `error`, shown inline (role="alert") in the dialog that caused them: `COLLECTIVE_MANAGED_SERVICE` (`svc.member.error.managed`), `COLLECTIVE_OFFERED_SERVICE` (`svc.delete.error409`), `COLLECTIVE_MANAGED_ADDON_GROUP` (`addons.error.managed`), `COLLECTIVE_MANAGED_COMPLIANCE_TYPE` (`comp.type.error.managed`), `COLLECTIVE_CONSENT_REQUIRED` (`join.error.consent`), `COLLECTIVE_SERVICE_UPDATING` (`staff.error.updating`; public `public.error.updating`), `COLLECTIVE_TIMEZONE_LOCKED` (`profile.timezone.error`), `COLLECTIVE_COMPLIANCE_REQUIRED` (`comp.general.error.locked`), `STALE_RESOURCE` at 412, reusing the existing code and status (`svc.stale.*`, `cal.stale.*`, app prose `cal.stale.apiProse`).

### 1. Services page, host admin (`/dashboard/appointment-services`, `AppointmentServicesView.tsx`)

**Banner.** Under `TabBar` (1047-1056), on all tabs, `CollectiveServicesBanner variant="host"` (SectionCard, brand tint like `CombinedPageScopeSwitch`): `svc.host.banner.title`, `svc.host.banner.body`, link `svc.host.banner.viewPage`. A venue behind: amber line `svc.host.banner.behind` + `svc.host.banner.retry` (POST `/api/venue/collectives/[id]/replicas/retry`). No member yet: body `svc.host.banner.invitedOnly`. Loading: one skeleton line. Not in a collective: no banner.

**Filter.** Segmented control `svc.filter.label`: `svc.filter.all` (default), `svc.filter.onPage`, `svc.filter.onlyHere`, kept in `?show=`. Other than All: reorder off, hint `svc.filter.reorderOff`.

**Card states** (SectionCard 1158-1466; header pills 1195-1218; actions 1419-1462):

| State | Header pills | Body extra | Actions |
|---|---|---|---|
| Not on the page | existing | none | Active switch; `svc.card.onPageSwitch` off; Edit; Delete |
| On the page, up to date | `CollectivePill` | calendar pills: own `{calendar}`, others `svc.card.calendarPillOther`, same style | Active; page switch on; Edit; Delete (blocked dialog) |
| A venue updating or setting up | + `svc.card.updatingAt` | polls every 5 s, up to 60 s | as above |
| A venue failed | + danger `svc.card.failedAt` | `svc.card.failedDetail` + Retry | as above |
| Hidden at a venue (no card payments, forms off, paused) | + warning `svc.card.hiddenAt` | reason from `svc.cal.warn.*` | as above |
| On the page, turned off | `CollectivePill` + Inactive | `svc.card.inactiveOffered` | as above |
| On the page, no calendar anywhere | `CollectivePill` | `svc.card.noCalendars` | as above |

**On the page switch** (new `role="switch"`, Active switch markup, host admins only; host staff see the pill). Off to on: ask `svc.offer.title`/`svc.offer.message`, body `svc.offer.body.calendars` + per venue `svc.offer.body.noStripe`, `svc.offer.body.formsOff`, confirm `svc.offer.confirm`. Pending: disabled, `aria-busy`. Done: `CollectiveSaveSummary` `svc.offer.done` + `svc.offer.chooseCalendars` (opens Edit service at calendars). On to off: ask `svc.withdraw.title`/`svc.withdraw.message`, body `svc.withdraw.body.host`, confirm `svc.withdraw.confirm` (destructive); done `svc.withdraw.done`. Error `svc.offer.error`.

**Active switch** (1426-1454), offered service: off asks `svc.deactivate.*` (destructive); on shows `svc.activate.done`.

**Delete** (1730-1764), offered: no request; `ConfirmDialog` `svc.delete.blocked.title`/`.message`, confirm `svc.delete.blocked.confirm` opens the withdraw ask. Server 409 shows `svc.delete.error409` in the alert slot (1759-1763).

**Reorder hint** (1114-1119): `svc.reorder.hint.host` while live.

**Add service.** Under the Active toggle (`AppointmentServiceFormFields.tsx:862-875`) unticked checkbox `svc.add.onPageCheckbox`, help `svc.add.onPageHelp`; after Create the offer ask runs.

**Add from another venue.** Secondary header button `svc.addFrom.button` (host admins, at least one member). Dialog `svc.addFrom.title`, help `svc.addFrom.help`, select `svc.addFrom.venueLabel`, radio list of that venue's own services (name, length, price), empty `svc.addFrom.empty`, note `svc.addFrom.adoptNote`, confirm `svc.addFrom.confirm`, done `svc.addFrom.done`; member gets `N26`.

**The editor becomes a page, not a dialog** (decided 2026-09-14). `AppointmentServiceFormFields` already holds about twenty blocks and twenty-four fields in one flat column (`:103`), inside a dialog capped at `max-w-4xl` (`AppointmentServicesView.tsx:1481-1639`). This design adds the heaviest section yet, a per-venue calendars list. Four reasons to move it to `/dashboard/appointment-services/[serviceId]`: it is already past the size a dialog can carry; the spec already needs `?service={id}` deep links, which a page gives for free; sub-editors (add-on group, compliance requirement, per-calendar values) currently stack dialogs on dialogs; and a page can have honest save semantics, where today Compliance writes immediately under a footer that says "Save Changes". Ten named sections, collapsed to summaries when untouched, with the seven `staff_may_customize_*` flags moved inside "Where it is sold" so the permission sits next to the thing it governs.

**One tint rule.** Exactly one visual treatment means "this reaches other businesses", used on every section that does and nowhere else. Today's proposal spreads per-venue failure across three places with three Retry buttons; all per-venue health moves to a single collective strip at the top of the page, which owns the only Retry.

**Why a diff, stated so it is never merged away.** A member calendar's assignment points at that venue's replica, not at the master, and the master's `practitioner_ids` may only name the host's own calendars (the server answers 400 for any other, `route.ts:1335-1339`). So member calendars need their own channel, and it carries intent (add, remove) rather than a picture, because the member edits the same rows from its own Calendar Availability page and a picture taken before that edit would undo it. The server resolves each entry to the replica at that venue through `collective_set_calendar_offering` (plan §6.7); it never merges member calendars into `practitioner_services` or `practitioner_ids`, which the app sends back as a whole set. (An earlier draft said a host's combined list would delete member assignments. It would not: the wholesale delete at `route.ts:1394` is scoped to the master's id, and member rows carry the replica's, so the two never meet. The diff is right for the reason above.)

**Five of the seven per-calendar chips cannot be true yet.** `calendar_service_assignments` holds only `custom_duration_minutes` and `custom_price_pence` (`20260430120000_unified_scheduling_engine.sql:114-121`) and the GET returns the other five as hard-coded null (`route.ts:680-684`). So `svc.cal.chip.*` and four columns of "Compare values" are specified against columns D5 has yet to build. Either the chips ship with D5 or this screen ships with two of them.

**The save moment, in four tiers**, so that "this reaches other businesses" is unmissable once rather than noise the host learns to dismiss: an ambient reach line in the editor; a live summary of what is dirty; a confirmation driven by the actual diff, raised only for commercial and form changes; and the D50 undo with a visible countdown. The undo must not live in the red error slot at the top of a scrolled list, which is where the first draft put the save summary.

**Card states, simplified.** The header currently reaches eleven objects. One state line per card, not three, and the two switches (Active, and On the page) must not be visually identical, because one of them retires the service at every member.

**Edit service, offered service** (the sections below apply to the page; anchors are the dialog they replace, `Dialog` 1481-1639):
- `description` = `reach.host.master` (not offered: `reach.host.ownOnly`). Footer left text `svc.form.footerReach`.
- Category help (146-148): `svc.form.categoryHelp.host`.
- Add-ons (`AddonGroupsSection.tsx:170-187`): `svc.form.addons.reach`; `AddonGroupEditor` opened here shows `addons.editor.reach` when the group is used on the page.
- Location, Online (807-841): `svc.form.location.linkLabel`, `svc.form.location.infoLabel`, help `svc.form.location.linkHelp`.
- Active toggle: `svc.form.active.reach`.
- Staff permissions (877-922): `svc.form.staffMay.reach`; Display name and Description disabled with `svc.form.staffMay.nameLocked` (pending decision).
- Calendars: `CollectiveCalendarsSection` replaces `calendarsSection` (1516-1616).
- Compliance (1628-1637): `svc.form.compliance.reach`; per member with its own all-bookings forms `svc.form.compliance.alsoAskedAt`.

**`CollectiveCalendarsSection`** (`src/components/linked-accounts/collective/CollectiveCalendarsSection.tsx`):
- Heading `svc.cal.heading`, help `svc.cal.help.collective`. One group per venue, host first (`svc.cal.venueYou`), members A to Z; group header h4 + `VenueSyncPill`; warnings when true: `svc.cal.warn.noStripe`, `.formsOff`, `.suspended`, `.settingUp`, `.failed` (+ Retry).
- Row identical for every venue: checkbox (label calendar name, `aria-label` "{calendar} at {venue}"), chips `svc.cal.chip.*`, `svc.cal.editValues` when saved as ticked and any permission is on, `svc.cal.lastChanged` (changes in last 30 days), markers `svc.cal.notSaved.add`/`.remove`.
- Lingering links: host as today (1564-1590); other venues `svc.cal.inactiveOther` + Remove link. Add calendar and Calendar availability link only in the host group (1525-1557). Empty member group `svc.cal.noCalendars`. Loading: two skeleton rows per group.
- Disclosure `svc.cal.compare`: table Calendar, Venue, Length, Buffer, Price, Deposit; blank cells `svc.cal.compare.standard`.

**Save flow, host admin.**
1. Existing client validation.
2. Offered and any of price, deposit or fee, payment rule, length, buffer, cancellation notice, options, add-on prices or lengths, forms changed: ask `svc.commercial.title`/`.message`; body lines `diff.row`, then `svc.commercial.bookingsKept`, `svc.commercial.membersTold`; if a permission was switched off while calendars hold values, heading `svc.commercial.clearValues.heading` + rows `.row`; confirm `svc.commercial.confirm`. Cancel returns to the form with edits.
3. PATCH carries `expected_updated_at` and `collective_calendars { add, remove }`.
4. 412 `STALE_RESOURCE`: ask `svc.stale.*`; confirm reloads the service.
5. 409 affected bookings: `ServiceRemovalBookingsDialog`; own groups unchanged; other-venue groups show `svc.removal.otherVenue.row` (no name, status or move select) and `svc.removal.otherVenue.note`; top line `svc.removal.collectiveLine`.
6. 200: dialog closes; `CollectiveSaveSummary` (aria-live) in the error slot (1075-1080): `svc.save.allDone`, `svc.save.pending` (polls up to 60 s), `svc.save.failed` + `svc.save.retry`, per calendar `svc.save.calendarFailed`.

**Empty.** Existing `EmptyState` (1085-1102) plus `svc.host.emptyCollective`.

### 2. Services page, host staff
Pills read-only. "Offer on your calendars" (1347-1378) unchanged plus `reach.staff.toggles` for offered services. `StaffServiceOverrideModal`: help (225-229) `override.help.collective`; "Venue default" hints (242, 266) become `override.standard`; Name and Description never render for offered services.

### 3. Services page, member admin
Subtitle `svc.member.subtitle`. Banner `CollectiveServicesBanner variant="member"`: `svc.member.banner.title`, `.body`, link `svc.member.banner.leave`.

Sections (h2 + count): (1) `svc.member.section.fromHost`, caption `.fromHostCaption`, grouped by host headings in host order, no drag; (2) `svc.member.section.retired` as closed `<details>`, caption `.retiredCaption`, hidden when empty; (3) `svc.member.section.own`, caption `.ownCaption`, today's full cards.

Copy card: `FromHostPill`, variants, compliance, `common.pill.turnedOffByHost` when inactive. No Active switch, no Delete (`DashboardEntityRowActions showDelete={false}`, new `editLabel` = `svc.member.card.view`). One body line, first match: `svc.member.card.settingUp`; `.updating`; `.failed`; `.noStripe` + `.connectStripe` (Settings, Payments); `.formsOff` + `.turnOn`; `.noCalendars` + `.chooseCalendars`.

Own card: `OnlyAtVenuePill`; action `svc.member.card.suggest` asks `svc.member.suggest.*`. Add service description `svc.member.add.help`.

**View dialog (copy), rewritten 2026-09-14.** The earlier version wrapped the whole service form in `<fieldset disabled>`. That is replaced, for a reason worth stating as a rule: **render a disabled form only when the artefact is itself a form.** A disabled form shows the controls for choosing a value rather than the value; disabled controls have no WCAG contrast floor, which contradicts this document's own accessibility bar; repeating `sectionLocked` down twelve sections breaks convention 0.2, which says the lock is explained once per group; and because the three editable fields cannot live inside a disabled fieldset, live and dead controls end up interleaved. (The rule also decides the compliance case: viewing a managed form uses `ComplianceFormRenderer`'s existing `preview` mode, because a form is a form; a disabled `ComplianceFormBuilder` is not.)

New `MemberServiceView`, in three zones, top to bottom:

1. **At a glance.** Title = the service name, `FromHostPill`, `ManagedServiceBanner` with `svc.member.view.lastUpdated` and a `VenueSyncPill`. A short summary strip: price, length, deposit, what the guest is asked for. This is what a member actually needs most days, and today it takes opening a form to find.
2. **Your settings**, a brand-tinted panel holding everything the member may change, so the editable surface is found in one place rather than hunted for among locked fields: which of their calendars offer it (`svc.member.view.calendarsHeading`, help `.calendarsHelp`), their per-calendar values (`svc.member.view.valuesHeading`, help `.valuesHelp`, rows with chips and `svc.cal.editValues`), their online meeting link and joining information (`svc.member.view.linkLabel`, `svc.form.location.infoLabel`), and `capacity_per_session`, which D40 makes venue-controlled and which the §1 table omitted.
3. **What {host} has set**, as definition-list blocks with humanised values, never disabled inputs: the service itself, options, add-ons, forms, when it can be booked, and where. Empty values are written out ("No deposit", "No forms") rather than shown as a dash, so nothing reads as missing data.

Footer `svc.member.view.close`, `svc.member.view.save` (enabled when changed). Retired copies add `svc.member.view.retiredNote`. PATCH sends only `online_meeting_url`, `online_meeting_info`, `capacity_per_session` and the calendar change as a diff: `expected_calendar_ids` (the rows as loaded) with `calendars { add, remove }`, so a stale save answers 412 `STALE_RESOURCE`, asks `svc.stale.*` and reloads the calendars only. Each calendar row shows `svc.cal.lastChanged` when {host} changed it in the last 30 days.

**A "What needs you" strip** at the top of the member's Services page mirrors the host's `ov.todo.*`: card payments not connected, forms switched off, a service on the page with none of their calendars chosen. Same shape both sides, so the two roles learn one pattern.

**Section order.** Retired moves from second to last, so a dead section never sits between two live ones.

Adoption review (`N26`, `?adopt={itemId}`): `svc.member.adopt.title`/`.message`, choices `.useMine` (opens `AdoptServiceReview`, J3) and `.keepSeparate`.

### 4. Services page, member staff
Copy cards read-only; "Offer on your calendars" and "Edit your settings" stay (flags from the copy) with `reach.staff.toggles`; override help `override.help.member`, hints `override.standard`.

### 5. Categories tab (`ServiceCategoriesManager.tsx`)
Host: description (313-315) `cat.host.description`; headings used on the page get `CollectivePill`; delete message (484-487) `cat.host.deleteOnPage` when relevant. Member: `cat.member.description`; managed headings `FromHostPill`, Rename and Delete disabled with tooltip and sr-only `cat.member.lockedTooltip`; reorder allowed.

### 6. Add-ons (`AddonsLibraryView.tsx`, `AddonGroupsSection.tsx`, `AddonGroupEditor.tsx`)
Host: cards (319-408) used on the page get `CollectivePill` and `reach.library.addonGroup`; delete asks `addons.delete.title`, `addons.delete.message` (archived: `addons.deleteInactive.message`), body `addons.delete.onPage`, confirm `addons.delete.confirm`. Member: sections `addons.member.section.fromHost`, `.own`; managed cards Edit becomes `addons.member.view` (editor read-only, `addons.member.lockedNote`), no Delete. Picker "Pick an existing add-on group" (`AddonGroupsSection.tsx:302-330`) on a member's own service omits managed groups and shows `addons.picker.hiddenNote`.

### 7. Compliance
- Templates and types (`ComplianceSettingsSection.tsx:59-196`): host rows used on the page `CollectivePill` + `comp.types.host.onPage`; member managed rows `FromHostPill`, Edit becomes `comp.types.member.view`, Archive hidden, Duplicate title `comp.types.member.duplicateHelp`; own form accepting host records `comp.types.member.acceptsRecords`.
- Type editor: host `comp.editor.host.banner`; member managed read-only `comp.editor.member.banner`.
- Requirements (`ServiceRequirementsPanel.tsx`): All bookings adds `comp.req.host.allBookings` or `comp.req.member.allBookings`; member copy rows read-only `comp.req.member.replicaRow`, no Add. `AddRequirementDialog` on member-only services omits managed forms.
- General (363-377): locked checkbox with `comp.general.lockedMember` or `comp.general.lockedHost`.

### 8. Calendar Availability (`AppointmentAvailabilitySettings.tsx`, `BookableCalendarsPanel.tsx`)
- Calendars header (`BookableCalendarsPanel.tsx:760-784`): `cal.header.host` or `cal.header.member`.
- Card Services chips (473-494) in labelled groups: host `cal.card.group.onPage`, `cal.card.group.onlyAt`; member `cal.card.group.fromHost`, `cal.card.group.onlyAt`.
- Booking link row (649-725), while redirecting: editor stays, preview and Copy use `/book/c/{slug}?calendar={segment}`, note `cal.link.redirectNote`.
- Remove calendar dialog (880-919): `cal.delete.collectiveLine`; host told (`N13`).
- Edit calendar dialog (1164-1365): under "Active (bookable)" (1216-1225) `cal.edit.active.warn`. "Appointment services" (1227-1252) grouped: host `cal.card.group.onPage` (help `cal.edit.services.groupOnPage.help`) then `cal.card.group.onlyAt` (help `.groupOnlyAt.help`); member `cal.card.group.fromHost` (help `reach.member.calendarTicks`) then `cal.card.group.onlyAt`. Inactive services end their group with `cal.edit.services.turnedOff`; retired copies only while ticked, `cal.edit.services.retired`, uncheckable; paid copies without Stripe `cal.edit.services.noStripe`.
- Save sends `expected_service_ids`, and four rules make that hold: the dialog's list comes from the venue's own services GET, which now carries `collective` per service, and `expected_service_ids` is the full set of that calendar's rows as loaded, retired and turned-off services included, never the visible checkboxes; the services PUT is sent only when the picker was changed, so a rename or an active toggle on its own never touches the services and never meets `cal.stale.*`, and a 412 for an untouched picker is refetched and retried once without asking; the server refuses ticking a retired copy (`cal.edit.services.retired` is a rule, not only a label) and refuses service ids that are not this venue's own; and the compare-and-write is one transaction on the server, not three round trips.
- Each service saved as ticked, where {host} has any per-calendar permission on, shows `cal.edit.services.editValues` ("Edit values"), which opens `CalendarServiceValuesDialog` for this calendar and service (item 9). Unsaved ticks show nothing until saved. The card's Services list shows the same value chips as `svc.cal.chip.*`. This is the fourth door to per-calendar values, and the only one where the calendar rather than the service is the subject.
- `svc.cal.lastChanged` appears under a ticked service in the "From {host}" group when {host} made the last change to that row in the last 30 days, so a member sees who chose this (D15). The same line appears in the member's service view.
- Staff: unchanged, and this is a decision rather than an omission. Non-admin staff choose services from the Services page card ("Offer on your calendars"), which saves through the same calendar-side route and tells {host} (N12); it has no "stop offering" ask, and it meets the same affected-bookings dialog.
- Adds: flash `cal.flash.added`/`addedMany`. Removals without bookings: ask `cal.stopOffering.*` (member adds `.hostTold`). With bookings: removal dialog with `svc.removal.collectiveLine`, no second ask. 409 stale: refetch, keep dialog, ask `cal.stale.*`.
- Staff: unchanged.

### 9. `CalendarServiceValuesDialog` (generalised `StaffServiceOverrideModal`)
From the host form row, member View dialog or "Edit your settings". Title `values.title`; description `reach.calendar.values`; host editing another venue adds `values.hostEditingMember`. One input per permission that is on, each with `values.standard` and `values.useStandard`. Footer `values.cancel`, `values.save`. Inline errors `values.error.cardHoldFloor`, `values.error.notOffered`. Admins are no longer refused.

### 10. Settings, Booking Page tab (`SettingsView.tsx:1629-1690`)

**Rewritten 2026-09-14.** The owner asked for this screen specifically: "professional, clear and well laid out". Today it is none of those, for reasons that are structural rather than cosmetic.

**It is three levels of tabs deep**: the Settings tab strip, then the scope tabs, then the manager's own tabs. And it has **five different save models on one screen**: 850ms autosave for branding, save-on-blur for the page name, save-on-change-with-a-full-reload for the address radios, a staged sticky bar for calendars, and immediate save-per-click for everything else. The house `SettingsSaveStrip` is already mounted on the same page and the collective path does not use it.

**The proposed shape: one column, seven sections, no nested tabs, two named save lanes.** Sections in order: Identity (name, logo, cover), Address, Look (branding, tabs, About, gallery), Who is on it (a read-only summary linking to the Collective area), Guests (what a guest is asked, sign-in, marketing), Share and embed, Danger (dissolve, or leave). A sticky preview rail sits alongside from `lg:` and collapses to a "Preview" button below. **Save lane one, "looks":** autosave, for anything cosmetic. **Save lane two, "consequences":** confirm-then-save, for anything a guest's booking depends on, including the address. Nothing on this screen saves silently if it changes what a guest can do.

**What should become the collective's own, rather than following the host.** The product already argues this against itself: the manager currently tells the host that the inherited opening hours "do not decide availability" and that a calendar elsewhere "can be open outside the hours shown here". Address, phone and opening hours should belong to the collective, because they are the collective's shop front and the host's are frequently wrong for it. Currency, timezone, wording and the two flow flags keep following the host. Deposit and cancellation terms following the host while the booking lands at a member is a promise the page cannot keep, and needs settling alongside D32.

**The member's view of this tab** is read-only, and it is where D3 is explained: which page guests reach, that it is the collective's, who hosts it, and what happens to their own address. `SettingsView.tsx:1643-1647` currently tells every venue on the own-page scope that collective guests do not use this page, which D3 makes false and which must be rewritten.

**Four defects to fix here**, logged as plan CB-47 to CB-50: D3 has no UI at all and defaults to off, so nothing is superseded today; the preview hard-codes address, phone, hours and currency to placeholder values while the live page fills them from the host, so the host previews a page guests never see; Share and embed is not rendered on the collective scope at all, and where the QR is reachable it prints the venue's name over the collective's address; and the collective's address can never be changed after creation while its name can, so the two drift apart permanently.

- Scope switch (`CombinedPageNotice.tsx:29-93`): description `bp.switch.host`/`bp.switch.member`; tabs `bp.switch.tab.combined`, `bp.switch.tab.own`; `OwnPageStatusLine` `bp.status.redirecting` or `bp.status.showing` + `bp.reason.*`. Leaving with unsaved changes asks `bp.leaveStaged.*` (replaces 1166).
- Host, collective scope (`CombinedPageScopeContent.tsx`): description `bp.combined.host.description`; manager tabs Page, Services, Members. Page: `HostInheritedSettingsNote` last paragraph (1216-1220) `bp.inherited.prices`; photos note `bp.page.photos`. Services: `HostCatalogue`, `VenueServicesPicker`, `ItemCard`, `CalendarAssignment`, `CalendarRow`, the link and unlink buttons, `CopySyncStatus` (1446-2340) and the sticky save bar (767-783) are removed. In their place a single card, `bp.services.card` ("Services and calendars are managed in the Collective area"), with a count line `bp.services.count` and a link `bp.services.open` to `/dashboard/collective?tab=services`. There is no second control here for putting a service on the page: that job belongs to the grid (item 15) and the Services page (item 1), and a third door would drift. Members: moved to the Collective area's Venues tab (§1.5). The Booking Page tab keeps a read-only count and a link.
- Own scope: remove note 1642-1647. Redirecting: SectionCard `bp.own.redirecting.title`/`.body`, `BookingPageSection` and `WidgetSection` in `<fieldset disabled>`. Showing: `bp.own.showing.body`, editable.
- Member, collective scope (`CombinedPageMemberSummary` 880-983): intro (935-939) `bp.memberSummary.intro`; `OwnPageStatusLine`; address row; calendars with `bp.memberSummary.hiddenReason.*`; empty (959-962) `bp.memberSummary.empty`; footer (973-979) `bp.memberSummary.leave`.
- Share and embed (`WidgetSection.tsx:204-235`), live: no target select; snippet frames `/embed/c/{slug}`; note `bp.widget.collectiveOnly`; QR encodes `/book/c/{slug}`, image label the collective name, file `resneo-qr-{slug}.png` (fixes 164-190).

### 11. Settings, Linked accounts (`VenueCollectivesPanel.tsx`)
- Header (125) `la.panel.description`; amber note (158-167) `la.create.eligibleNote`.
- `CreateCollectiveModal` (382-544): explainer (473-477) `la.create.explainer`; invite rows disabled with `la.create.ineligible.*`, warning `la.create.warn.noStripe`; toast `la.create.done`.
- `CollectiveRow` (247-380):

| State | Pills | Line | Actions |
|---|---|---|---|
| Invited | Member, Invitation pending | none | `la.row.invitation.review` (`JoinCollectiveDialog`), Decline (ask `decline.*`) |
| Setting up | Member, Setting up | `la.row.setup` | View page, `la.row.history`, Leave |
| Active member | Member, Active | `la.row.health.upToDate`/`.updating`/`.failed` | View page, History, Leave (`LeaveCollectiveDialog`) |
| Host | Host, Active | `la.row.hostHealth` | Manage combined page (Booking Page tab), History |
| Host move scheduled | + Hosting moving | `la.row.hostMoveScheduled` | host `transfer.cancel` |
| Hosting request | + Request | `la.row.hostRequest` | `transfer.review`, Decline |
| Paused | Paused | `la.row.paused` | `la.row.takeOver`, Leave |
| Left or ended | Left or Dissolved | `la.row.ended`; after dissolve toggle `la.row.listOnOldPage` (90 days) | none |

- `ReviewYourServicesPanel` after leave or removal, on this tab and the Services page, until dismissed (J7).
- `CollectiveHistoryDialog`: `history.title`, filter `history.filter.*`, rows "{time}: {sentence}" from `history.*`, actor `history.actorWithPerson`, empty `history.empty`, skeleton rows, `history.more`.
- `NotificationPrefsCard` (107-127): Collective group `prefs.collective.digest`, `prefs.collective.calendars` (default on) and `prefs.collective.required`.

### 12. Other surfaces
- Profile (`VenueProfileSection.tsx:511-533`): timezone disabled with `profile.timezone.locked`; host contact fields `reach.settings.hostProfile`.
- Business hours (`OpeningHoursSection.tsx:123-127`): host `reach.settings.hostHours`.
- Booking Settings: host Any available and Staff-first rows (`FeatureFlagsSection.tsx`) `reach.settings.hostFlag`; sign-in (`RequireAccountLoginSection.tsx`) `reach.settings.memberLogin` or `reach.settings.hostFlag`.
- Payments (`StripeConnectSection.tsx`): `payments.member.note`.
- Delete venue (`DeleteVenueSection.tsx:86-127`): `delete.host` or `delete.member`.
- Import (`ImportHub.tsx:180-197`): Undo asks `import.undo.*`; result `import.undo.kept`; failures inline, not `alert`.
- Booked revenue (`BookedRevenueSection.tsx:356-365`): footnote `reports.priceNote`.
- Sidebar (`DashboardSidebar.tsx:552-578`): "Your Booking Page" only while the own page shows, which under D3 means only when the collective page is not live for this venue; the collective entry is `nav.collective` (§1.5), not a second booking-page link. Fix the active-state defect at `:489-491` in the same change.

### 13. Diary and staff booking
- Partner columns in the collective (`PractitionerCalendarView.tsx:7587-7599`): "Linked · {venue}" becomes `diary.column.venue` in own-column slate style, title `diary.column.title`.
- Routing (graft 5, open question 1): own columns open the own form (server leaves own calendars out of `staff-collective` `calendar_ids`; `collectiveTargetFor` 3232-3240); partner columns, New and Walk-in open the collective form; `LinkedCalendarView.tsx:863` opens the collective form for partners.
- Heading (`StaffSurfaceBookingModal.tsx:79`): `staff.modal.heading.collective`. Own form member-only services tagged `staff.service.onlyAt`. Collective calendar picker secondary line `public.calendar.venue`.
- Contacts (`DetailsStep.tsx:459`, `StaffGuestContactFields`), rewritten for D41: inside a live collective the picker searches every active member venue, shows the owning venue on each result (`staff.contact.ownerLine`), and books against the record that already exists; it never clears a picked contact and never asks for details to be typed. Outside a live collective the earlier rule applies: a calendar at another venue clears any picked contact and shows `staff.contact.otherVenue`, and search reaches a partner only where the link shares client details.
- Deposit toggle at a venue without card payments: disabled, `staff.deposit.noStripe`. Groups limited to the first person's venue, `staff.group.sameVenue`. Copy behind: `staff.error.updating`, times refresh.
- Partner booking detail: `staff.detail.bookedWith`; edit and cancel per D17, else `staff.detail.onlyOwner`.

### 14. Public pages
- `/book/c/{slug}` (`collective-page-view.tsx`, `BookPublicLayout`): `public.price.from` when prices differ; "Who would you like to see?" (`AppointmentBookingFlow.tsx:4369`) shows `public.calendar.venue` under every calendar; `DetailsStep` (674-681) shows `public.trader` above consents, marketing label `public.marketing.collective`, unticked; payment step `public.payment.payee`; `ConfirmationStep` `public.confirmation.through`; Any available with inline forms `public.forms.anyAvailable` (forms collected once the calendar is fixed); groups `public.group.sameVenue`; refusal while a copy updates `public.error.updating`, back to times. Not live, paused or lapsed: existing `CollectiveUnavailable` (98-103).
- `/book/{venue}` and `/book/{venue}/{calendar}` (`src/app/book/[venue-slug]/page.tsx:13-32`, `[practitioner-slug]/page.tsx:29-47`): 307 to `/book/c/{slug}` only when the page is live, all that venue's copies have converged and one of its calendars is listed; query kept, `service_id` translated to the offering, calendar segment to `?calendar=`. A member-only `service_id` shows `MemberOnlyServiceInterstitial`: `public.interstitial.title`, `.body` or `.noPhone`, button `.cta`.
- `/embed/{venue}` renders the collective embed in place under the same conditions; new `/embed/c/{slug}` mirrors `EmbedBookingClient` with `frame-ancestors *` and height messages.
- Old `/book/c/{slug}` after dissolve, 90 days: `DissolvedCollectivePage`: `public.dissolved.title`, `.body`, per listed venue `.book`, `.none`, `.existing`.
- Guest manage page (`GuestBookingDetailView.tsx:607`): `guest.bookedThrough`. Existing bookings on retired services or calendars that stopped offering the service can still be moved online on the same calendar.
- Emails: confirmation (`booking-confirmation.ts:114-119`, which covers the text branch; the HTML preamble at `:87-90` needs the same line) adds `email.confirm.through`; Book again (`venue-booking-page-link.ts:17-29`) uses the live resolver, and for member-only services `email.bookAgain.call`; waitlist offers (`notify-appointment-waitlist-offer.ts:80-83`) translate the same way.

### 15. The Collective area (new, `/dashboard/collective`)

Added by the second pass. Items 1 to 14 make **one service** feel like one venue, and do it well. They do not give the host a place to **run** the collective: after the fold its state is spread across the Services banner, each service's calendars section, three manager tabs on the twelfth settings tab, one sentence on a Linked accounts row and a history dialog behind it. A host of four venues cannot answer "which venue is the problem and what is wrong with it" without opening services one at a time. This page is that answer, and it is also where the bulk lane lives, without which the fold makes setup slower than the manager it replaces.

**Where it lives.** Its own top-level sidebar entry, per §1.5: label `nav.collective` fixed, the collective's name on a second line, placed after Services, shown to admins of any venue in a live collective, members included. Tabs: Overview, Services, Venues, History for a host; Overview, Services, History for a member. Page design stays in Settings, Booking Page, because under D3 the collective page **is** the venue's booking page and splitting it across two areas would be worse than today.

**Header.** `ov.title` (the collective's name), `ov.subtitle`, address with Copy link and Open.

**Health strip**, one card per venue, host first: venue name, role pill, `VenueSyncPill`, and a line, first match only: `ov.venue.upToDate`, `ov.venue.updating`, `ov.venue.settingUp`, `ov.venue.failed` (+ Retry, and `ov.venue.failedDetail`), `ov.venue.hidden` + reason from `svc.cal.warn.*`, `ov.venue.paused`, `ov.venue.lapsed`. Each card shows `ov.venue.counts` ("{n} services, {m} calendars on the page") and links to that venue's rows in the table below. A venue at its plan's calendar cap shows `ov.venue.calendarLimit`.

**What needs you.** A short list, hidden when empty, of only the things the host can act on: `ov.todo.noCalendars` (a service on the page that no calendar offers), `ov.todo.newVenue` (a member joined and its calendars are not chosen on {n} services), `ov.todo.failed`, `ov.todo.noStripe`, `ov.todo.formsOff`. Each row has one button that goes straight to the fix.

**The Services tab: a grid, not a list.** This is the owner's "page for adjusting services offered", and at realistic scale it has to be a matrix. Staging today is 21 services across 4 calendars, but the design target is 40 services across 5 venues: 200 cells, and 1,000 to 1,200 service-and-calendar pairs underneath them. That number settles two things.

**Columns are venues, not calendars.** Five columns fit; forty do not. Each cell summarises that venue's calendars for that service in three states (all, some, none) and opens a popover to edit them, which is `CollectiveCalendarsSection` scoped to one venue group. Rows are services in the host's own order, grouped by heading.

**Why a matrix rather than a list.** Only at this scale does the argument bite, and it is worth recording so nobody simplifies it back. The host's real questions are column questions: "is Riverside carrying everything?", "which services has nobody picked up?". A list answers those only by opening forty rows. Divergence between venues is the defect this whole project exists to remove, and a matrix renders divergence directly while a list hides it. And a bulk lane needs a rectangle: a list can express "these rows" but not "these rows at these venues".

**Selection and bulk actions.** Select whole rows, whole columns, or both; actions apply where they cross. `ov.bulk.selected` in a sticky bar, with `ov.bulk.offer`, `ov.bulk.withdraw`, `ov.bulk.addCalendars` (with `ov.bulk.addCalendars.all` per venue), `ov.bulk.removeCalendars` and `ov.bulk.retry`. Changes stage rather than apply, so the confirmation can list exactly what changes and at which venues (`ov.bulk.confirm.*`), and one save reports per-venue results. **Cells that fail stay staged and stay selected**, so Retry re-sends only those.

Two server changes are prerequisites, not polish, and both are logged as plan CB-44 and CB-45: the `ops` array is capped at 200 while a full setup is 800 to 1,600 operations, so the client must chunk; and `set_providers` currently skips failed operations and returns success unless every one failed, so "one save reports per-venue results" is unimplementable until it returns a per-operation envelope. The structured per-op error already exists; only the envelope is missing.

**Division of labour, stated once so the two screens never drift.** The grid owns *which* services are on the page and *which calendars at which venues* offer them, in bulk, across everything. The Services page edit screen owns *what a service is*: its name, price, length, options, add-ons, forms and the rest, one service at a time, with its own per-venue calendar section for the single-service case. Neither duplicates the other's job. Item 10's read-only `CollectiveServicesOverview` and its the Collective area's grid (item 15) button are **removed**, because they would be a third control for "put a service on the page"; a card linking here replaces them.

**Preview before you push.** Next to the bulk bar and inside `svc.commercial.*`, `ov.preview.button` opens `ov.preview.title`: a read-only render of what each venue's guests will see afterwards, per venue, including any that would disappear from the page and why (`ov.preview.willHide`). This is the host-side preview items 1 to 11 never provide: today the only previews belong to the member, at accept.

**Recent activity.** The last 20 rows of `CollectiveHistoryDialog`, inline rather than behind a dialog, with a "See all" link. The full history gains two filters the dialog lacks, by venue (`history.filter.venue`) and by date range, and an export (`history.export`), because this is the record a host and a member would use to settle a disagreement about who changed what.

**Empty and first-run.** Before two venues are active: `ov.notLive.title`, `ov.notLive.body`, and a checklist of what is still needed (`ov.notLive.step.*`: invite a venue, they accept, put services on the page, choose calendars). While the page is paused: `ov.paused.*`.

**Undo.** Every host save that reached members shows `ov.undo.offer` in the save summary for 60 seconds ("Put it back"), which restores the master's previous values from the audit trail's before-image and re-applies. After that window the change is history-only. The concept is already accepted in the plan for migration rollback (D30), and a host who mis-types a price and fires a notice to every member currently has no way back at all. See D50.

### 16. Reports (host and member)

- **Booked revenue** (`BookedRevenueSection.tsx`). While in a collective, the figure is broken down: `reports.collective.heading`, one row per venue with its own subtotal, then the total, and a switch `reports.collective.scope` between "The collective" and "{venue} only". Within each, collective-page bookings are separated from the venue's own-page bookings (`reports.collective.viaPage`, `reports.collective.viaOwn`). Footnote `reports.priceNote` explains that figures use the price each booking was made at.
- **What a member sees**, per D49 (mutual visibility, named and consented). Its own venue by default, its collective bookings identified, and every other member's figures too, each named and subtotalled, never blended. The existing "shared with you through a linked account" wording is replaced by `reports.collective.sharedNote`, which names the venues. The join dialog recorded agreement to this (J3), and the figures view never carries another venue's guest contact details.
- **Exports.** Every booking export gains a column saying whether the booking came through the collective and, for the host, which venue it belongs to. No guest contact details cross a venue boundary in a host-scope export.

### 17. Venue chooser: not built

Specified in an earlier draft, then removed by D38 on 2026-09-14. The owner chose to refuse the invite rather than build a switcher, so a person who already works at another venue cannot be invited and is told to use a different email address. What remains is the refusal copy `staff.invite.otherVenue`, and one new string for anyone already in the broken state: `shell.venue.locked`, "This account is linked to more than one venue, so we cannot tell which one to open. Please contact support and we will sort it out." The silent redirect into the signup flow is still a bug to fix (plan SB-28, PB-16); it is the message that changes, not the fact that it needs one.

### 18. Platform support console (ResNeo staff only)

Not part of the product, but part of running it. The platform area already exists (`src/app/api/platform/*`, superuser auth, its own audit trail) and has no collective view, so a support person asked why a host's price has not reached a member has nothing to answer with. Plan §6.16 defines what it shows. In UI terms: one collective per row, expandable to the member health strip and the link table, with `support.retry` as the only action, and no guest contact details anywhere on it.

## 3. Copy deck

Placeholders in {braces}; `{venueList}` uses `formatVenueList`. Singular shown; plurals follow the pattern. New strings live in `src/lib/linked-accounts/collective-copy.ts`; edits to existing literals change in place. Headings say where strings appear. No em-dashes anywhere.

**Badges (CollectivePills.tsx)**
- `common.pill.collective`: Collective
- `common.srOnly.collective`: On the {collective} page
- `common.pill.fromHost`: From {host}
- `common.pill.onlyAt`: Only at {venue}
- `common.pill.retired`: Retired
- `common.pill.settingUp`: Setting up
- `common.pill.updating`: Updating
- `common.pill.upToDate`: Up to date
- `common.pill.couldNotUpdate`: Could not update
- `common.pill.paused`: Paused
- `common.pill.turnedOffByHost`: Turned off by {host}

**Reach lines (EditReachNote)**
- `reach.host.master`: This service is on the {collective} page. Saving updates it at {venueList}.
- `reach.host.ownOnly`: This service is only at {venue}. It is not on the {collective} page.
- `reach.member.replica`: {host} manages this service for {collective}. You choose which of your calendars offer it. For anything else, ask {host}.
- `reach.member.ownOnly`: This service is only at {venue}. Clients cannot book it online while you are part of {collective}. Your team can still book it.
- `reach.calendar.values`: These values apply to {calendar} at {venue} only, wherever it is booked.
- `reach.member.calendarTicks`: Ticking a service adds this calendar to it on the {collective} page. Unticking takes it off.
- `reach.staff.toggles`: Your choice updates the {collective} page straight away.
- `reach.library.addonGroup`: Used by {count} services on the {collective} page. Changes here reach {venueList} straight away.
- `reach.settings.hostProfile`: Also shown on the {collective} page.
- `reach.settings.hostHours`: Also shown on the {collective} page, as information for guests. Each calendar's own hours decide what can be booked.
- `reach.settings.hostFlag`: The {collective} page follows this setting too.
- `reach.settings.memberLogin`: If you turn this on, guests booking any calendar on the {collective} page are asked to sign in too.

**Services page, host (AppointmentServicesView.tsx)**
- `svc.host.banner.title`: You host {collective}
- `svc.host.banner.body`: Services marked Collective are on the {collective} page. When you save one, the change reaches {venueList}. Other services are only at {venue}: clients cannot book them online while {collective} is live, but your team can.
- `svc.host.banner.invitedOnly`: You host {collective}. When venues accept your invitation, the services you put on the page are set up in their accounts.
- `svc.host.banner.viewPage`: View the {collective} page
- `svc.host.banner.behind`: {venue} has not received your latest changes yet.
- `svc.host.banner.retry`: Retry
- `svc.host.emptyCollective`: Services you add can be put on the {collective} page.
- `svc.filter.label`: Show
- `svc.filter.all`: All services
- `svc.filter.onPage`: same as `common.srOnly.collective`
- `svc.filter.onlyHere`: same as `common.pill.onlyAt`
- `svc.filter.reorderOff`: Show all services to change their order.
- `svc.card.onPageSwitch`: same as `common.srOnly.collective`
- `svc.card.updatingAt`: Updating at {venue}
- `svc.card.failedAt`: Could not update at {venue}
- `svc.card.failedDetail`: {venue}: {reason}
- `svc.card.hiddenAt`: Hidden at {venue}
- `svc.card.inactiveOffered`: Turned off, so it is hidden on the {collective} page and at {venueList}.
- `svc.card.noCalendars`: No calendars offer this yet, so guests cannot book it.
- `svc.card.calendarPillOther`: {calendar} · {venue}
- `svc.offer.title`: Add {service} to the {collective} page?
- `svc.offer.message`: {service} is set up at {venueList} with your settings, and you control it for every venue.
- `svc.offer.body.calendars`: Their calendars do not offer it until you or they choose calendars.
- `svc.offer.body.noStripe`: {venue} cannot take card payments yet, so guests cannot book its calendars for {service} online. Its team can still book it.
- `svc.offer.body.formsOff`: {venue} has forms switched off, so its calendars are hidden for {service} until it turns them on.
- `svc.offer.confirm`: Add to the page
- `svc.offer.done`: Added to the {collective} page and set up at {venueList}.
- `svc.offer.chooseCalendars`: Choose calendars
- `svc.offer.error`: Could not add {service} to the {collective} page. Please try again.
- `svc.withdraw.title`: Take {service} off the {collective} page?
- `svc.withdraw.message`: Guests will no longer see {service} on the {collective} page. At {venueList} it becomes a retired service and their calendars stop offering it. Bookings already made are not changed.
- `svc.withdraw.body.host`: At {venue} it stays in your services, bookable by your team.
- `svc.withdraw.confirm`: Take off the page
- `svc.withdraw.done`: Taken off the {collective} page.
- `svc.deactivate.title`: Turn off {service} everywhere?
- `svc.deactivate.message`: {service} stops taking new bookings on the {collective} page and at every venue in it. Bookings already made are not changed.
- `svc.deactivate.confirm`: Turn off everywhere
- `svc.activate.done`: {service} is on again at every venue in {collective}.
- `svc.delete.blocked.title`: Take {service} off the {collective} page first
- `svc.delete.blocked.message`: {service} is on the {collective} page and set up at {venueList}. Take it off the page, then you can delete it.
- `svc.delete.blocked.confirm`: Take it off the page
- `svc.delete.error409`: Take this service off the {collective} page before deleting it.
- `svc.reorder.hint.host`: Drag the handle (or use the arrows) to set the order services appear in on the {collective} page and in the staff booking flow.
- `svc.add.onPageCheckbox`: Show on the {collective} page
- `svc.add.onPageHelp`: Sets it up at {venueList} too, with your settings. You can choose their calendars after saving.
- `svc.addFrom.button`: Add from another venue
- `svc.addFrom.title`: Add a service from another venue
- `svc.addFrom.help`: Choose a service that only one venue has. It is copied into your services, put on the {collective} page and set up at every venue. You control it from then on.
- `svc.addFrom.venueLabel`: Venue
- `svc.addFrom.empty`: {venue} has no services of its own to add.
- `svc.addFrom.adoptNote`: {venue} is asked whether to use its own {service} for this. If it does, its calendars and bookings for it stay as they are.
- `svc.addFrom.confirm`: Copy and add to the page
- `svc.addFrom.done`: {service} is on the {collective} page. We have asked {venue} whether to use its own {service} for it.

**Edit service dialog, offered service (AppointmentServiceFormFields.tsx, AddonGroupEditor.tsx)**
- `svc.form.categoryHelp.host`: The heading this service is listed under on the {collective} page. Manage headings on the Categories tab.
- `svc.form.staffMay.reach`: These apply to every calendar that offers this service, including calendars at {venueList}.
- `svc.form.staffMay.nameLocked`: Not available for services on the {collective} page, so guests see the same name and description on every calendar.
- `svc.form.addons.reach`: Add-on groups are shared. Editing a group here changes it for every service that uses it, including at {venueList}.
- `addons.editor.reach`: Used by {count} services, {onPageCount} of them on the {collective} page. Saving updates it at {venueList} straight away.
- `svc.form.location.linkLabel`: Link for your calendars
- `svc.form.location.infoLabel`: Joining information for your clients
- `svc.form.location.linkHelp`: Each venue adds its own link for its own calendars.
- `svc.form.active.reach`: Turning this off also hides it on the {collective} page and at {venueList}.
- `svc.form.compliance.reach`: Forms you require here are also asked for at {venueList}. Changes here save straight away.
- `svc.form.compliance.alsoAskedAt`: Also asked at {venue}: {forms}.
- `svc.form.footerReach`: Saving updates {service} at every venue in {collective}.

**Commercial change ask, save summary, stale ask**
- `svc.commercial.title`: Update {service} at every venue?
- `svc.commercial.message`: These changes apply to new bookings at {venueList}.
- `svc.commercial.bookingsKept`: Bookings already made keep the price and terms they were booked with.
- `svc.commercial.membersTold`: {venueList} are told about these changes by email.
- `svc.commercial.clearValues.heading`: Custom values that will be cleared
- `svc.commercial.clearValues.row`: {calendar} at {venue}: {field} goes back to {value}
- `svc.commercial.confirm`: Save and update
- `diff.row`: {label}: {from} to {to}
- `diff.price` / `diff.deposit` / `diff.noShowFee` / `diff.payment` / `diff.length` / `diff.buffer` / `diff.cancellation` / `diff.options` / `diff.addons` / `diff.forms`: Price / Deposit / No-show fee / Online payment / Length / Buffer / Cancellation notice / Options / Add-ons / Forms
- `diff.none`: None
- `svc.save.allDone`: Saved. {service} is up to date at {venueList}.
- `svc.save.pending`: Saved. {venue} is updating. Its calendars take new bookings for {service} again in a moment.
- `svc.save.failed`: Saved here, but {venue} could not be updated yet: {reason}. We will keep trying.
- `svc.save.retry`: Retry now
- `svc.save.calendarFailed`: {calendar} at {venue} could not be changed: {reason}.
- `sync.reason.busy`: {venue} was busy. We will try again in a moment.
- `sync.reason.subscription`: {venue}'s subscription is paused.
- `sync.reason.unknown`: something went wrong on our side
- `svc.stale.title`: {service} changed while you were editing
- `svc.stale.message`: Someone saved a change to {service} after you opened it. Reload it to see the latest version, then make your change again.
- `svc.stale.confirm`: Reload service

**CollectiveCalendarsSection and ServiceRemovalBookingsDialog**
- `svc.cal.heading`: Calendars that offer this service (existing)
- `svc.cal.help.collective`: Tick the calendars that should offer this service, at any venue in {collective}.
- `svc.cal.venueYou`: {venue} (you)
- `svc.cal.noCalendars`: {venue} has no active calendars yet.
- `svc.cal.notSaved.add`: Not saved yet
- `svc.cal.notSaved.remove`: Not saved yet: will stop offering
- `svc.cal.editValues`: Edit values
- `svc.cal.chip.price` / `.length` / `.buffer` / `.deposit` / `.colour` / `.name`: Custom price {price} / Custom length {minutes} min / Custom buffer {minutes} min / Custom deposit {price} / Custom colour / Custom name
- `svc.cal.lastChanged`: Last changed by {venue}, {date}
- `svc.cal.compare`: Compare values for every calendar
- `svc.cal.compare.standard`: Standard
- `svc.cal.inactiveOther`: (not available: calendar turned off at {venue})
- `svc.cal.warn.noStripe`: {venue} cannot take card payments yet, so guests cannot book its calendars for this service online. Its team can still book it.
- `svc.cal.warn.formsOff`: {venue} has forms switched off, so its calendars are hidden for this service until it turns them on.
- `svc.cal.warn.suspended`: {venue} is paused on the {collective} page, so its calendars are hidden.
- `svc.cal.warn.settingUp`: Setting up at {venue}. Its calendars can take bookings once this finishes.
- `svc.cal.warn.failed`: Could not update at {venue}: {reason}.
- `svc.removal.collectiveLine`: {calendar} also stops offering {service} on the {collective} page.
- `svc.removal.otherVenue.row`: {date}, {time} on {calendar}
- `svc.removal.otherVenue.note`: These bookings stay with {venue}. Only {venue} can move them.

**StaffServiceOverrideModal**
- `override.help.collective`: Changes apply only to {calendar}. They show wherever {calendar} is booked, including the {collective} page.
- `override.help.member`: Changes apply only to {calendar}. {host} decides which settings you can change.
- `override.standard`: Standard for this service: {value}

**Services page, member**
- `svc.member.subtitle`: Services from {host} are managed by {host}. You choose which of your calendars offer them.
- `svc.member.banner.title`: You are part of {collective}
- `svc.member.banner.body`: {host} manages the services on the {collective} page, including their prices, deposits and forms. You choose which of your calendars offer each one. Services only at {venue} are yours, but clients cannot book them online while you are part of {collective}.
- `svc.member.banner.leave`: Leaving {collective}
- `svc.member.section.fromHost`: same as `common.pill.fromHost`
- `svc.member.section.fromHostCaption`: Managed by {host} for {collective}
- `svc.member.section.retired`: No longer offered by {host}
- `svc.member.section.retiredCaption`: {host} took these off the {collective} page. They cannot be booked. Bookings already made are not changed.
- `svc.member.section.own`: same as `common.pill.onlyAt`
- `svc.member.section.ownCaption`: Yours to edit. Clients cannot book these online while you are part of {collective}. Your team can still book them.
- `svc.member.card.view`: View
- `svc.member.card.settingUp`: Setting up. Guests can book it on your calendars once this finishes.
- `svc.member.card.updating`: Updating from {host}. Guests can book it on your calendars again in a moment.
- `svc.member.card.failed`: This service is not up to date with {host}, so guests cannot book it on your calendars. {host} has been told.
- `svc.member.card.noStripe`: Guests cannot book this online with you until you connect Stripe, because it takes {paymentKind}. ({paymentKind}: a deposit, full payment, a card hold)
- `svc.member.card.connectStripe`: Connect Stripe
- `svc.member.card.formsOff`: This service asks for {forms}. Turn on compliance records so your calendars can offer it online.
- `svc.member.card.turnOn`: Turn on
- `svc.member.card.noCalendars`: None of your calendars offer this yet.
- `svc.member.card.chooseCalendars`: same as `svc.offer.chooseCalendars`
- `svc.member.card.suggest`: Suggest to {host}
- `svc.member.suggest.title`: Suggest {service} for {collective}?
- `svc.member.suggest.message`: {host} is asked to add {service} to the {collective} page. If {host} adds it, {host} controls it from then on, and you choose whether your {service} is used for it.
- `svc.member.suggest.confirm`: Send suggestion
- `svc.member.suggest.done`: Suggestion sent to {host}.
- `svc.member.add.help`: New services are only at {venue}. Clients cannot book them online while you are part of {collective}. Your team can still book them.
- `svc.member.view.lastUpdated`: Last updated from {host} {relativeTime}
- `svc.member.view.sectionLocked`: Set by {host}
- `svc.member.view.calendarsHeading`: Your calendars that offer this service
- `svc.member.view.calendarsHelp`: When you save, ticked calendars offer {service} on the {collective} page.
- `svc.member.view.valuesHeading`: Values for your calendars
- `svc.member.view.valuesHelp`: {host} lets each calendar set its own {fields}.
- `svc.member.view.linkLabel`: same as `svc.form.location.linkLabel`
- `svc.member.view.retiredNote`: Retired services cannot be booked. Unticking calendars only tidies your list.
- `svc.member.view.close`: Close
- `svc.member.view.save`: Save your choices
- `svc.member.error.managed`: This service is managed by {host} for {collective}. Ask {host} to change it.
- `svc.member.adopt.title`: {host} wants to use your {service}
- `svc.member.adopt.message`: {host} has put {service} on the {collective} page. You can use your own {service} for it, so its calendars and bookings stay as they are, or keep yours separate.
- `svc.member.adopt.useMine`: Use my {service}
- `svc.member.adopt.keepSeparate`: Keep mine separate

**Categories tab (ServiceCategoriesManager.tsx)**
- `cat.host.description`: Group your services under headings on the {collective} page, so customers find what they want faster. Drag the handle (or use the arrows) to set their order. Headings used by services on the page reach {venueList}.
- `cat.host.deleteOnPage`: {count} services move to "Other services" on the {collective} page and at {venueList}. Nothing about a service is deleted.
- `cat.member.description`: Group your services under headings. Headings from {host} follow {host}'s names. Their order here only changes your own lists, not the {collective} page.
- `cat.member.lockedTooltip`: {host} manages this heading for {collective}.

**Add-ons (AddonsLibraryView.tsx, AddonGroupsSection.tsx)**
- `addons.delete.title`: Delete {group}?
- `addons.delete.message`: If any past bookings used it, it is archived instead.
- `addons.deleteInactive.message`: This group is already archived. Delete it for good? You can only do this if no bookings used it.
- `addons.delete.onPage`: {group} is used by {count} services on the {collective} page. Deleting it removes it from them at {venueList} too.
- `addons.delete.confirm`: Delete group
- `addons.member.section.fromHost`: same as `common.pill.fromHost`
- `addons.member.section.own`: Your add-on groups
- `addons.member.view`: View
- `addons.member.lockedNote`: {host} manages this group for {collective}. Only services from {host} can use it.
- `addons.picker.hiddenNote`: Add-on groups from {host} can only be used by services from {host}.
- `addons.error.managed`: This add-on group is managed by {host} for {collective}. Ask {host} to change it.

**Compliance (ComplianceSettingsSection.tsx, type editor, ServiceRequirementsPanel.tsx)**
- `comp.types.host.onPage`: Asked for on {count} services on the {collective} page
- `comp.types.member.view`: View
- `comp.types.member.duplicateHelp`: Duplicate makes your own copy that you can edit.
- `comp.types.member.acceptsRecords`: Records for this form also count for {host}'s {form}.
- `comp.editor.host.banner`: This form is asked for on services on the {collective} page. When you publish a new version, it reaches {venueList} straight away. Records already collected are not changed.
- `comp.editor.member.banner`: {host} manages this form for {collective}. You can view it here.
- `comp.req.host.allBookings`: Forms here are also asked for on every service on the {collective} page, at {venueList}.
- `comp.req.member.allBookings`: Forms here are also asked for on services from {host}, alongside {host}'s own forms.
- `comp.req.member.replicaRow`: Set by {host}. To change these forms, ask {host}.
- `comp.type.error.managed`: This form is managed by {host} for {collective}. Ask {host} to change it.
- `comp.general.lockedMember`: Services from {host} ask for forms, so compliance records stay on while you are part of {collective}.
- `comp.general.lockedHost`: Services on the {collective} page ask for forms, so compliance records stay on while you host {collective}.
- `comp.general.error.locked`: Compliance records stay on while services in {collective} ask for forms.

**Calendar Availability (BookableCalendarsPanel.tsx, AppointmentAvailabilitySettings.tsx)**
- `cal.header.host`: Calendars at {venueList} are run by those venues. You choose which services they offer on your Services page.
- `cal.header.member`: You choose which services from {host} your calendars offer. {host} can also add or remove your calendars, and you are told when it does.
- `cal.card.group.onPage`: same as `common.srOnly.collective`
- `cal.card.group.fromHost`: same as `common.pill.fromHost`
- `cal.card.group.onlyAt`: same as `common.pill.onlyAt`
- `cal.edit.services.groupOnPage.help`: Guests can book these on the {collective} page.
- `cal.edit.services.groupOnlyAt.help`: Clients cannot book these online while {collective} is live. Your team can still book them.
- `cal.edit.services.turnedOff`: (turned off)
- `cal.edit.services.retired`: (retired by {host})
- `cal.edit.services.noStripe`: Guests cannot book this online until you connect Stripe.
- `cal.edit.active.warn`: Turning this off also hides {calendar} on the {collective} page.
- `cal.link.redirectNote`: While you are part of {collective}, this link opens {calendar} on the {collective} page.
- `cal.delete.collectiveLine`: {calendar} also disappears from the {collective} page, where it offers {count} services.
- `cal.stopOffering.title`: Stop offering on the {collective} page?
- `cal.stopOffering.message`: {calendar} will stop offering {services} on the {collective} page. Bookings already made are not changed.
- `cal.stopOffering.hostTold`: {host} is told.
- `cal.stopOffering.confirm`: Save
- `cal.flash.added`: Calendar updated. {calendar} now offers {service} on the {collective} page.
- `cal.flash.addedMany`: Calendar updated. {calendar} now offers {count} more services on the {collective} page.
- `cal.stale.title`: {calendar}'s services changed
- `cal.stale.message`: Someone changed {calendar}'s services while this was open. We have loaded the latest list. Check it and save again.
- `cal.stale.confirm`: Check the list
- `cal.stale.apiProse`: Someone else changed this calendar's services. Refresh and try again.

**CalendarServiceValuesDialog**
- `values.title`: {service} on {calendar}
- `values.hostEditingMember`: {venue} is told about this change.
- `values.standard`: Standard: {value}
- `values.useStandard`: Use the standard value
- `values.save`: Save values
- `values.cancel`: Cancel
- `values.error.cardHoldFloor`: The no-show fee must be at least {currencySymbol}1.
- `values.error.notOffered`: {calendar} does not offer {service}, so it has no values to set.

**Settings, Booking Page tab (CombinedPageNotice.tsx, CombinedPageManager.tsx, WidgetSection.tsx)**
- `bp.switch.host`: {collective} works as one business with one booking page, and you host it. Guests who book with any venue in it use the {collective} page.
- `bp.switch.member`: {collective} works as one business with one booking page, and {host} hosts it. Guests who book with you use the {collective} page.
- `bp.switch.tab.combined`: {collective} page
- `bp.switch.tab.own`: Your own page
- `bp.status.redirecting`: Guests who visit your own booking page are sent to the {collective} page.
- `bp.status.showing`: Your own page is showing because {reason}.
- `bp.reason.notLive`: the {collective} page is not live yet
- `bp.reason.noCalendars`: none of your calendars offer a service on the {collective} page yet
- `bp.reason.paused`: booking is paused on the {collective} page
- `bp.reason.settingUp`: your services from {host} are still being set up
- `bp.reason.unavailable`: the {collective} page is unavailable right now
- `bp.leaveStaged.title`: Leave without saving?
- `bp.leaveStaged.message`: You have changes on this page that are not saved yet.
- `bp.leaveStaged.confirm`: Leave without saving
- `bp.own.redirecting.title`: Your own page is not showing
- `bp.own.redirecting.body`: While {collective} is live, guests who visit /book/{slug} are sent to the {collective} page. These settings are kept for when you leave or {collective} ends, and can't be changed until then.
- `bp.own.showing.body`: Guests who visit /book/{slug} can book your calendars there for now.
- `bp.combined.host.description`: Set up the {collective} page here: its design and its members. Services and their calendars are managed on your Services page.
- `bp.inherited.prices`: Prices, lengths, deposits and cancellation notice come from your services. Each calendar can have its own values where you allow it.
- `bp.page.photos`: Photos come from your services and show for every calendar.
- `bp.members.history`: History
- `bp.members.askToHost`: Ask to host
- `bp.members.cancelInvite`: Cancel invitation
- `bp.memberSummary.intro`: {host} hosts {collective} and manages its booking page: the services on it, their prices and forms, headings, photos and branding. You choose which of your calendars offer each service on Calendar Availability. Working hours and closures for your calendars stay yours.
- `bp.memberSummary.hiddenReason.noStripe`: Hidden for {services}: card payments are not set up
- `bp.memberSummary.hiddenReason.formsOff`: Hidden for {services}: forms are switched off
- `bp.memberSummary.empty`: None of your calendars offer a service on the {collective} page yet. Choose services for your calendars on Calendar Availability.
- `bp.memberSummary.leave`: To stop taking part, leave {collective} under Linked accounts.
- `bp.widget.collectiveOnly`: While {collective} is live, your website widget and QR code open the {collective} page.

**Settings, Linked accounts (VenueCollectivesPanel.tsx)**
- `la.panel.description`: A venue collective runs two or more linked venues as one business with one booking page. The host manages the services, and each venue keeps its own clients and bookings.
- `la.create.eligibleNote`: To create a collective, you need an active link with each venue you invite that shares full calendar details. Open the link under Active links and choose Edit permissions.
- `la.create.explainer`: When a venue joins, {venue} sets up the services you put on the page in that venue's account and controls them. Each venue keeps its own clients, bookings and payments.
- `la.create.ineligible.otherCollective`: Already part of another collective
- `la.create.ineligible.currency`: Uses {currency}, not {yourCurrency}
- `la.create.ineligible.timezone`: In {timezone}, not {yourTimezone}
- `la.create.ineligible.plan`: Their plan does not include collectives
- `la.create.warn.noStripe`: Has not connected Stripe. It can join, but guests cannot book its calendars online for services that take a payment.
- `la.create.done`: Collective created. Invitations sent to {venueList}.
- `la.row.invitation.review`: Review invitation
- `la.row.setup`: Setting up {done} of {count} services from {host}.
- `la.row.health.upToDate`: {count} services from {host}. Up to date.
- `la.row.health.updating`: Updating {count} services from {host}.
- `la.row.health.failed`: {count} services from {host} are not up to date.
- `la.row.hostHealth`: {count} services on the page. {upToDate} of {venues} venues up to date.
- `la.row.history`: History
- `la.row.hostMoveScheduled`: Hosting moves to {newHost} on {date}.
- `la.row.hostRequest`: {host} has asked you to take over hosting {collective}.
- `la.row.paused`: The {collective} page is paused because {oldHost} is no longer part of it. One of you can take over hosting, or you can leave.
- `la.row.takeOver`: Take over hosting
- `la.row.ended`: Ended on {date}
- `la.row.listOnOldPage`: List {venue} on the old {collective} page
- `decline.title`: Decline the invitation to {collective}?
- `decline.message`: {host} is told. You can be invited again later.
- `decline.confirm`: Decline

**JoinCollectiveDialog and AdoptServiceReview**
- `join.title` and `join.confirm`: Join {collective}
- `join.step`: Step {n} of {total}
- `join.step.means` / `.services` / `.forms` / `.check`: What joining means / Your services / Forms you already use / Check and join
- `join.means.1`: {host} sets up the services on the {collective} page in your account and controls them: names, descriptions, prices, deposits, payment rules, options, add-ons and forms.
- `join.means.2`: Clients pay you, through your own Stripe account, at the prices {host} sets.
- `join.means.3`: You choose which of your calendars offer each service. Your working hours and closures stay yours.
- `join.means.4`: Your clients and bookings stay yours.
- `join.means.5`: While you are part of {collective}, guests who visit your own booking page are sent to the {collective} page.
- `join.means.6`: Services only at {venue} stay yours to edit, but clients cannot book them online while you are part of {collective}. Your team can still book them.
- `join.means.7`: You can leave at any time. You keep every service and booking.
- `join.warn.noStripe`: You have not connected Stripe. {count} services on the page take a deposit, full payment or card hold, so guests cannot book those with you online until you connect it.
- `join.warn.formsOn`: Some services ask for forms. Joining turns on compliance records for your venue, and they stay on while you are part of {collective}.
- `join.block.timezone`: You cannot join because your venue is in {yourTimezone} and {collective} is in {timezone}. Change your timezone under Profile first.
- `join.block.currency`: You cannot join because your venue uses {yourCurrency} and {collective} uses {currency}.
- `join.block.otherCollective`: Your venue is already part of {otherCollective}. Leave it before joining another.
- `join.services.sameName.heading`: Services with the same name
- `join.services.sameName.help`: You already have services with these names. Choose whether to use yours or add {host}'s as new.
- `join.services.addNew`: Add {host}'s as a new service
- `join.services.useMine`: same as `svc.member.adopt.useMine`
- `join.services.useMine.note`: Your {service} keeps its calendars and bookings. Its settings change to {host}'s. Bookings already made keep their price.
- `join.services.reconnect`: Use my services from {host} again
- `join.map.heading`: Match your options
- `join.map.yours`: Your option
- `join.map.theirs`: {host}'s option
- `join.map.keepOld`: Keep for existing bookings only
- `join.map.preview.heading`: What changes
- `join.map.preview.now` / `.after`: Now / After joining
- `join.services.own.heading`: Your other services
- `join.services.own.help`: Clients cannot book these online while you are part of {collective}. Your team can still book them.
- `join.services.keep`: Keep for bookings your team makes
- `join.services.ask`: Ask {host} to add it to {collective}
- `join.services.pause`: Pause it
- `join.forms.useExisting`: Use my existing {form}, so records my clients already gave still count
- `join.forms.useTheirs`: Use {host}'s version as a separate form
- `join.forms.note`: Either way, {host} decides which forms its services ask for.
- `join.summary.setup`: {count} services from {host} will be set up in your account.
- `join.summary.useMine`: {count} of your services will be used for services from {host}.
- `join.summary.keep`: {count} of your services will be kept for team bookings.
- `join.summary.pause`: {count} of your services will be paused.
- `join.summary.formsOn`: Compliance records will be turned on.
- `join.consent`: I have read what joining means, and I agree to {host} managing these services for {venue}.
- `join.terms`: Read the collective terms
- `join.back` / `join.next` / `join.cancel`: Back / Next / Cancel
- `join.progress`: Setting up {count} services from {host}…
- `join.progress.slow`: Still setting up. You can close this, and we will tell you when it is ready.
- `join.done.title`: You have joined {collective}
- `join.done.body`: Next, choose which of your calendars offer each service.
- `join.done.cta`: same as `svc.offer.chooseCalendars`
- `join.error.consent`: Please open ResNeo on the web to read what joining means, then accept there.

**Leave, review, remove, end, transfer, history, preferences**
- `leave.title`: Leave {collective}?
- `leave.message`: You keep every service, calendar and booking. Services from {host} become yours to edit, and guests book you on your own booking page again.
- `leave.body.services`: {count} services from {host} become your own services, with the settings they have now.
- `leave.body.noStripe`: {count} of them take a payment online. You have not connected Stripe, so they stop taking payments online until you do.
- `leave.body.bookings`: Bookings made through the {collective} page stay with you.
- `leave.body.link`: Also change my link with {host} to calendar viewing only
- `leave.body.linkHelp`: This link was set up so {collective} could work. You can change it again under Active links.
- `leave.body.lastMember`: {collective} needs at least two venues, so it ends when you leave.
- `leave.confirm`: Leave {collective}
- `review.title`: You left {collective}. Review your services
- `review.titleRemoved`: You are no longer part of {collective}. Review your services
- `review.prices`: Check prices and deposits on {count} services that came from {host}
- `review.link`: Add your own online meeting link to {count} services
- `review.stripe`: Connect Stripe to take payments online again
- `review.library`: Check headings, add-ons and forms that came from {host}
- `review.photos.copying`: Copying photos from {host}…
- `review.photos.done`: Photos copied
- `review.photos.failed`: Some photos could not be copied.
- `review.dismiss`: Done
- `remove.title`: Remove {venue} from {collective}?
- `remove.message`: {venue} keeps every service, calendar and booking, and its own booking page comes back. Its calendars leave the {collective} page straight away.
- `remove.lastMember`: {collective} needs at least two venues, so removing {venue} ends {collective}.
- `remove.confirm`: Remove {venue}
- `dissolve.button` and `dissolve.confirm`: End {collective}
- `dissolve.title`: End {collective}?
- `dissolve.message`: The {collective} page stops taking bookings straight away. Every venue keeps its services, calendars, clients and bookings, and its own booking page comes back.
- `dissolve.oldLinks`: For 90 days, old links to the {collective} page show a page listing each venue's own booking page.
- `dissolve.typeToConfirm`: Type {collective} to confirm
- `transfer.ask.title`: Ask {venue} to host {collective}?
- `transfer.ask.message`: If {venue} accepts, it controls the services on the {collective} page for every venue, including yours. The page then shows {venue}'s address, phone and opening hours.
- `transfer.ask.notice`: Every venue is told, and hosting moves 14 days after {venue} accepts.
- `transfer.ask.blockedBehind`: Wait until every venue is up to date before asking another venue to host.
- `transfer.ask.confirm`: Send request
- `transfer.review`: Review request
- `transfer.accept.title`: Take over hosting {collective}?
- `transfer.accept.1`: You will control the services on the page for every venue: names, prices, deposits, payment rules, options, add-ons and forms.
- `transfer.accept.2`: {host}'s services on the page become services you manage, in {host}'s account.
- `transfer.accept.3`: The {collective} page will show your address, phone and opening hours.
- `transfer.accept.4`: Clients keep paying the venue whose calendar they book.
- `transfer.accept.consent`: I agree to host {collective} and manage its services for every venue.
- `transfer.accept.confirm`: Accept and host
- `transfer.cancel`: Cancel the move
- `takeover.note`: The page stays paused until someone takes over. If no one does within 30 days, {collective} ends and every venue keeps everything.
- `history.title`: {collective} history
- `history.filter.all` / `.services` / `.calendars` / `.members`: All changes / Services / Calendars / Members
- `history.empty`: Nothing has changed yet.
- `history.more`: Load more
- `history.actorWithPerson`: {person} at {venue}
- `history.offeringAdded`: {actor} added {service} to the page
- `history.offeringWithdrawn`: {actor} took {service} off the page
- `history.masterEdited`: {actor} changed {service}: {changes}
- `history.replicaApplied`: {service} updated at {venue}
- `history.replicaFailed`: {service} could not be updated at {venue}: {reason}
- `history.calendarAssigned`: {actor} added {calendar} at {venue} to {service}
- `history.calendarUnassigned`: {actor} took {calendar} at {venue} off {service}
- `history.valuesChanged`: {actor} changed {calendar}'s {field} for {service}
- `history.memberJoined` / `.memberLeft` / `.memberRemoved`: {venue} joined / {venue} left / {actor} removed {venue}
- `history.hostTransferOffered` / `.hostTransferred` / `.dissolved`: {actor} asked {venue} to host / {venue} became host / {actor} ended {collective}
- `history.driftRepaired`: A difference in {service} at {venue} was fixed
- `prefs.collective.digest`: Email me a daily summary of other changes to {collective} services
- `prefs.collective.calendars`: Email me when another venue changes which of our calendars offer a service
- `prefs.collective.required`: Emails about prices, payments and forms always come, because they change what your clients pay or fill in.

**Other settings and dashboard**
- `profile.timezone.locked`: You cannot change your timezone while you are part of {collective}, because every venue in it uses the same timezone.
- `profile.timezone.error`: Your venue is part of {collective}, so its timezone cannot change. Leave {collective} first.
- `payments.member.note`: {count} services from {host} take a payment online. Guests cannot book them with you online until Stripe is connected.
- `delete.host`: {collective} ends when this venue is deleted. Every other venue keeps its services, calendars and bookings.
- `delete.member`: This venue leaves {collective} first, and {host} is told.
- `import.undo.title`: Undo this import?
- `import.undo.message`: Records this import created are removed.
- `import.undo.confirm`: Undo import
- `import.undo.kept`: {count} services were kept because they are part of {collective}: {services}.
- `reports.priceNote`: Figures use the price each booking was made at, so later price changes do not change past figures.
- `sidebar.collectiveLink`: {collective} booking page

**Diary and staff booking (PractitionerCalendarView.tsx, StaffSurfaceBookingModal.tsx, StaffGuestContactFields)**
- `diary.column.venue`: {venue}
- `diary.column.title`: {calendar} at {venue}, part of {collective}
- `staff.modal.heading.collective`: New booking in {collective}
- `staff.service.onlyAt`: same as `common.pill.onlyAt`
- `staff.contact.otherVenue`: This client will be added to {venue}'s contacts.
- `staff.contact.searchOther`: Search {venue}'s clients
- `staff.deposit.noStripe`: Card payments are not set up at {venue}, so take payment in person.
- `staff.group.sameVenue`: For a group booking, everyone needs to be booked at the same place. Book the others separately.
- `staff.error.updating`: This service is being updated at {venue}. Please try again in a moment.
- `staff.detail.bookedWith`: Booked with {venue}
- `staff.detail.onlyOwner`: Only {venue} can change this booking.

**Public pages, guest manage page, guest emails**
- `public.calendar.venue`: {venue}
- `public.price.from`: From {price}
- `public.trader`: You are booking with {business}, {address}.
- `public.payment.payee`: Your payment goes to {business}.
- `public.marketing.collective`: Send me offers and news from {business} by email.
- `public.confirmation.through`: Booked with {business} through {collective}.
- `public.forms.anyAvailable`: Once we have matched you with someone, we will ask for any forms they need.
- `public.error.updating`: This service has just been updated. Please choose your time again.
- `public.interstitial.title`: Book {service} with {venue}
- `public.interstitial.body`: {venue} takes bookings for {service} by phone. Call {phone} to book.
- `public.interstitial.noPhone`: Please contact {venue} to book {service}.
- `public.interstitial.cta`: See what you can book online
- `public.dissolved.title`: {collective} is no longer taking bookings
- `public.dissolved.body`: You can still book with these businesses:
- `public.dissolved.book`: Book with {venue}
- `public.dissolved.none`: Please contact the business directly.
- `public.dissolved.existing`: If you already have a booking, the link in your confirmation email still lets you manage it.
- `guest.bookedThrough`: Booked through {collective}
- `email.confirm.through`: You booked through {collective}.
- `email.bookAgain.call`: To book again, call {venue} on {phone}.

**Venue notices: email subject and first paragraph (N numbers in notifications)**
- `notify.invite.subject`: {host} invited you to join {collective}
- `notify.invite.body`: {host} has invited {venue} to join {collective}, so your calendars and theirs work as one business with one booking page. If you join, {host} manages the services on the page, including their prices and forms, and clients pay you directly. You keep your clients and bookings, and you can leave at any time.
- `notify.invite.cta`: Review invitation
- `notify.joined.subject`: {venue} joined {collective}
- `notify.joined.body`: Your services on the {collective} page are being set up at {venue}. Choose which of its calendars offer each service on your Services page, or let {venue} choose.
- `notify.ready.subject`: Your services from {host} are ready
- `notify.ready.body`: {count} services from {host} are set up. Choose which of your calendars offer them.
- `notify.failedHost.subject`: {service} could not be updated at {venue}
- `notify.failedHost.body`: Your latest change to {service} has not reached {venue}: {reason}. Until it does, guests cannot book {service} on {venue}'s calendars. We are still trying.
- `notify.failedMember.subject`: {service} from {host} is not up to date
- `notify.failedMember.body`: Guests cannot book {service} on your calendars until it updates. {host} has been told, and we are still trying.
- `notify.commercial.subject`: {host} changed {service} (plural: {host} changed {count} services)
- `notify.commercial.body`: These changes apply to new bookings on your calendars from now. Bookings already made keep the price and terms they were booked with.
- `notify.digest.subject`: Changes from {host} today
- `notify.digest.body`: Here is what {host} changed in services on the {collective} page today.
- `notify.offered.subject`: {host} added {service} to {collective}
- `notify.offered.body`: {service} is set up in your account. Choose which of your calendars offer it.
- `notify.withdrawn.subject`: {host} took {service} off {collective}
- `notify.withdrawn.body`: {service} is now retired in your account, and your calendars stop offering it for new bookings. {count} bookings already made are not changed.
- `notify.turnedOff.subject`: {host} turned off {service}
- `notify.turnedOff.body`: Guests cannot book {service} on any calendar until {host} turns it back on. Bookings already made are not changed.
- `notify.turnedOn.subject`: {host} turned {service} back on
- `notify.hostCalendar.added.subject`: {host} added {calendar} to {service}
- `notify.hostCalendar.added.body`: Guests can now book {service} with {calendar} on the {collective} page. You can change this on Calendar Availability.
- `notify.hostCalendar.removed.subject`: {host} took {calendar} off {service}
- `notify.hostCalendar.removed.body`: {calendar} no longer offers {service} for new bookings. {count} upcoming bookings stay as they are.
- `notify.memberCalendar.added` / `.removed`: {venue} added {calendar} to {service} / {venue} took {calendar} off {service}
- `notify.calendarGone`: {calendar} at {venue} is no longer on the {collective} page
- `notify.values.subject`: {host} changed {calendar}'s {field} for {service}
- `notify.values.body`: {calendar} now uses {value} for {service}.
- `notify.valuesCleared.subject`: Custom values for {service} were cleared
- `notify.valuesCleared.body`: {host} no longer lets calendars set their own {field} for {service}. {calendars} now use the standard value, {value}.
- `notify.left.subject`: {venue} left {collective}
- `notify.left.body`: {venue}'s calendars are no longer on the {collective} page. It keeps the services it had from you as its own services.
- `notify.removed.subject`: You are no longer part of {collective}
- `notify.removed.body`: {host} removed {venue} from {collective}. You keep every service, calendar and booking. Services from {host} are now yours to edit, and your own booking page is back.
- `notify.linkEnded.subject`: {venue} left {collective} because a link ended
- `notify.linkEnded.body`: The link between {venue} and {host} ended, so {venue} is no longer part of {collective}. It keeps every service, calendar and booking.
- `notify.dissolved.subject`: {collective} has ended
- `notify.dissolved.body`: Every venue keeps its services, calendars, clients and bookings. Your own booking page is back.
- `notify.review.cta`: Review your services
- `notify.hostRequest.subject`: {host} asked you to host {collective}
- `notify.hostRequest.body`: If you accept, you manage the services on the {collective} page for every venue, including their prices and forms.
- `notify.hostMoving.subject`: {newHost} will host {collective} from {date}
- `notify.hostMoving.body`: From {date}, {newHost} manages the services on the {collective} page, including the prices and forms used on your calendars. You can leave at any time.
- `notify.hostMoved.subject`: {newHost} now hosts {collective}
- `notify.hostMoved.body`: {newHost} manages the services on the {collective} page from today. Bookings already made are not changed.
- `notify.paused.subject`: {collective} is paused
- `notify.paused.body`: {oldHost} is no longer part of {collective}, so its page is paused. One of you can take over hosting before {date}, or {collective} ends and every venue keeps everything.
- `notify.connectStripe.subject`: Connect Stripe to take bookings for {service}
- `notify.connectStripe.body`: {service} takes {paymentKind}, so guests cannot book it with you online until you connect Stripe.
- `notify.suggestion.subject`: {venue} suggests {service} for {collective}
- `notify.suggestion.body`: {venue} would like {service} on the {collective} page. If you add it, you control it for every venue.
- `notify.adopt.subject`: same as `svc.member.adopt.title`
- `notify.adopt.body`: {host} has put {service} on the {collective} page. Choose whether to use your own {service} for it, so its calendars and bookings stay as they are.
- `notify.oldApp.subject`: {service} was changed from an older ResNeo app
- `notify.oldApp.body`: Someone changed {service} from a version of the ResNeo app that cannot show which venues a change reaches. Check the service to make sure the change is what you meant.
- `notify.migratedHost.subject`: {collective} now runs from your Services page
- `notify.migratedHost.body`: The services on the {collective} page are now managed from your Services page, and every change reaches {venueList}. We brought their copies into line with yours.
- `notify.migratedMember.subject`: {host} now manages its services in your account
- `notify.migratedMember.body`: The services from {host} in your account now follow {host}'s settings. Here is what changed. Bookings already made keep their price.

#### Collective overview (§2 item 15)
- `nav.collective`: {collective}
- `ov.title`: {collective}
- `ov.subtitle`: Everything the collective sells, and how each venue is doing.
- `ov.venue.upToDate`: Up to date
- `ov.venue.updating`: Updating now
- `ov.venue.settingUp`: Setting up {done} of {count} services
- `ov.venue.failed`: Could not update {count} services
- `ov.venue.failedDetail`: {reason} We will keep trying. You can also try now.
- `ov.venue.hidden`: Hidden from guests for {count} services
- `ov.venue.paused`: Paused
- `ov.venue.lapsed`: This venue's subscription needs attention, so its calendars are not on the page.
- `ov.venue.counts`: {services} services, {calendars} calendars on the page
- `ov.venue.calendarLimit`: On the {plan} plan, {venue} can offer these on {count} calendar. They can add more by changing their plan.
- `ov.todo.noCalendars`: {service} is on the page but no calendar offers it, so guests cannot book it.
- `ov.todo.newVenue`: {venue} has joined. Choose their calendars on {count} services.
- `ov.todo.failed`: {count} services could not be updated at {venue}.
- `ov.todo.noStripe`: {venue} cannot take card payments yet, so {count} paid services are hidden from guests there.
- `ov.todo.formsOff`: {venue} has forms switched off, so {count} services that need a form are hidden from guests there.
- `ov.filter.all`: All services
- `ov.filter.attention`: Needs attention
- `ov.filter.offPage`: Not on the page
- `ov.bulk.selected`: {count} selected
- `ov.bulk.offer`: Put on the page
- `ov.bulk.withdraw`: Take off the page
- `ov.bulk.addCalendars`: Choose calendars
- `ov.bulk.addCalendars.all`: Every calendar at {venue}
- `ov.bulk.removeCalendars`: Remove calendars
- `ov.bulk.retry`: Try these again
- `ov.bulk.confirm.title`: Save these changes?
- `ov.bulk.confirm.message`: This changes {count} services at {venueList}.
- `ov.bulk.confirm.confirm`: Save changes
- `ov.preview.button`: See what each venue will show
- `ov.preview.title`: What guests will see
- `ov.preview.willHide`: This will not be bookable at {venue}, because {reason}.
- `ov.notLive.title`: Your collective page is not live yet
- `ov.notLive.body`: Guests will see it once two venues are active and at least one calendar offers a service.
- `ov.notLive.step.invite`: Invite a venue
- `ov.notLive.step.accept`: Wait for them to accept
- `ov.notLive.step.services`: Put services on the page
- `ov.notLive.step.calendars`: Choose which calendars offer them
- `ov.paused.title`: Your collective page is paused
- `ov.paused.body`: Guests are sent to each venue's own booking page while it is paused.
- `ov.undo.offer`: Put it back
- `ov.undo.done`: We put {service} back to how it was, at every venue.
- `ov.undo.expired`: That change is now part of your history, so it cannot be undone here. Edit the service to change it again.
- `history.filter.venue`: Venue
- `history.export`: Download this history

#### Reports (§2 item 16)
- `reports.collective.heading`: {collective}
- `reports.collective.scope`: Show
- `reports.collective.viaPage`: Booked on the {collective} page
- `reports.collective.viaOwn`: Booked on {venue}'s own page
- `reports.collective.sharedNote`: This total includes takings at {venueList}, shared with you because you are in a collective together.
- `reports.priceNote`: Figures use the price each booking was made at, so changing a price now does not change what you earned then.

#### Multi-venue people (§2 item 17, D38: no chooser)
- `staff.invite.otherVenue`: {email} already works at another venue on ResNeo. Ask them to sign in and choose this venue, or invite them with a different email address.
- `shell.venue.locked`: This account is linked to more than one venue, so we cannot tell which one to open. Please contact support and we will sort it out.

#### Join and leave, added for D41 and D49
- `join.means.clients`: While you are in {collective}, the other venues can see your clients' records, and you can see theirs. Every record stays with the venue it belongs to. This stops the day you leave.
- `join.means.revenue`: Every venue in {collective} can see every other venue's takings, each named. This also stops the day you leave.
- `leave.body.access`: You will no longer be able to see {venueList}'s clients or bookings, and they will no longer see yours. Everything in your own account stays exactly as it is.
- `staff.contact.ownerLine`: {venue}'s client

#### Calendar Availability, added
- `cal.edit.services.editValues`: Edit values
- `cal.edit.services.lastChanged`: Last changed by {venue}, {date}

#### Booking models and shared resources (§6.14 of the plan)
- `bm.invite.noAppointments`: {venue} does not offer appointments, so it cannot join a collective yet. A collective page shows appointments only.
- `bm.join.otherModels`: You also run {modelList}. Those stay on your own booking page and are not shown on the {collective} page.
- `bm.redirect.otherModels`: Your own booking page now opens the {collective} page. Your {modelList} are still bookable at {link}.
- `bm.model.locked`: You cannot switch appointments off while {venue} is in a collective, because the collective page needs them.
- `bm.currency.blocked`: {venue} takes payment in {currency} and the collective uses {hostCurrency}. Every venue in a collective has to use the same currency.
- `bm.resource.notShared`: Rooms and equipment are not shared between venues. If two venues use the same room, keep it on one venue's calendars only.
- `bm.visit.sameVenue`: All the services in one visit have to be with the same person, so they are at one venue.

#### Public identity (§2 item 14, added)
- `public.meta.title`: Book with {collective}
- `public.meta.description`: Book online with {collective}. {venueCount} venues, one booking page.
- `public.header.venues`: {venueCount} venues
- `public.interstitial.waitlist`: {service} is fully booked. Join the waitlist and we will let you know when a time comes up.

## 4. Lifecycle journeys

Each step names the screen, component and copy ids. "Ask" = the shared `AskConfirmProvider` dialog.

#### J1. Create (host admin)

Rewritten 2026-09-14. The old flow was one dialog, six clicks and one grey paragraph, and it left a host not knowing what a host is, that the services come from them, that their own booking page is superseded, or that the page is not live yet. Three defects made it worse and are logged as plan CB-41 to CB-43: every server refusal renders behind the open dialog so a failed create is silent, the row shows a green "Active" pill while the page serves its unavailable state, and the member line counts active members but names invited ones too.

New component `src/components/linked-accounts/collective/CreateCollectiveDialog.tsx`, replacing `CreateCollectiveModal` (`VenueCollectivesPanel.tsx:382-544`). It follows the house pattern set by `MergeContactsModal.tsx`, which is the closest live analogue: an admin-only, irreversible action taken in four steps with a preview before it commits. That component already uses the `Dialog` primitive with `description={`Step ${step} of 4 ...`}` (`:315-324`), combines Cancel and Back in one left-hand slot (Cancel on step 1, Back after), and suppresses dismissal while busy. Reuse all of it. (Do not look at `RestaurantSetupWizard.tsx` for this: restaurants are no longer a booking model, its route redirects away unless the venue is `table_reservation`, and it is unreachable legacy.)

**Shell.** `Dialog` `size="lg"`, `busy` suppressing dismissal. Title constant (`create.title`); description `create.step` ("Step {n} of 4"), matching the `join.step` convention. Above the body, a four-segment progress rail, 4px, brand fill on completed and current, each segment `sr-only` labelled; completed segments are buttons that go back, later ones are not. Footer: `Back` (secondary, from step 2) on the left; `Cancel` (ghost) and the step primary on the right. **One `role="alert"` block at the top of the body of the step that caused the error**, which is what fixes CB-41. Minimum 44px touch targets.

**Step 1, name it and choose its address.** A brand-50 tinted panel at the very top, above the fields, not between them: `create.what.title`, three items `create.what.1` to `.3`, then `create.what.host` naming the acting venue in medium weight. Then `FormField` name (`create.name.label`, help `create.name.help`, autofocus, 120 chars); `FormField` address wrapping an `Input` whose `/book/c/` prefix sits **inside** the field border so the whole reads as one address; a mono full-address preview `create.address.preview`; and availability in the `FormField` error slot so it gets `aria-invalid` and `aria-describedby` for free (`create.address.checking`, `.free`, `.taken`, `.format`). Disabled primary always carries a reason line (`create.disabled.address`), because today four conditions produce zero messages and the commonest is a 400ms debounce still in flight, which reads as a broken button.

**Step 2, choose the venues.** One row per candidate, and crucially **including the ones that cannot join**, which today are simply absent: checkbox, venue name, a status line, at most one `Pill`. Eligible: no pill, `create.venues.ok`. Eligible without card payments: warning pill `create.venues.pill.noPayments`, sub-line `create.venues.warn.noStripe`, still tickable. Blocked: disabled checkbox, neutral pill `create.venues.pill.cannotJoin`, and the reason (`create.venues.blocked.otherCollective`, `.timezone`, `.currency`, `.plan`). Linked but not fully linked: greyed, `create.venues.blocked.permissions`, plus a link `create.venues.fixPermissions` that opens that link's permissions editor. Selection count `create.venues.selected` above the footer. No candidates: `EmptyState size="compact"` with `create.venues.empty.title`, `.body` and a button to Active links.

**Step 3, what changes.** The step that answers "they should understand what is being created", and read-only apart from one checkbox. Heading `create.changes.title`, intro `.intro`. Then an **address table, one row per venue including the host**, because D3 supersedes the host's own page too: left, the venue name and its current address in mono; right, an arrow (aria-hidden, relationship in text for screen readers) and the collective address in mono; below, `create.changes.address.note` and `.when`. Then three consequence cards: `create.changes.services.*` (the services come from you), `.owns.*` (each venue keeps its own bookings, guests and payments), `.clients.*` (members can see each other's client records and figures while it runs, and that stops when it ends). Then `create.changes.ending` in a slate panel. Then one required checkbox `create.changes.ack`, placed directly under the sentences it acknowledges rather than on the next step. Link out `create.changes.help`.

**Step 4, check and create.** A four-row definition list (name, address, venues invited, your role `create.check.role`), each with an `Edit` link back to its own step. `create.check.notLive` in an info panel. `create.check.emailPreview`, a collapsed disclosure showing the exact first line the invitee will read. Primary `create.cta.create` / `.creating`. Every server refusal renders in this step's alert block, and where the cause belongs to an earlier step it carries a link back: address taken and name taken and name held go to step 1, the eligibility gate to step 2, already-in-a-collective closes the dialog, plan refusals show the server's reason verbatim.

**Step 5, done.** The dialog does not close on success, because closing a dialog is not a receipt. Success mark, `create.done.title`, `.body`, the address in a copy row (`create.done.copy`), then three numbered next steps, each with an index, a label, a one-line description and a link: waiting on the invitees (disabled, shows the count), choose services, design the page. Footer `create.done.cta` and `create.done.later`. `onCreated` consumes the 201 body the route already returns rather than discarding it and refetching, so this renders with no second spinner. A toast fires as well (`create.toast.done`).

**The row afterwards** (`VenueCollectivesPanel.tsx:298-326`). The pill must describe the page, not the database row: `row.pill.waiting` (info, dot) while fewer than two venues are active, `row.pill.noServices` (warning) when two are active but nothing is on the page, `row.pill.live` (success, dot) otherwise. The member line becomes `row.members.line`, counting active and invited separately and naming venues with "(invited)" after each pending one. Where the "View combined booking page" link is hidden, `row.notLive.reason` takes its place rather than nothing.

#### J2. Invite later (host admin)
Booking Page, Members, "Invite a venue" (ineligible venues disabled with reasons). Sent row shows "(invited)" and `bp.members.cancelInvite`. Invitee gets `N1`.

#### J3. Accept: disclosure, consent, choices (member admin)

Rewritten 2026-09-14 to the owner's requirement that "the non-hosts should be told that they are giving control of their booking page to the host and given appropriate info".

**What it replaces.** Today accepting is effectively one click from a row, with no disclosure, no choices and no recorded consent. Worse, the one sentence a member reads about their data before agreeing is false in both halves (plan CB-51): the invitation email says the collective shows their services "alongside" other venues, which D3 makes wrong because it replaces their page, and that "your booking and client data stay fully separate", which is wrong today and stays wrong under D41 because membership is exactly what shares client records and revenue. That email is rewritten with this journey.

**The principle.** These are small business owners who want to join, not sign a contract. The disclosure has to be complete and plain without being frightening: say what changes, show it concretely against their own venue rather than in the abstract, and never bury a consequence in a clause. Anything they can decide, let them decide here rather than discover later.

**Step 1, what this means.** `join.step.means`, with the existing `join.means.*` lines rewritten around three headings rather than a flat list:
- **Your booking page.** Show their actual address (`/book/{their-slug}`) and what it will do: guests who go there will land on the collective's page. Name the collective's address. This is the sentence the owner asked for, and it must name real URLs, because "your page will redirect" does not land the way seeing your own address does.
- **Your services.** The host sets what is sold and what it costs. Their own services that are not on the collective page stay theirs, and step 2 decides what happens to each.
- **Your clients and your figures.** While the collective runs, the other venues can see their client records, and they can see the others'. Everyone can see everyone's takings. All of it stops the day the membership ends, and each venue keeps every record it owns. This is D41 and D49 stated plainly; it is the part today's email denies.

Warnings stay as they are (`join.warn.noStripe`, `join.warn.formsOn`) and blocks still stop the step (`join.block.timezone`, `.currency`, `.otherCollective`).

**Step 2, your services.** Unchanged in shape from the earlier draft: same-name services choose "Add the host's as new" or the reviewed adoption, member-only services choose keep, ask or pause, re-joiners see their former copies first.

**Step 3, your forms.** Unchanged, and shown only when the member holds a form from the same library template.

**Step 4, check and join.** The summary, then a single required checkbox and the recorded `consent_version`. The checkbox text names the two things that are hardest to reverse: the booking page and the client sharing.

**After.** `join.progress`, then `join.done.*` with a next step to Calendar Availability. The status line on their Booking Page tab (item 10) is where this is restated every time they visit, so consent is not a thing that happened once and vanished.

#### J4. Offer a service (host admin)
1. Card switch `svc.card.onPageSwitch`, Add service checkbox `svc.add.onPageCheckbox`, or the Collective area's Services grid (item 15).
2. Ask `svc.offer.*` with venue warnings; card shows `svc.card.updatingAt` then `CollectivePill`; summary `svc.offer.done` + `svc.offer.chooseCalendars`.
3. Members `N8`; new "From {host}" card with `svc.member.card.noCalendars`.
4. Variant: `svc.addFrom.*`; member gets `N26`, opens `svc.member.adopt.*`, maps options and confirms, or keeps its own separate (original stays "Only at", a new copy is made).
Guests: the service appears once any calendar offers it.

#### J5. Host adds or removes a member calendar
1. Edit service, `CollectiveCalendarsSection`, member group: tick (`svc.cal.notSaved.add`); Save. Summary `svc.save.allDone` or `svc.save.calendarFailed`. Member `N11`; its tick shows `svc.cal.lastChanged`.
2. Removal: untick (`svc.cal.notSaved.remove`), Save; with upcoming bookings, `ServiceRemovalBookingsDialog` lists `svc.removal.otherVenue.row` with `svc.removal.otherVenue.note`, no move; "Save and leave these bookings here". Member `N11` with kept count.
Guests: the calendar appears or leaves at once; existing bookings stay and can move to other times on that calendar.

#### J6. Member ticks or unticks a service (member admin or staff)
1. Calendar Availability, Edit calendar, `cal.card.group.fromHost` (help `reach.member.calendarTicks`): tick, Save, flash `cal.flash.added`; paid service without Stripe keeps `cal.edit.services.noStripe`.
2. Untick without bookings: ask `cal.stopOffering.*` + `.hostTold`; with bookings: removal dialog with `svc.removal.collectiveLine`. Stale: `cal.stale.*`.
3. Staff: card toggles with `reach.staff.toggles`. Host `N12`.

#### J7. Leave (member admin)
1. Linked accounts, Leave: `LeaveCollectiveDialog` `leave.title`, `leave.message`, `leave.body.services`, `.bookings`, conditional `.noStripe`, `.lastMember`, checkbox `leave.body.link` (ticked) + `.linkHelp`; confirm `leave.confirm` (destructive).
2. Row Left; `ReviewYourServicesPanel` (`review.title`) on Linked accounts and Services: `review.prices`, `.link`, `.stripe`, `.library`, `review.photos.*`, `review.dismiss`.
3. Services: one list, no pills, locks lifted at once. Booking Page: scope switch gone, own page editable; sidebar "Your Booking Page" back.
4. Host `N16`; below two venues, `N19` to all.
Guests: bookings, manage links and reminders unchanged; Book again opens the venue's own page with the same service; a guest mid-booking on its calendar gets `public.error.updating`.

#### J8. Host removes a member
Booking Page, Members, Remove: ask `remove.title`, `.message`, conditional `.lastMember`, confirm `remove.confirm`. Removed venue `N17`, then review panel with `review.titleRemoved`. Otherwise as J7.

#### J9. End the collective (host admin)
1. Members, `dissolve.button`: ask `dissolve.title`, `.message`, body `dissolve.oldLinks`, input `dissolve.typeToConfirm` (confirm enabled on match), `dissolve.confirm`.
2. Host: Booking Page without scope switch; row `la.row.ended`; pills gone. Members `N19`, review panel, toggle `la.row.listOnOldPage` (default on, 90 days).
Guests: bookings unchanged; old links, QR codes and embeds open `DissolvedCollectivePage`.

#### J10. Host transfer
Manual: host `bp.members.askToHost`, ask `transfer.ask.*` (blocked with `transfer.ask.blockedBehind` while any venue is behind); candidate `N20`, row `la.row.hostRequest`, `transfer.review` opens `transfer.accept.*` with consent; on accept `N21` to all, rows `la.row.hostMoveScheduled`, host may `transfer.cancel`; on the date roles swap, `N22`: new host sees the host banner and pills, old host's page services move to "From {new host}".
Automatic (host no longer a member): page paused, members `N23`, rows `la.row.paused` + `la.row.takeOver` (candidate dialog with `takeover.note`, no 14-day wait); after 30 days paused the collective ends as J9.
Guests: bookings stay with their venues; while paused the page shows `CollectiveUnavailable` and member own pages show (`bp.reason.paused`).

#### J11. Host changes a price
Edit service, Save: ask `svc.commercial.*` with `diff.row` ("Price: £25.00 to £28.00"); summary `svc.save.allDone` or `svc.save.pending` (member calendars briefly hidden for that service while updating); members `N6` (grouped within 15 minutes).
Guests: new bookings pay the new price on calendars without their own price; existing bookings, balances, reminders and revenue keep the booked price.

#### J12. Existing collective moves to the new model
Before the switch each member sees "Review the new way {collective} works" and completes `JoinCollectiveDialog` with current copies pre-mapped (open question). After: host `N29`, members `N30` listing overwritten differences from the dry run.

#### What guests with existing bookings see

| Event | Confirmation and manage page | Price, balance, reminders | Online reschedule | Book again |
|---|---|---|---|---|
| Member joins | Unchanged (owning venue) | Kept (snapshot) | Unchanged | Collective page once redirects start |
| Host edits service | Unchanged; booked service name kept | Kept | Current rules | Collective page |
| Host withdraws service | Unchanged | Kept | Still allowed for that booking | Collective page, service not listed |
| Calendar stops offering it | Unchanged | Kept | Other times on the same calendar | Collective page |
| Member leaves or removed | Unchanged; `guest.bookedThrough` kept as history | Kept | Unchanged | Venue's own page, same service |
| Collective ends | Unchanged | Kept | Unchanged | Own page; old links show dissolved page |
| Host transfer | Unchanged | Kept | Unchanged | Collective page; header shows new host after the date |
| Page paused | Unchanged | Kept | Unchanged | Venue's own page while paused |

## 5. Notifications

All venue notices use `notifyVenue` (`src/lib/linked-accounts/notifications.ts:64-116`) with `collective_id` set (null today). Email: venue email plus active admin logins. Bell: `account_link_notifications`, admin-only (`NotificationBell.tsx`), title = subject, body = first paragraph, with `href`. Exact subjects and bodies are the `notify.*` copy.

**The three new preference keys cannot be stored yet.** `prefs.collective.digest`, `prefs.collective.calendars` and `prefs.collective.required` (§2 item 11, `NotificationPrefsCard`) would be rejected on the way in: `PATCH /api/venue/notifications/preferences` validates against a `.strict()` schema with exactly four keys, `cancel`, `reschedule`, `create` and `notes` (`src/app/api/venue/notifications/preferences/route.ts:10-17`), and `resolveLinkedNotificationPrefs` drops anything it does not know. Widening that schema and the resolver is part of W5, not an afterthought, or the preferences card will silently fail to save.

**What guests are told, and what they are not.** Guests are not emailed about joins, leaves, host changes or dissolves, because none of those change their booking. They are told who they are booking with, at the point of booking and in the confirmation. Note that the confirmation change in §2 item 14 lands in two places, not one: the text branch at `booking-confirmation.ts:114-119` and the HTML preamble at `:87-90`.

| # | Trigger | Recipients | Channels | Content | Link | Frequency |
|---|---|---|---|---|---|---|
| N1 | Host invites a venue | Invitee | Email, bell | `notify.invite.*` (replaces `notifyCollectiveInvitation` 429-444); adds warnings for no Stripe or forms | Linked accounts, invitation | Once |
| N2 | Invitee declines | Host | Email, bell | Existing `notifyCollectiveMemberLeft('declined')` | Members tab | Once |
| N3 | Member joins | Host (email, bell); other members (bell) | Email, bell | `notify.joined.*` | Services page | Once |
| N4 | Member's copies finish setting up | Member | Bell | `notify.ready.*` | Calendar Availability | Once |
| N5 | A copy fails 3 times or stays behind 15 minutes | Host (email, bell); member (bell) | Email, bell | `notify.failedHost.*` with plain reason; `notify.failedMember.*` | Host service dialog; member Services | Once per incident, daily while unresolved |
| N6 | Commercial or form change on an offered service (price, deposit or fee, payment rule, length, buffer, cancellation notice, options, add-on prices or lengths, forms) | Every member | Email, bell; not switchable | `notify.commercial.*`: a block per service of `diff.row` lines plus `svc.commercial.bookingsKept` | Member View dialog | Grouped per member within 15 minutes |
| N7 | Other host changes (name, description, heading, colour, option names, booking window, start times, schedule, location type) | Every member | Email digest; bell per day | `notify.digest.*` grouped by service | Services page | Daily 18:00 venue time, skipped when empty; email per `prefs.collective.digest` |
| N8 | Service offered | Every member | Bell now, digest email | `notify.offered.*` | Member View dialog | Once |
| N9 | Service withdrawn | Every member | Email, bell | `notify.withdrawn.*` | Retired section | Once |
| N10 | Host turns a service off or on | Every member | Email (off), bell (both) | `notify.turnedOff.*`, `notify.turnedOn.*` | Member View dialog | Once |
| N11 | Host adds or removes a member calendar | That member | Email, bell | `notify.hostCalendar.added.*` / `.removed.*` | Calendar Availability, that calendar | Grouped per save |
| N12 | Member adds or removes its calendar on a collective service | Host | Bell; email per `prefs.collective.calendars` | `notify.memberCalendar.*` | Host service dialog | Grouped per save |
| N13 | Member deactivates or deletes a calendar offering collective services | Host | Bell | `notify.calendarGone` | Host Services | Once |
| N14 | Host admin changes a member calendar's values | That member | Email, bell | `notify.values.*` | Member View dialog | Grouped per save |
| N15 | Permission switched off clears stored values | Each venue with a cleared value | Email, bell | `notify.valuesCleared.*` | Service or View dialog | Once per save |
| N16 | Member leaves | Host (email, bell); other members (bell) | Email, bell | `notify.left.*` (rewrites `notifyCollectiveMemberLeft('left')` 609-634) | Members tab | Once |
| N17 | Host removes a member | Removed venue | Email, bell | `notify.removed.*` + `notify.review.cta` (rewrites `notifyCollectiveRemoval` 446-460) | Review panel | Once |
| N18 | Membership ends because a link ended | That venue and host | Email, bell | `notify.linkEnded.*` | Linked accounts | Once |
| N19 | Collective ends | Live members only | Email, bell | `notify.dissolved.*` + `notify.review.cta` (rewrites `notifyCollectiveDissolved` 462-476) | Review panel | Once |
| N20 | Host asks a member to host | Candidate | Email, bell | `notify.hostRequest.*` | Linked accounts request | Once; reminder after 3 days |
| N21 | Candidate accepts | Every venue | Email, bell | `notify.hostMoving.*` | Linked accounts | Once; reminder 2 days before |
| N22 | Hosting moves | Every venue | Email, bell | `notify.hostMoved.*` (rewrites `notifyCollectiveHostTransferred` 584-606) | Services page | Once |
| N23 | Page paused because the host left | Every member | Email, bell | `notify.paused.*` | Take over hosting | Once; reminder day 23 |
| N24 | Member without charges-capable Stripe holds a paid offering | Member | Bell; email once at join | `notify.connectStripe.*` | Settings, Payments | Once per offering |
| N25 | Member suggests its own service | Host | Email, bell | `notify.suggestion.*` | Add from another venue, preselected | Once |
| N26 | Host copies a member's service | That member | Email, bell | `notify.adopt.*` | Adoption review | Once; reminder after 3 days |
| N27 | Master edited from an app build without `X-ResNeo-Client` | Host | Email | `notify.oldApp.*` | Service dialog | Once per service per day |
| N28 | Member chose "Ask {host} to add it" at join | Host | Email, bell | `notify.suggestion.*` | As N25 | Once per service |
| N29 | Existing collective switched to the new model | Host | Email, bell | `notify.migratedHost.*` + overwritten differences | Services page | Once |
| N30 | Same | Every member | Email, bell | `notify.migratedMember.*` + per-service differences | Member Services | Once |
| N31 | Staff create, move or cancel a booking on another venue's calendar through the collective form | Owning venue | Bell always; email per existing categories | Existing `notifyCrossVenueBookingWrite` copy with actor person and venue from the collective audit (D17 as amended by D41) | Diary day | Per booking |

**Removed:** `notifyCombinedPageEnabled` (482-503), which promises price approval that no longer exists.

**Guest messages (owning venue's templates):** confirmation adds `email.confirm.through`; Book again uses the single live resolver, and `email.bookAgain.call` for member-only services; waitlist offers translate links the same way; reminders and payment requests use the snapshot price. Guests are not emailed about joins, leaves, host changes or dissolves, because their bookings do not change.

**Not notified:** drift found and fixed by the daily check (history row only); a venue's edits to its own services.

## 6. Accessibility and mobile

#### Accessibility
- **State in words.** Every pill states its meaning in text; colour and lock icons are `aria-hidden`. `CollectivePill` adds sr-only `common.srOnly.collective`.
- **Read-only is semantic.** Member View dialogs wrap locked sections in `<fieldset disabled aria-describedby="{banner id}">`, so the reason is announced once and text stays selectable. Disabled Rename and Delete keep their names plus sr-only `cat.member.lockedTooltip`; tooltips are never the only explanation.
- **Switches.** "On the {collective} page" uses `role="switch"`, `aria-checked`, a visible label and `aria-busy` while saving, matching the Active switch (`AppointmentServicesView.tsx:1430-1451`).
- **Calendar rows.** Label is the calendar name; `aria-label` "{calendar} at {venue}"; venue groups are `<section aria-labelledby>` with h4. Unsaved markers are text.
- **Live regions.** `CollectiveSaveSummary`, `VenueSyncPill` changes and join progress use `aria-live="polite"`; failures `role="alert"`. Polling announces state changes only.
- **Dialogs.** All asks use Radix `Dialog` via `ConfirmDialog` (focus trap, Escape, labelled title and description). Destructive asks focus Cancel first. The dissolve button enables only when the typed name matches (`dissolve.typeToConfirm` is the label). The join dialog shows `join.step` as text, pins Back and Next in the footer, moves focus to each step heading and keeps choices on Back.
- **Tables.** Compare values, before and after previews and history use `<table>` with `<th scope>`; below 640 px they become stacked definition lists.
- **Targets and contrast.** Controls at least 40 px (`min-h-10`); amber and sky notes keep 900 text on 50 backgrounds (AA). Nothing depends on hover.
- **Language.** Short sentences, second person, British spelling, no em-dashes (test in `collective-copy.ts`). Relative times carry the full date in `title` and sr-only text.
- **Guests.** `public.trader` sits above the consents in reading order; the marketing checkbox is unticked and names the business.

#### Mobile web
- **Services card.** Pills wrap under the title; Active and "On the page" switches stack full width below 640 px; status lines sit under the title.
- **Edit service dialog.** Reach footer text moves above the buttons; member groups in `CollectiveCalendarsSection` collapse into `<details>` showing "{ticked} of {total} calendars", host group open; Compare values becomes cards.
- **Edit calendar dialog.** Each service group keeps the existing `max-h-36` scroll with a sticky group heading.
- **Booking Page tab.** Scope tablist scrolls horizontally; overview rows stack name, price and venue chips.
- **Linked accounts.** Row actions wrap below text; `JoinCollectiveDialog` is full height with pinned footer.
- **Public pages.** The venue line under each calendar truncates with ellipsis; full text stays in the accessible name.

#### ResNeo app (Bearer consumer) until app updates ship
- **Server is the lock.** Every refusal is a coded 409 with prose the app already shows through `ApiError` `e.message` (`C:/Resneo-app/lib/api/client.ts`). Codes are additive; nothing moves out of `error`.
- **Accept.** One-tap accept (`app/(app)/collectives/index.tsx:181-183`) gets 409 `COLLECTIVE_CONSENT_REQUIRED` with `join.error.consent`.
- **Services.** Copies look ordinary in old builds. Admin saves that change only calendars pass because the guard compares normalised projections (deposit 0 and null, canonical shape, add-on links as ordered ids); real edits get `svc.member.error.managed`. GET adds `collective` and a separate `collective_calendars`, never merged into `practitioner_services`.
- **Calendar toggle.** `useToggleCalendarService` sends full sets without `expected_service_ids`; a set removing an assignment another venue wrote in the last 24 hours gets 412 `STALE_RESOURCE` with `cal.stale.apiProse`.
- **Diary.** Own columns open the own form because `staff-collective` `calendar_ids` omits own calendars. Staff creates on a copy that is behind get `staff.error.updating`.
- **Wrong copy.** The app's "Your own booking page is unaffected" (`index.tsx:202-206`) is false under D3.
- **Handover** (Docs/MOBILE_API.md plus a note to the app team): consent sheet sending `consent_version`; read-only copy cards with a "From {host}" badge; host collective calendars list; remove sync badges and Link and Unlink; new codes; `X-ResNeo-Client` header (without it, host master edits trigger `N27`); fix the leave copy; all seven per-calendar values.

## 7. Open questions

- Graft 5 routes a member's own diary columns to its own staff form, which lists copies and member-only services together. On 2026-09-05 you asked that, with two or more venues in a collective, the staff form lists the combined page's offerings only. With own booking pages redirecting (D3), member-only services would otherwise have no way to be booked. May the own-column form return, or should member-only services stay unbookable from the diary?
- Should services only at one venue (host or member) lose online booking while the collective is live, as this spec assumes from D2 and D3, or keep a separate online route?
- At accept, which default should a member's other services get: 'Keep for bookings your team makes' (recommended), 'Ask the host to add it', or 'Pause it'?
- May calendars set their own display name and description on services that are on the collective page? This spec disables those two permissions so the page, emails and booking records always show one name.
- When the host turns a staff permission off, should stored per-calendar values be cleared (recommended for length, buffer, price and deposit, with an ask and a notice) or ignored until the permission returns? Colour would only be ignored.
- While a member's copy is updating, should a booking on that member's calendar be refused ('This service has just been updated. Please choose your time again.') or accepted at the previous terms?
- Price snapshot backfill scope: all past and future bookings (needed for 'Bookings already made keep the price they were booked with' to hold in reports and balances) or future bookings only?
- Should group bookings be limited to calendars at the first person's venue (as specified), or split into linked bookings per venue with separate payments?
- Host transfer: move hosting 14 days after the new host accepts (as specified), or require every member to re-consent first? Should transfer ship in the first release at all?
- If the host stops being a member through a link change, should the page pause until a member takes over (as specified, ending after 30 days), or keep today's automatic transfer?
- After a collective ends, should old links show a page listing former venues (as specified, each venue can switch its listing off) or redirect to the former host's page (D25)?
- Should the host still be able to adopt a member's own booking address for the collective page (PageAddressSection), given own pages now redirect? If kept, must that member agree?
- May staff searching clients in the collective form see another venue's contacts where a link shares client details, or must details always be typed for another venue's calendar?
- Should a member's own 'All bookings' forms also be asked on services from the host (as specified), and may members add their own service-level forms to copies?
- Are online meeting links and joining information set by each venue for its own calendars (as specified), or copied from the host?
- Should host price, payment or form changes support a future effective date at member calendars, or always apply straight away (as specified)?
- Should the host be alerted to bookings made on the collective page for member calendars (without client contact details), or only the owning venue (today)?
- Venue-level settings that still differ per venue (guest self-reschedule, waitlist, reminders and templates, deposit settings, booking rules, sign-in requirement): which should the host control, which must match at accept, and which stay per venue with a 'Different at {venue}' note?
- Legal: are host prices enforced or recommended prices members may vary per calendar, and do you approve the trader line on the details, payment and confirmation steps and an unticked marketing consent on collective pages (and on every booking page)?
- May a venue without charges-capable Stripe join a collective that offers paid services, with its calendars hidden online for those services (as specified)?
- May a member re-add one of its calendars that the host removed from a service (D15)? This spec allows it and shows 'Last changed by' on both sides.
- Should members be able to reorder the 'From {host}' list for their own staff lists? This spec hides reordering there and follows the host's order.
- Should commercial and form change emails to members be mandatory (as specified) or switchable like other notices?
- Existing collectives: must each current member accept the new terms in the join dialog before the switch (recommended), or is your approval of the drift overwrite enough?
- Once the app ships consent and read-only copies, should older app builds be refused collective service management with CLIENT_TOO_OLD?

### Added by the second pass

Eight of these were answered on 2026-09-14 and have moved into the plan's §11.4 as taken decisions:
D38 (no venue chooser, refuse the invite), D39 (pooling accepted), D41 (client access shared while
live and ended with the membership), D42 (duplicate contacts, help centre only), D44 (appointments
only, built so more can be added), D49 (mutual visibility, named and consented), D50 (60-second
undo) and D51 (no scheduled changes). What they change in this document is listed under each page.

Still open:

- Where does the switch that puts new collectives into replicas mode live, given flags are stored per venue and a collective spans venues (D37)?
- Does `capacity_per_session` follow the host, or stay each venue's own (D40)? A host cannot know how many chairs a member has.
- Should the collective page offer a waitlist (D43)? It cannot today, because the synthetic venue publishes only two of its flags.
- Do we say plainly that two venues cannot share a physical room (D45)? Today the platform will double-book it.
- Does "you cannot move a booking between venues" stay, with better wording, or does a real cross-venue move get specified (D46)?
- Does the product warn when one person has a calendar at two venues in the collective and can be booked twice at once (D47)?
- Who is the canonical page for a member's address once it redirects, and does the collective page get an Open Graph image and a proper title (D48)?
- Does the Collective overview page (§2 item 15) ship with the fold, or after it? If after, the bulk lane has to stay in the combined-page manager until it lands, because without one of the two, setting up a collective gets slower rather than faster.

### What the 2026-09-14 decisions change in this document

- **§2 item 13, the staff form.** `staff.contact.otherVenue` and `staff.contact.searchOther` are retired. Inside a live collective the picker searches every member venue, names the owning venue on each result, and books against the record that already exists. Details are typed only outside a live collective.
- **§2 item 16, Reports.** `reports.collective.scope` stays, but a member sees every venue's figures too, not only its own. `reports.collective.sharedNote` becomes the standing explanation rather than a fallback, and names the venues.
- **§2 item 17, the venue chooser.** Not built. Delete the section's chooser copy and keep only `staff.invite.otherVenue`, plus a new `shell.venue.locked` for the person who is already in the broken state: "This account is linked to more than one venue, so we cannot tell which one to open. Please contact support and we will sort it out."
- **§4 J3, the join dialog.** The disclosure must now say what a partner venue can see (name, contact details, visit history, tags, notes, documents and compliance records) and that every member can see every other member's takings, and record agreement to both. New ids `join.means.clients` and `join.means.revenue`.
- **§4 J7 and J9, leave and dissolve.** Both gain a line saying what access ends: "You will no longer be able to see {venueList}'s clients or bookings, and they will no longer see yours. Everything in your own account stays exactly as it is." New id `leave.body.access`.
- **§2 item 1, the host Services page.** `ov.undo.offer` and the 60-second window are confirmed by D50 and no longer marked pending.
- **Nothing for D42.** No product copy, no banner, no warning at join. The help centre covers it.
