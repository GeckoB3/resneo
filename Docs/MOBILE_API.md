# Mobile API — Bearer auth for venue routes

The React Native app (`reserveni-app`) authenticates with Supabase and sends `Authorization: Bearer <access_token>` on API requests. Venue route handlers use `createVenueRouteClient(request)` from `@/lib/supabase/venue-route-client`, which reads the Bearer header and falls back to session cookies (web dashboard).

## Migrated routes (P0)

| Method | Path |
|--------|------|
| GET | `/api/venue` |
| GET | `/api/venue/staff/me` |
| GET | `/api/venue/dashboard-home` |
| GET | `/api/venue/bookings/list` |
| POST | `/api/venue/bookings` |
| GET, POST | `/api/venue/bookings/walk-in` |
| GET, PATCH, DELETE | `/api/venue/bookings/[id]` |
| GET | `/api/venue/bookings/[id]/summary` |
| GET | `/api/venue/guests` |
| GET | `/api/venue/guests/[guestId]` |
| GET | `/api/venue/appointment-availability` |

### Public endpoint (unchanged)

`GET /api/booking/appointment-catalog` is a public guest-facing endpoint (no auth). It uses the admin client and does not require Bearer tokens.

## Example request

```bash
curl -sS \
  -H "Authorization: Bearer <access_token>" \
  https://reserveni.com/api/venue/staff/me
```

Expect `200` with a JSON body containing the staff object, e.g. `{ "staff": { "id", "email", "name", "phone", "role", ... } }`.

## Adding new venue routes

Any new `/api/venue/*` route handler that needs staff authentication should use:

```typescript
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';

export async function GET(request: NextRequest) {
  const supabase = await createVenueRouteClient(request);
  const staff = await getVenueStaff(supabase);
  // ...
}
```

Do **not** use `createClient()` in new venue route handlers — that reads cookies only and will return `401` for mobile clients.

## Manual setup (Supabase dashboard)

Add the mobile deep link to **Authentication → URL Configuration → Redirect URLs**:

```
reserveniapp://callback
```

Required for magic-link sign-in from the mobile app.
