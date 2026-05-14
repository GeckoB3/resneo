# ReserveNI: Linked Accounts Feature Specification

**Status:** Draft for review
**Plan scope:** Appointments plan only (Light and Plus tiers)
**Settings location:** `/dashboard/settings` → Linked Accounts tab

---

## 1. Purpose and use cases

The Linked Accounts feature allows two or more independent ReserveNI Appointments accounts to share calendar visibility, booking access, and optionally a unified booking experience, while keeping all client and booking data fully separate at rest.

Primary use cases:

- A salon owner who rents chairs to independent stylists, where each stylist has their own ReserveNI account and client list but they want to coordinate scheduling and present a unified booking experience to walk-in customers.
- Co-located independent practitioners (physiotherapists, chiropractors, beauty therapists) who want to see each other's availability to manage shared resources or refer overflow clients.
- Multi-practitioner clinics where each clinician runs their own books but the venue brand is shared.

The feature is explicitly designed around the principle that **each account remains the sovereign owner of its own data**. Linking is a relationship, not a merge.

---

## 2. Core principles

These principles govern every design decision in this specification. Any future change to the feature must preserve all of them.

1. **Data separation is absolute.** Bookings, clients, calendars, and all related data are stored only in their owning account. Linked accounts gain *visibility* and optionally *action rights*, never *ownership*.
2. **Consent is required and revocable.** Any account can refuse a link request and any account can break an existing link unilaterally at any time.
3. **Plan source governs availability.** A shared calendar exists only as long as the source account has an active subscription that includes it. Visibility is always contingent, never persistent.
4. **No data persists after unlinking.** Once a link ends, neither party can access the other's data through any UI surface. No copies are made during the link period.
5. **Every cross-account action is auditable.** Both parties to a link can see a complete record of what the other has done in their data.
6. **Permissions are explicit and granular.** Defaults are sensible but every dimension is independently controllable.

---

## 3. Eligibility and scope

- The feature is available to all Appointments plan accounts (Light and Plus).
- Restaurant plan accounts cannot create or receive link requests. The Linked Accounts tab does not appear in their settings.
- An account on a paused or expired subscription cannot create new links. Existing links remain visible in settings but are suspended (see Section 9).
- There is no hard limit on the number of accounts an Appointments account can link to. Practical UX considerations may suggest a soft warning above a threshold (e.g. 10+ links) but this is not enforced.
- There is no minimum subscription duration before an account can create or accept link requests. New accounts can use the feature immediately upon subscribing.

### 3.1 User-level authorisation within an account

Access to the Linked Accounts feature is restricted to users with the **Admin** role on a ReserveNI account. Specifically:

- The Linked Accounts tab in `/dashboard/settings` is only visible to Admin users.
- Only Admin users can create, send, accept, reject, or modify link requests.
- Only Admin users can unlink an existing link or change its permissions.
- Only Admin users can create, join, leave, or dissolve venue groups.
- Non-Admin users on an account inherit the visibility and action permissions granted by the link (i.e. if the account has read-only access to a linked calendar, all users on the account see that calendar as read-only), but cannot manage the links themselves.

**Implementation note:** This specification assumes the existence of an Admin role on ReserveNI accounts. If ReserveNI does not currently have a defined role system, this feature requires one to be introduced before build. A minimal viable role system for this feature requires at least two roles: `admin` and `staff`. The account creator is automatically Admin; additional Admins can be promoted by existing Admins.

---

## 4. Data model

### 4.1 `account_links` (pairwise relationship between two accounts)

Each row represents a single accepted, pending, or terminated link between exactly two accounts. The link defines visibility and action permissions in each direction independently.

