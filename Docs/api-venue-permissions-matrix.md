# Venue API permission matrix (MVP)

Quick reference for **admin** vs **calendar-scoped staff** vs **staff with no assigned calendars**. Unauthenticated requests are omitted (401 unless noted).

| Area | Route / method | Admin | Staff (managed calendar) | Staff (no calendars) |
|------|----------------|-------|---------------------------|----------------------|
| Bookings | `PATCH /api/venue/bookings/[id]` | Allowed (venue) | Allowed if booking resolves to a managed calendar | 403 if scope cannot be resolved; 403 if calendar not managed |
| Experience events | `PATCH /api/venue/experience-events` (body `id`) | Full | Edit only when event has `calendar_id` in managed set; no `new_calendar_name` | 403 / error per handler |
| Experience events | `DELETE /api/venue/experience-events` (body `id`) | Full | Delete when on managed calendar | 403 when unassigned or outside scope |
| Experience events | `PATCH/DELETE /api/venue/experience-events/[id]` | Allowed | **403** — use collection routes above | **403** |
| Experience events | `POST .../experience-events/[id]/cancel` | Allowed | **403** | **403** |
| Class instances | `POST .../class-instances/[id]/cancel` | Allowed | **403** | **403** |

**Notes**

- “Managed calendar” means the staff member’s assigned team calendars (`getStaffManagedCalendarIds` / `requireManagedCalendarAccess`).
- Dashboard UI should hide admin-only actions (e.g. cancel-with-notifications) for non-admins; APIs remain the source of truth.
- Class instances are now generated inside `POST /api/venue/classes`; the former standalone `POST /api/venue/classes/generate-instances` route was removed in the timetable rebuild.

**Related:** for public-vs-staff booking routes and silent-auth signup behaviour, see [`ACCOUNT_PUBLIC_VS_STAFF_ROUTES.md`](ACCOUNT_PUBLIC_VS_STAFF_ROUTES.md).
