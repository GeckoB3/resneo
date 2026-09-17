# Venue API permission matrix (MVP)

Quick reference for **admin** vs **calendar-scoped staff** vs **staff with no assigned calendars**. Unauthenticated requests are omitted (401 unless noted).

**Last verified against the code: 2026-08-26.** All six matrix rows still hold. Calendar hours row added 2026-09-09 with the route (Docs/calendar-amended-hours-plan.md). Venue collective rows added 2026-09-17 (see the section below the matrix).

| Area | Route / method | Admin | Staff (managed calendar) | Staff (no calendars) |
|------|----------------|-------|---------------------------|----------------------|
| Bookings | `PATCH /api/venue/bookings/[id]` | Allowed (venue) | Allowed if booking resolves to a managed calendar | 403 if scope cannot be resolved; 403 if calendar not managed |
| Experience events | `PATCH /api/venue/experience-events` (body `id`) | Full | Edit only when event has `calendar_id` in managed set; no `new_calendar_name` | 403 / error per handler |
| Experience events | `DELETE /api/venue/experience-events` (body `id`) | Full | Delete when on managed calendar | 403 when unassigned or outside scope |
| Experience events | `PATCH/DELETE /api/venue/experience-events/[id]` | Allowed | **403** — use collection routes above | **403** |
| Experience events | `POST .../experience-events/[id]/cancel` | Allowed | **403** | **403** |
| Class instances | `POST .../class-instances/[id]/cancel` | Allowed | **403** | **403** |
| Calendar hours | `GET/PUT/DELETE /api/venue/calendar-amended-hours` | Any active host calendar; `apply_to_all_active` on PUT | Only calendars in the managed set; no `apply_to_all_active` (403) | GET returns `{ entries: [] }`; PUT/DELETE 403 |

## Services and calendar assignments in a venue collective

*Added 2026-09-17, read from the route files on `staging`.* What changes when the venue is in a collective on shared services (`venue_collectives.service_model = 'replicas'`). On a legacy (service copies) collective, and at every venue outside a collective, these routes behave as before. "Host" and "member" are the calling venue's role in its live collective; "replica" is a member's locked copy of a host service. Collective refusals carry `{ error, code }` with a full sentence. The database locks (RN001 to RN004, see `Docs/Multi_model_RLS_and_API_audit.md`) refuse the same writes if a route misses one. The mobile app's view of these routes is in `Docs/MOBILE_API.md`, "Venue collectives: what changes for the app".

| Area | Route / method | Admin | Staff (managed calendar) | Staff (no calendars) |
|------|----------------|-------|---------------------------|----------------------|
| Services | `GET /api/venue/appointment-services` | Each service may carry a `collective` block (role, collective, host, sync). A host admin also gets `collective_calendars`: every calendar in the collective, grouped by venue. | Same list and `collective` blocks; no `collective_calendars` | Same as managed-calendar staff |
| Services | `PATCH /api/venue/appointment-services` | **Host:** a save to a service on the page reaches every member through the engine; `collective_calendars` in the body assigns or unassigns calendars at any venue (409 `COLLECTIVE_REPLICA_NOT_READY` when the service is not on the page). **Member, replica:** unchanged fields, options and add-on links pass without being written, and changing which of its own calendars offer it passes; any other change is 409 `COLLECTIVE_MANAGED_SERVICE`. `expected_updated_at` from a stale copy is 412 `STALE_RESOURCE`. | As before (only the creator may change a definition, within the staff flags); `collective_calendars` is 403. The member replica rule applies on top. | 403 when no calendars are managed |
| Services | `DELETE /api/venue/appointment-services` | **Host:** a service on the page is 409 `COLLECTIVE_OFFERED_SERVICE` (take it off the page first). **Member:** a replica is 409 `COLLECTIVE_MANAGED_SERVICE`. Both come from the database refusal (RN002, RN001). | As before (creator only, calendar scope), with the same refusals | 403 |
| Calendar assignments | `PUT /api/venue/practitioner-services` | Any calendar at the venue. A member may tick or untick a replica on its own calendars. Without `expected_service_ids`, a set that would drop a service another venue gave this calendar in the last 24 hours is 412 `STALE_RESOURCE` and writes nothing; with it, any mismatch is 412. Removing a service with future bookings answers 409 with them until `?acknowledge_affected_bookings=true`. | Only calendars in the managed set (403 otherwise), same rules | 403 |
| Calendar values | `PATCH /api/venue/practitioner-service-overrides` | Any calendar at the venue (`calendar_id` required); all seven `custom_*` values stored whatever the flags say. Values apply only while the service's matching `staff_may_customize_*` flag is on (D56), and on offered services the naming flags are forced off (D29). Cannot reach another venue's calendar. | Own managed calendar; each value only while its flag is on (403 otherwise) | 403 |
| Add-on groups | `PATCH` / `DELETE /api/venue/addon-groups/{id}` | Allowed, except a member's managed copy of a host group: 409 `COLLECTIVE_MANAGED_ADDON_GROUP` | 403 (admin only) | 403 |
| Forms | `PATCH /api/venue/compliance/types/{id}`, `POST .../versions`, `.../archive`, `.../restore` | Allowed, except a member's managed copy of a host form: 409 `COLLECTIVE_MANAGED_COMPLIANCE_TYPE`. `GET` is unchanged. | 403 (admin only) | 403 |
| Staff booking | `GET /api/venue/staff-collective` | `calendar_ids` lists every active people calendar of the live collective's eligible venues, the caller's own included, so every diary column opens the collective form | Same | Same |
| Bookings | `POST /api/venue/bookings/{id}/move-venue` | Moves a plain booking to a calendar at another venue of the same live collective (both service models). Needs the right to cancel the booking (own venue, or a link with `create_edit_cancel`) and create scope at the target venue. 409 `COLLECTIVE_MOVE_ATTACHED` (not Booked or Confirmed; part of a visit or group; any deposit, card hold or payment; a completed form), `COLLECTIVE_MOVE_SERVICE`, `COLLECTIVE_MOVE_NOT_ALLOWED`; 400 for a same-venue calendar or a past date. | **Same as admin: the route and `moveBookingToCollectiveVenue` do not check the managed-calendar set**, unlike `PATCH /api/venue/bookings/[id]` | Same as admin |