```
account_links
├── id (uuid, pk)
├── requester_account_id (uuid, fk → accounts)
├── target_account_id (uuid, fk → accounts)
├── status (enum: pending | accepted | rejected | revoked | expired | suspended)
├── created_at (timestamptz)
├── responded_at (timestamptz, nullable)
├── terminated_at (timestamptz, nullable)
├── termination_reason (enum, nullable: 
│     unlinked_by_requester | unlinked_by_target | 
│     subscription_lapsed_requester | subscription_lapsed_target |
│     account_deleted_requester | account_deleted_target |
│     plan_ineligible)
│
│  -- Permissions in each direction (set at request, modifiable on acceptance)
├── requester_can_view_calendar (enum: none | time_only | full_details)
├── requester_can_view_pii (boolean)
├── requester_can_act (enum: none | edit_existing | create_edit_cancel)
│
├── target_can_view_calendar (enum: none | time_only | full_details)
├── target_can_view_pii (boolean)
├── target_can_act (enum: none | edit_existing | create_edit_cancel)
│
├── created_by_user_id (uuid, fk → users)
├── responded_by_user_id (uuid, fk → users, nullable)
└── UNIQUE constraint on (least(a,b), greatest(a,b)) where status IN ('pending','accepted')
```

**Notes:**
- The `pii` permission is only meaningful when `view_calendar = full_details`. When `view_calendar = time_only`, PII is implicitly hidden regardless of the flag.
- The `act` permission is only meaningful when `view_calendar = full_details` and `view_pii = true`. You cannot meaningfully edit a booking you can't see in full.
- Pending requests expire after 30 days if not actioned. A scheduled job transitions them to `expired` status.
- The unique constraint prevents duplicate active or pending links between the same pair of accounts. Once a link is `rejected`, `revoked`, or `expired`, a new request can be created.

### 4.2 `venue_groups` (multi-account combined booking surface)

A venue group represents a shared public-facing booking page combining two or more linked accounts. Venue groups are independent of pairwise links — an account can be linked to others without joining any venue group, and joining a venue group requires that all members are pairwise linked with mutual full visibility.

```
venue_groups
├── id (uuid, pk)
├── slug (text, unique) -- e.g. "glow-hair-studio" → /venue/glow-hair-studio
├── name (text)
├── host_account_id (uuid, fk → accounts) -- controls branding and slug
├── branding (jsonb) -- logo_url, primary_colour, description, etc.
├── service_grouping (enum: by_practitioner | by_service_type)
├── allow_any_practitioner_routing (boolean) -- enables "any available" option
├── created_at, updated_at
└── status (enum: active | dissolved)

venue_group_memberships
├── id (uuid, pk)
├── venue_group_id (uuid, fk → venue_groups)
├── account_id (uuid, fk → accounts)
├── status (enum: invited | active | left | removed)
├── display_order (integer)
├── services_visible (jsonb) -- array of service_ids the account agrees to expose on the venue page
├── allow_any_practitioner_substitution (boolean) -- per-account opt-in
├── joined_at, left_at (timestamptz, nullable)
└── UNIQUE(venue_group_id, account_id) where status IN ('invited','active')
```

**Constraints:**
- A venue group must have at least 2 active members to display a public booking page.
- Adding an account to a venue group requires existing accepted pairwise links with **full mutual visibility** (`view_calendar = full_details` in both directions) between the new member and every existing member. The system enforces this at insert time and reverifies on every page render.
- The host account cannot leave the group without first transferring host status to another active member or dissolving the group.
- Venue groups dissolve automatically when active membership drops below 2.

### 4.3 `link_audit_log` (cross-account action record)

Every action taken by Account A on Account B's data via a link generates an audit log entry. This log is visible to both parties.

```
link_audit_log
├── id (uuid, pk)
├── link_id (uuid, fk → account_links) -- the link under which the action was authorised
├── acting_account_id (uuid, fk → accounts) -- who did it
├── acting_user_id (uuid, fk → users)
├── owning_account_id (uuid, fk → accounts) -- whose data was affected
├── action_type (enum: 
│     viewed_calendar | viewed_booking | created_booking | 
│     edited_booking | cancelled_booking | sent_message)
├── target_resource_type (enum: booking | client | calendar | service)
├── target_resource_id (uuid)
├── before_state (jsonb, nullable) -- for edits/cancels
├── after_state (jsonb, nullable) -- for creates/edits
├── timestamp (timestamptz)
└── INDEX on (owning_account_id, timestamp DESC)
└── INDEX on (acting_account_id, timestamp DESC)
```

