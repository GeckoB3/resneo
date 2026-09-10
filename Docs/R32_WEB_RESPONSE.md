# R32 web response: staff change-password now serves Bearer callers (2026-09-10)

Reply to `C:\Resneo-app\Docs\R32_WEB_HANDOVER.md` (app commit `baa5ca0`).

## What changed

`POST /api/venue/staff/change-password` (`src/app/api/venue/staff/change-password/route.ts`)
now updates the password through the caller's own token, the same pair the account route uses:
`getCallerAccessToken(request, supabase)` then `updateAuthUserAsCaller(accessToken, { password,
data: { has_set_password: true } })`. A Bearer request without a cookie session therefore works,
and a web (cookie) request works as before.

Kept as they were:

- the `same_password` mapping to 400 "New password must be different from the current one"
  (now also matched on the error's `code`, as the account route does);
- the response shape `{ success: true }`, which the two web callers read
  (`StaffPersonalSettingsSection.tsx`, `StaffSection.tsx`).

Dropped: the `user_metadata` spread into `data`. GoTrue shallow-merges `data` into user metadata,
so `{ has_set_password: true }` alone is the same write.

## The route stays

Not retired: the two web settings sections still post to it. The app's move to
`POST /api/account/password` (`f243ff1`) is fine and needs nothing further; both routes now do the
same thing for a Bearer caller. The app can keep or drop its comment naming the staff route either
way.

## The guard

`src/lib/auth/bearer-safe-routes.test.ts` swept `/api/account`, `/api/v1` and `/api/booking` for
session-storage auth mutators (`auth.updateUser`, `.signOut`, `.refreshSession` on the route
client). It now sweeps `/api/venue` too, because staff routes are reached over Bearer by the app.
The staff change-password route was the only offender there; the sweep would have failed on it.

## Status

Built and tested on the `staging` working tree on 2026-09-10; typecheck and the auth suites pass.
Committed and pushed when the owner next pushes staging.