**Collective management routes.** Every route under `/api/venue/collectives/` resolves the caller through `resolveLinkAdmin`, so staff who are not admins get 403 ("Only venue admins can manage linked accounts."). Among admins:

| Route / method | Who may call it |
|----------------|-----------------|
| `PATCH /api/venue/collectives/{id}` (settings) | Host admin (403 otherwise) |
| `DELETE /api/venue/collectives/{id}` (end) | Host admin; on shared services runs `collective_dissolve` |
| `PATCH .../members` `invite`, `remove` | Host admin. On shared services `remove` releases an active member through the engine, or withdraws an open invitation. |
| `PATCH .../members` `accept`, `decline` | The invited venue's admin. On shared services `accept` needs the join dialog's `consent_version` (409 `COLLECTIVE_CONSENT_REQUIRED` otherwise). |
| `PATCH .../members` `leave` | A member admin; the host cannot leave (400). On shared services it releases through the engine. |
| `PATCH .../members` `offer_host`, `cancel_host_transfer`, `accept_host`, `decline_host`, `take_over_hosting` | Engine calls on shared services: the host offers or cancels, the member asked accepts, declines or cancels, and a member takes over a paused collective. `transfer_host` is refused on shared services. |
| `PATCH .../members` `configure` | A member admin (legacy listing settings), or a former member choosing `list_on_old_page` after the end |
| `GET .../join` | Admin of a venue with an open invitation (404 otherwise); 409 on the legacy model |
| `GET .../leave` | Admin of an active venue in the collective (404 otherwise); 409 on the legacy model. The Leave dialog's summary. |
| `GET .../catalogue` | Host or member admin (403 otherwise). `PATCH`: host admin only; on shared services unlink is 409 `COLLECTIVE_REPLICAS_ALWAYS_FOLLOW` and sync is a no-op. |
| `GET` / `POST .../offerings`, `DELETE .../offerings/{itemId}`, `POST .../calendars`, `PUT .../calendar-values`, `POST .../bulk`, `POST .../bulk/preview`, `POST .../replicas/retry`, `POST .../undo` | Host admin of an active shared-services collective (`requireReplicasHost`): 403 `COLLECTIVE_NOT_HOST` otherwise, 409 `COLLECTIVE_LEGACY_MODEL` on the legacy model. `POST .../calendars` is the only route that writes another venue's calendar assignments. |
| `GET .../adoptions`, `GET` / `POST .../adoptions/{itemId}`, `POST .../suggestions`, `POST .../address-adoption` | Admin of an active member venue (`memberAdoptionContext`): 404 otherwise, 409 `COLLECTIVE_LEGACY_MODEL` on the legacy model |
| `GET .../history` | Host admin, or admin of an active member (403 otherwise; a venue that has left cannot read it) |
| `POST` / `DELETE .../page-asset` | Host admin (403 otherwise) |

**Notes**

- “Managed calendar” means the staff member’s assigned team calendars (`getStaffManagedCalendarIds` / `requireManagedCalendarAccess`).
- Dashboard UI should hide admin-only actions (e.g. cancel-with-notifications) for non-admins; APIs remain the source of truth.
- The former standalone `POST /api/venue/classes/generate-instances` route was removed in the timetable rebuild, and `src/app/api/venue/classes/route.timetable-removed.test.ts` guards against it returning. Class instances are **not** created by `POST /api/venue/classes`, which inserts only a `class_types` row (`route.ts:413`); they are created by `POST /api/venue/class-instances` (`route.ts:68`) and `POST /api/venue/class-instances/bulk` (`route.ts:137`). *(Corrected 2026-08-26.)*

**Related:** for public-vs-staff booking routes and silent-auth signup behaviour, see [`ACCOUNT_PUBLIC_VS_STAFF_ROUTES.md`](ACCOUNT_PUBLIC_VS_STAFF_ROUTES.md).