**Notes:**
- `viewed_calendar` and `viewed_booking` entries are written in batches (debounced) to avoid log spam. Implementation detail: dedupe by `(acting_user_id, target_resource_id)` within a 5-minute window.
- The audit log persists indefinitely. It is not deleted when a link is broken — both parties retain access to the historical record of what occurred during the link period.
- After a link is broken, both parties can still query the audit log for that link via the Linked Accounts tab → "Past links" view.
- Audit log records persist even if one of the involved accounts cancels their ReserveNI subscription. The surviving account retains full access to the log of actions taken in their own data. This is consistent with the principle that the audit log is each account's record of access to their own data.

### 4.4 RLS policy specification (Supabase)

**Critical security note:** These policies are the single source of truth for cross-account data access. They must be implemented and tested before any UI code is written for this feature.

```sql
-- BOOKINGS table: SELECT policy for linked accounts
-- Allows reading another account's bookings if there is an active link with appropriate permissions

CREATE POLICY "linked_account_can_view_bookings" ON bookings
FOR SELECT
USING (
  account_id = current_account_id() -- own data, always visible
  OR EXISTS (
    SELECT 1 FROM account_links al
    WHERE al.status = 'accepted'
    AND (
      (al.requester_account_id = current_account_id() 
       AND al.target_account_id = bookings.account_id
       AND al.requester_can_view_calendar IN ('time_only', 'full_details'))
      OR
      (al.target_account_id = current_account_id() 
       AND al.requester_account_id = bookings.account_id
       AND al.target_can_view_calendar IN ('time_only', 'full_details'))
    )
  )
);

-- BOOKINGS table: UPDATE policy for linked accounts
-- Allows editing another account's bookings only if act permission is edit_existing or higher

CREATE POLICY "linked_account_can_edit_bookings" ON bookings
FOR UPDATE
USING (
  account_id = current_account_id()
  OR EXISTS (
    SELECT 1 FROM account_links al
    WHERE al.status = 'accepted'
    AND (
      (al.requester_account_id = current_account_id() 
       AND al.target_account_id = bookings.account_id
       AND al.requester_can_act IN ('edit_existing', 'create_edit_cancel'))
      OR
      (al.target_account_id = current_account_id() 
       AND al.requester_account_id = bookings.account_id
       AND al.target_can_act IN ('edit_existing', 'create_edit_cancel'))
    )
  )
);

-- BOOKINGS table: INSERT and DELETE policies follow the same pattern
-- but require act = 'create_edit_cancel' specifically.

-- CLIENTS table: SELECT policy
-- Linked accounts can only see client records if PII visibility is granted

CREATE POLICY "linked_account_can_view_clients" ON clients
FOR SELECT
USING (
  account_id = current_account_id()
  OR EXISTS (
    SELECT 1 FROM account_links al
    WHERE al.status = 'accepted'
    AND (
      (al.requester_account_id = current_account_id() 
       AND al.target_account_id = clients.account_id
       AND al.requester_can_view_calendar = 'full_details'
       AND al.requester_can_view_pii = true)
      OR
      (al.target_account_id = current_account_id() 
       AND al.requester_account_id = clients.account_id
       AND al.target_can_view_calendar = 'full_details'
       AND al.target_can_view_pii = true)
    )
  )
);
```

**Field-level redaction (time_only mode):**

When `view_calendar = 'time_only'`, the linked account must see booking time slots but no client details, service details, or notes. RLS cannot enforce column-level access cleanly, so this is implemented via two views:

```sql
-- Full view: used when view_calendar = 'full_details' AND view_pii = true
CREATE VIEW bookings_full AS
SELECT * FROM bookings;

-- Anonymised view: used when view_calendar = 'time_only' OR view_pii = false
CREATE VIEW bookings_anonymised AS
SELECT 
  id, account_id, calendar_id, 
  start_time, end_time, status,
  CASE WHEN current_user_can_see_pii_for(account_id) 
       THEN client_id ELSE NULL END AS client_id,
  CASE WHEN current_user_can_see_service_for(account_id) 
       THEN service_id ELSE NULL END AS service_id,
  -- All other fields nullified for non-permitted viewers
FROM bookings;
```

The application layer queries the appropriate view based on the link permissions for each pair. A helper function `get_booking_view_for(viewer_account_id, owner_account_id)` returns the correct view name.

**Mutation safety:** All cross-account mutations (insert, update, delete) must:
1. Pass RLS policy checks
2. Generate a `link_audit_log` entry in the same transaction (enforced via trigger, not application code, to prevent bypass)
3. Include the `link_id` so the action is traceable to the authorising link

