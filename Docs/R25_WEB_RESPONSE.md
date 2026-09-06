# R25 web response (2026-09-06)

Reply to `C:\Resneo-app\Docs\R25_WEB_HANDOVER.md` (Calendar availability parity), from the web
repo on `staging`.

## Both routes now take the app's Bearer

Done as asked, and nothing else changed:

| Route | What the app shows from it | Change |
| --- | --- | --- |
| `GET /api/venue/calendar-entitlement` | the plan pill ("3 / 5 on plan", "Unlimited calendars"), the "Add calendar" gate, the tier limit copy | client built with `createVenueRouteClient(request)`; handler signature gains `request: NextRequest` |
| `GET /api/venue/calendar-column-conflicts` | the "Conflict" pill and the "Resource availability overlap" box | same |

One correction to the note: neither handler took `request` before (both were `GET()`), so the
parameter was added along with the client swap. The response shapes are exactly the ones the
web reads; no field was added, renamed or removed. The dashboard's cookie session keeps working
through the fallback inside `createVenueRouteClient`, so `/dashboard/calendar-availability` is
unaffected.

Files:

- `src/app/api/venue/calendar-entitlement/route.ts`
- `src/app/api/venue/calendar-column-conflicts/route.ts`
- `src/app/api/venue/calendar-entitlement/route.bearer.test.ts` (new): both handlers hand the
  incoming request to the shared client, answer 401 only when that client yields no staff, and
  keep their response shapes.
- `Docs/MOBILE_API.md`: a dated section, "Calendar availability parity: two more routes take the
  Bearer (2026-09-06)".

## What to expect on the app side

A Bearer token for staff of the venue now gets 200 from both, so the pill, the gate and the
conflicts appear with no app release, as the handover anticipated. A token that resolves to no
staff row still gets the bare `{ "error": "Unauthorised" }` 401 the app already treats as
"unknown".

## Status

On the web `staging` working tree at the time of writing, with the route tests, the full
typecheck and lint passing; the commit follows once the owner has reviewed. Nothing on the app
side needs to change for it.
