# Performance baseline and measurement

Use this checklist before and after performance-related changes.

## Server/API timings

Set `DEBUG_PERF_API=1` when running `next dev` or `next start`. Several routes log `[perf] …` with elapsed milliseconds, including:

- `GET /api/venue/dashboard-home`
- `GET /api/venue/day-sheet`
- `GET /api/booking/availability` (existing)

Example (PowerShell):

```powershell
$env:DEBUG_PERF_API='1'; npm run dev
```

## Bundle size

After meaningful import splits (e.g. dynamic `recharts`):

```bash
npm run build
```

Inspect the build output table for First Load JS per route. For deeper analysis you can add `@next/bundle-analyzer` locally and wrap `next.config.ts` — not bundled in this repo by default.

## Web Vitals / Lighthouse

Manually run Lighthouse (Chrome DevTools) against:

- `/dashboard`, `/dashboard/bookings`, `/dashboard/calendar`, `/dashboard/day-sheet`
- `/book/<venue-slug>`, `/embed/<venue-slug>`

Record LCP, INP (or TBT in lab), and CLS. Compare on the same machine/network where possible.