---

## 5. Permission model

Three orthogonal dimensions, set independently per direction on the link:

### 5.1 Calendar visibility

| Value | Meaning |
|---|---|
| `none` | Cannot see any of the other account's calendar data |
| `time_only` | Sees time-blocked slots showing busy/free, with duration. No client name, no service, no notes. |
| `full_details` | Sees full booking details: time, service, duration, status |

### 5.2 Client PII visibility

| Value | Meaning |
|---|---|
| `false` | Even with `full_details` calendar visibility, client name, phone, email, and notes are hidden |
| `true` | Full client information visible (only meaningful with `full_details`) |

### 5.3 Action permissions

| Value | Meaning |
|---|---|
| `none` | Read-only |
| `edit_existing` | Can modify existing bookings (reschedule, change service, update notes) but cannot create or cancel |
| `create_edit_cancel` | Full booking management rights |

### 5.4 Default preset

When a user creates a link request, the form is pre-populated with these defaults (in both directions, mutual):

- Calendar visibility: `full_details`
- Client PII visibility: `true`
- Action permissions: `edit_existing`

This errs toward maximum useful access while keeping cancellation/creation rights deliberate (since accidentally cancelling another account's booking is high-impact).

The user can adjust any dimension before sending. The recipient can also adjust on acceptance (see Section 6.2).

### 5.5 Constraint rules

- If `view_calendar = none`, the direction is effectively useless — the system warns the user and prevents submission unless the *opposite* direction has visibility (i.e. one-way links are valid; zero-way links are not).
- If `view_calendar = time_only`, `view_pii` is automatically forced to `false` and `act` is automatically forced to `none`. You cannot edit what you can't see in full.
- If `view_pii = false`, `act` is automatically forced to `none`. You cannot meaningfully edit bookings without seeing the client.
- These constraints are enforced both in the UI (greying out invalid combinations) and in the database (CHECK constraints).

---

## 6. Link lifecycle

### 6.1 Request creation

1. An Admin user on Account A navigates to `/dashboard/settings` → Linked Accounts tab → "Send link request". (Non-Admin users do not see this tab.)
2. User enters Account B's identifier. Decision needed: **email address of B's primary Admin**, or **a ReserveNI account ID/handle**? (See Open Questions, Section 12.)
3. User configures permissions for both directions (defaults pre-filled per Section 5.4).
4. User optionally adds a personal message ("Hi Emma, sending this so we can coordinate the salon calendar — let me know if anything looks off!").
5. User submits.

System actions on submission:
- Insert row into `account_links` with status `pending`.
- Send email notification to Account B's primary Admin email (see Section 9 for notification recipient policy).
- Surface persistent banner on Account B's dashboard, visible only to Admin users on that account.

### 6.2 Request acceptance

When Account B logs in, a persistent banner at the top of every dashboard page reads:

> **Sarah at Glow Hair Studio wants to link with you.** [Review request] [Dismiss]

"Dismiss" hides the banner for 24 hours but does not reject the request. "Review request" opens a modal showing:

- The requesting account's name and (optionally) verified business details.
- The personal message, if included.
- A clear summary of the permissions being requested in each direction:
  > **Sarah will be able to:** see your calendar with full details, see your client information, edit existing bookings.
  >
  > **You will be able to:** see Sarah's calendar with full details, see Sarah's client information, edit existing bookings.
- Three action buttons: **Accept**, **Accept with changes**, **Reject**.

"Accept with changes" opens the same permission UI used at request creation, allowing Account B to modify any dimension. On submit, the request transitions to `accepted` with the modified permissions. Account A receives an email and dashboard notification confirming the accepted permissions, with a link to view what was modified from the original request.

"Accept" applies the requested permissions verbatim and transitions to `accepted`.

"Reject" transitions to `rejected`. Account A receives a brief notification ("Your link request to [Account B] was declined"). No reason is required or surfaced.

### 6.3 Request expiry

Pending requests expire 30 days after creation. A scheduled job runs daily to mark expired requests. Both parties receive a notification on expiry.

### 6.4 Active link

Once accepted, the link appears in both accounts' Linked Accounts tab with:
- The other account's name
- Permissions granted in each direction (with a clear "you can do X" / "they can do Y" framing)
- Date the link was established
- Audit log link
- Buttons: **Edit permissions** (proposes a change, requires the other party to accept), **Unlink immediately**

### 6.5 Permission changes mid-link

Either party can propose a permission change. The change is treated similarly to a new request — the other party sees a banner asking them to accept the new permissions, with the previous permissions displayed for comparison. Until accepted, the existing permissions remain in force.

Exception: a party can *unilaterally reduce* permissions at any time without the other's consent (e.g. revoke PII access immediately if concerns arise). They cannot unilaterally *increase* permissions.

### 6.6 Termination

A link can terminate via:

| Cause | Trigger | Notification |
|---|---|---|
| Manual unlink | Either party clicks "Unlink immediately" | Email + dashboard notification to other party |
| Subscription lapse | Source account's subscription ends or downgrades to an ineligible plan | 7-day advance email warning sent when subscription is flagged as ending; immediate cutoff on actual lapse |
| Account deletion | Either account is deleted | Immediate cutoff; surviving party notified by email |
| Plan ineligibility | Currently not possible since plan switching between Appointments and Restaurant is not supported | n/a |

On termination:
- All cross-account visibility ceases immediately. Bookings, calendars, and clients of the other account disappear from the terminating party's UI.
- The audit log is preserved and remains accessible to both parties under "Past links".
- Bookings created or modified by the linked account during the link period **remain in the owning account**. They are not deleted.
- Venue group memberships dependent on this pairwise link are automatically reviewed (see Section 7.5).

### 6.7 Subscription lapse handling

When a source account's subscription is flagged for cancellation or downgrade:

- 7 days before effective date: email sent to all linked accounts notifying them of impending loss of visibility.
- On effective date: link transitions to `suspended`. Visibility ceases. Audit log preserved.
- If subscription is restored within 30 days: link automatically transitions back to `accepted` with original permissions.
- After 30 days suspended: link transitions to `expired` and is permanently terminated. Restoring would require a fresh request.

---

## 7. Venue groups (combined booking experience)

### 7.1 Concept

A venue group is a public-facing booking page that combines two or more pairwise-linked accounts under a shared brand. It provides:

- A single URL: `reserveni.com/venue/{slug}`
- Combined service browsing (grouped by practitioner or by service type, configurable)
- Optional "any available practitioner" routing for substitutable services
- Shared branding (logo, colours, description) controlled by the host account

Individual practitioner booking pages (e.g. `reserveni.com/{practitioner-slug}`) continue to exist and operate independently of the venue group. The venue group is supplementary, not replacement.

### 7.2 Eligibility to form or join

To form a venue group, all proposed members must:
- Be on the Appointments plan.
- Have accepted pairwise links with **full mutual visibility** (`view_calendar = full_details` in both directions) with every other member.
- Have explicitly opted into the venue group via an invitation flow.

The mutual full visibility requirement exists because a combined booking page must be able to show real-time availability across all members, which cannot be done with `time_only` or asymmetric visibility.

The Admin user creating the group must hold the Admin role on the host account. Invitations are sent to the primary Admin email of each invitee account and must be accepted by an Admin user on the receiving account.

### 7.2.1 Unique naming and slug constraints

Venue group names and slugs must be unique across the entire ReserveNI platform, and the slug namespace is unified with account slugs (i.e. practitioner-specific booking page slugs).

Specifically:

- **Venue group name uniqueness:** The display name of a venue group must be unique across all active venue groups. Case-insensitive comparison. Names of dissolved venue groups are released for reuse after 30 days.
- **Slug uniqueness:** The URL slug of a venue group must be unique across all venue group slugs *and* all account/practitioner booking page slugs. This prevents conflicts at `reserveni.com/{slug}` resolution. Case-insensitive, lowercase-normalised, hyphen-separated.
- **Validation:** Uniqueness is checked at name/slug entry time (live availability check as the user types) and re-validated on submission. A unique constraint at the database level enforces this as a hard guarantee.

If a user attempts to create a venue group with a name or slug that is already in use, the form displays a clear error message:

> **"Glow Hair Studio" is already in use as a venue group name. Please choose a different name.**

> **The URL "/venue/glow-hair" is not available. It may be in use by another venue group or an existing practitioner booking page. Please choose a different URL.**

The error message does not disclose *which* account or venue group is using the conflicting name, to avoid leaking information about other ReserveNI users.

The same uniqueness rules apply when an Admin renames an existing venue group.

### 7.3 Creation flow

1. Any user with at least one accepted pairwise link with full mutual visibility can navigate to Linked Accounts tab → "Create venue group".
2. They configure: name, slug (with availability check), branding (logo upload, primary colour, description), service grouping mode, "any practitioner" routing toggle.
3. They invite linked accounts to join. Each invitee receives an email and a dashboard banner.
4. Invitees accept via a flow that lets them configure: which of their services to expose, whether they allow "any practitioner" substitution for those services, display order preference.
5. Once at least 2 members have accepted, the venue page goes live.

### 7.4 Host responsibilities and transfer

The host account controls:
- Venue group name, slug, and branding
- Service grouping mode
- Whether "any practitioner" routing is enabled at the group level
- Removing members (with notification)
- Dissolving the group

Host transfer:
- Host can transfer hosting to any active member at any time. Receiving account must accept.
- If the host account leaves or is deleted, the system requires host transfer first or auto-dissolves the group.

### 7.5 Membership changes and link dependencies

If a pairwise link between two members of a venue group ends or has its permissions reduced below full mutual visibility:
- Both affected accounts are auto-removed from the venue group.
- All remaining members are notified.
- If membership drops below 2, the group is dissolved.

This cascade prevents stale or invalid configurations.

### 7.6 "Any practitioner" routing

When enabled at the group level and opted into per-service per-member:
- The venue booking page shows an "Any available practitioner" option for eligible services.
- When selected, the system finds the earliest available slot across all eligible practitioners.
- The booking is created in the chosen practitioner's account (data ownership unchanged).
- The customer receives confirmation showing which practitioner they're booked with.

### 7.7 Booking attribution and data flow

Bookings made via the venue page are always attributed to a specific practitioner's account. The venue page is a routing layer, not a data layer:

- Customer browses combined services on `/venue/glow-hair-studio`.
- Customer selects "Cut with Sarah" → booking created in Sarah's account.
- Customer selects "Any practitioner — 30-min cut" → system routes to Sarah or Emma based on availability → booking created in routed practitioner's account.

There is no concept of a "venue-level booking" that is unattributed.

### 7.8 Branding scope

The venue branding applies only to the `/venue/{slug}` page and any communications generated by bookings made through that page. Individual practitioner booking pages and communications retain their own branding.

---

## 8. UI specification

### 8.1 Linked Accounts tab structure

`/dashboard/settings/linked-accounts` (or new tab in existing settings page). **This tab is visible and accessible only to users with the Admin role on the account.** Non-Admin users do not see the tab in the settings navigation; direct URL access by non-Admins returns a 403 or redirects to the settings overview.

The tab has four sections:

1. **Active links** — list of currently accepted pairwise links. Each row shows: other account name, permissions summary, date linked, "View audit log" button, "Edit permissions" button, "Unlink" button.

2. **Pending requests** — separated into "Sent by you" and "Received from others". Each pending received request also surfaces as a banner on the main dashboard. Each row in this section can be Accept / Accept with changes / Reject (for received) or Cancel (for sent).

3. **Venue groups** — list of venue groups the account is a member of, with role (host or member), member count, status, and links to manage. "Create new venue group" button if eligible (i.e. has at least one full-mutual link).

4. **Past links** — terminated links, kept for audit access. Each row shows: other account name, period of link, termination reason, "View audit log" button. No way to reactivate from here; a fresh request is required.

### 8.2 Calendar and bookings page integration

On `/dashboard/calendar`:
- A filter/legend at the top shows all calendars currently visible, with own calendars and linked-in calendars visually distinct (e.g. own = solid colour fill, linked = patterned or desaturated).
- Each linked-in calendar can be toggled on/off in the view (visibility preference, doesn't affect the link itself).
- Bookings the viewer cannot edit show with a small lock icon on hover.
- Bookings shown in `time_only` mode display only as time blocks with the source account name (e.g. "Emma — busy") and no other detail.

On `/dashboard/bookings` (list view):
- Linked-in bookings are flagged with a clear visual indicator and a "Source: {account name}" column.
- A filter allows showing own only, linked-in only, or all.
- Bookings the viewer cannot edit have action buttons hidden or disabled.

### 8.3 Banner on incoming request

Persistent banner across all dashboard pages until actioned:

> 🔗 **{Requester name} wants to link with you.** [Review request] [Dismiss for 24h]

Reappears every 24 hours until accepted or rejected. After 30 days, the request expires automatically and the banner disappears.

### 8.4 Audit log view

Accessible per-link from the Linked Accounts tab. Shows a paginated, filterable list:

- Date/time
- Acting user (name, account)
- Action (created booking, edited booking X, viewed calendar, etc.)
- Resource affected (with link to the resource if still exists)
- Before/after diff for edits

Filters: action type, date range, acting user.

Export: CSV download of the full log.

### 8.5 Booking widget behaviour

When the account has an active pairwise link without venue group membership, the embeddable booking widget continues to show only that account's services and calendars.

When the account is a member of an active venue group, **two embed options are offered** in the widget configuration:
- "My services only" widget (existing behaviour, unchanged)
- "Venue group" widget (combined services across the venue)

Both widgets remain available; the account chooses which to embed where.

When `time_only` visibility is in effect with a linked account but no venue group exists, no combined widget is offered. The widgets remain separate.

### 8.6 Cross-suggestion when fully booked

This is a venue-group-scoped behaviour, not a pairwise-link behaviour. When a customer attempts to book on a practitioner's individual booking page and no slots are available within their requested timeframe:

- If the practitioner is a member of a venue group, the page shows: "Sarah is fully booked this week. Other practitioners at Glow Hair Studio have availability — [Try the venue page]"
- If the practitioner has pairwise links but no venue group, no cross-suggestion is offered (since pairwise links don't imply shared brand).

This avoids accidentally suggesting a competitor or a peer the practitioner doesn't want to share traffic with.

---

## 9. Notification specification

All email notifications related to the Linked Accounts feature are sent to the **primary Admin email** of the recipient account. The primary Admin email is the email address of the original account owner (the user who created the account) by default, and can be changed only by an Admin user in account settings. Dashboard banners and in-app notifications are visible only to users with the Admin role on the recipient account.

| Event | Channel(s) | Recipient |
|---|---|---|
| Link request received | Email + dashboard banner | Primary Admin email of receiving account; banner visible to all Admins |
| Link request accepted | Email + dashboard notification | Primary Admin email of requester account |
| Link request accepted with changes | Email + dashboard notification (with diff) | Primary Admin email of requester account |
| Link request rejected | Email + dashboard notification | Primary Admin email of requester account |
| Link request expired | Email | Primary Admin email of both parties |
| Link unlinked by other party | Email + dashboard notification | Primary Admin email of surviving party |
| Subscription lapse warning (7 days) | Email | Primary Admin email of all accounts linked to the lapsing account |
| Subscription lapse — link suspended | Email | Primary Admin email of all linked accounts |
| Subscription restored — link resumed | Email | Primary Admin email of all linked accounts |
| Permission change proposed | Email + dashboard banner | Primary Admin email of other party |
| Venue group invitation | Email + dashboard banner | Primary Admin email of invitee account |
| Removed from venue group | Email + dashboard notification | Primary Admin email of removed member |
| Venue group dissolved | Email | Primary Admin email of all members |

SMS notifications are **not** included in the MVP. The cost-per-message and consent considerations make this a Phase 2 decision.

All emails use existing SendGrid infrastructure with the authenticated domain.

---

## 10. Audit and compliance

### 10.1 What is logged

Every cross-account action generates a `link_audit_log` entry. Specifically:

- **Read actions:** Calendar views and booking detail views, debounced to 5-minute windows per (user, resource) pair to avoid log spam.
- **Write actions:** All booking creates, edits, and cancellations. Logged with full before/after state.
- **Communication actions:** Any messages sent to a client owned by another account (if/when the link permits).

Both parties to a link can access the full audit log at any time, including after the link is terminated.

### 10.2 GDPR posture

Linked accounts represent a controller-to-controller data sharing arrangement. Each account remains the data controller for its own clients. The link is a contractual relationship between two controllers, with:

- Explicit consent recorded (the link acceptance)
- Specified purpose (calendar coordination and booking management)
- Audit trail of all access
- Easy revocation
- Automatic data severance on termination

This should be reflected in:
- ReserveNI's Terms of Service updated to describe the linked accounts feature
- A short data sharing notice surfaced in the link acceptance modal
- Each account's privacy policy updated to mention possible linked-account access

These updates should be reviewed by your Northern Ireland commercial solicitor before launch.

### 10.3 Client-facing disclosure

There is no customer-facing disclosure when a booking is made with a practitioner whose account is part of a linked arrangement. Bookings appear to the customer as standard bookings with the practitioner they have chosen. The linked-account relationship is an operational matter between the practitioner accounts and is not surfaced to end customers.

The practitioner's privacy policy should still reflect the existence of linked-account data sharing as a general operational practice, but this disclosure is made at the policy level rather than per-booking. Practitioners should be advised (via ReserveNI onboarding documentation) to update their privacy policy accordingly when they enter into a linked-account arrangement.

---

## 11. Implementation phasing

### Phase 1 (MVP)

- Pairwise links with all three orthogonal permission dimensions
- Acceptance flow with accept / accept-with-changes / reject
- Persistent dashboard banner + email notifications
- Linked Accounts settings tab with active / pending / past sections
- Calendar and bookings page integration
- Full RLS policy implementation with `bookings_full` and `bookings_anonymised` views
- Audit log with view, filter, and CSV export
- Subscription lapse handling

### Phase 2

- Venue groups (creation, membership, dissolution)
- Combined `/venue/{slug}` booking pages
- Venue-group-scoped embeddable widget
- "Any practitioner" routing
- Cross-suggestion on no-availability (venue-group-scoped only)

### Phase 3 (post-launch, demand-driven)

- SMS notification channel for link events
- Link templates / saved permission presets
- Bulk operations (link request to multiple accounts at once)
- Analytics: which linked-in calendars are viewed most, etc.

---

## 12. Open questions for resolution before build

1. **Account identifier for link requests:** email of primary Admin, or a ReserveNI handle/account ID? Email is more familiar but couples the link to a specific user; handle is cleaner but requires a new identifier surface.

2. **Link request rate limits:** to prevent spam, should there be a cap on outgoing pending requests (e.g. max 5 pending at once) or a cooldown after rejection?

3. **Audit log retention after subscription cancellation:** if Account A unsubscribes from ReserveNI entirely, does Account B retain access to the historical audit log of A's actions in B's data? Suggested default: yes, indefinitely, since it's B's record of access to B's own data. *(Provisionally resolved — see Section 12.1 below.)*

### 12.1 Resolved decisions

The following questions raised during specification have been resolved:

- **User-level authorisation:** Only Admin users can access the Linked Accounts tab, create or accept links, or manage venue groups. See Section 3.1.
- **Notification recipient:** All email notifications go to the primary Admin email of the recipient account. See Section 9.
- **Customer disclosure:** No customer-facing disclosure on linked bookings. See Section 10.3.
- **Minimum subscription duration:** No minimum. New accounts can use Linked Accounts immediately. See Section 3.
- **Venue group and slug uniqueness:** Names must be globally unique; slugs unified with account slug namespace; clear error messages on conflict without disclosing the conflicting party. See Section 7.2.1.
- **Audit log retention:** Logs persist indefinitely, accessible to both parties even after the link is broken and even if one account cancels their subscription. See Section 10.

---

## 13. Out of scope

The following are explicitly not part of this feature:

- Merging or sharing client records across accounts. Each client lives in one account.
- Cross-account reporting or analytics dashboards spanning multiple accounts.
- Cross-account messaging or chat between linked account users.
- Shared resources (e.g. "wash basin" availability that blocks across all linked stylists).
- Cross-account staff scheduling or rota management.
- Revenue-sharing or rent-tracking between linked accounts.

Several of these may be considered for future phases, but they are not part of the linked accounts feature as specified.

---

## End of specification

This document is intended as the source of truth for the linked accounts feature. Any deviation during implementation should be reflected back into this document. Cursor agent prompts should reference specific sections by number rather than restating requirements, to ensure consistency.
