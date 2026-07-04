# Mobile conventions and usability audit (Reserve NI)

Short reference for responsive UI work, plus the standing mobile usability audit.
Prefer matching existing Tailwind patterns in `src/components/` and `src/app/`.

## Part 1: Touch and layout conventions

### Viewport

- Root layout exports Next.js `viewport` (`width: device-width`, `initialScale: 1`, `interactiveWidget: resizes-content`) so mobile browsers resize the layout when the on-screen keyboard opens. See [`src/app/layout.tsx`](../src/app/layout.tsx).

### Safe areas

- Fixed dashboard chrome (mobile top bar, drawer footer) uses `env(safe-area-inset-*)` so content clears notches and the home indicator.
- Global helpers in [`globals.css`](../src/app/globals.css): `pt-safe`, `pb-safe`, `pl-safe`, `pr-safe`.

### Touch targets

- Aim for at least **44×44px** for primary navigation and actions (e.g. menu toggle, tab switches, main form submit).
- Public booking flows use **`text-base` (16px) on inputs** where possible so iOS Safari does not auto-zoom on focus.

### Tables and wide grids

- When a table is wider than the viewport, wrap it in `overflow-x-auto` and optionally `touch-pan-x` for clearer horizontal scrolling.
- Use [`HorizontalScrollHint`](../src/components/ui/HorizontalScrollHint.tsx) below the `sm` breakpoint so users know they can swipe for more columns.

### Full-height shells

- Dashboard shell uses `h-[100dvh]` / `max-h-[100dvh]` with a scrollable `main` that has `min-h-0` so nested flex children can shrink and scroll correctly.

## Part 2: Usability audit

**Method:** Codebase review against a 320 / 375 / 414 / 768px matrix, plus implementation of responsive fixes (Phase A checklist from the mobile usability plan). Re-test on real devices periodically.

### Route checklist

| Area | Route / surface | 320px | 375px | 768px | Notes |
|------|------------------|-------|-------|-------|--------|
| Marketing | `/`, `#pricing`, `#contact` | OK | OK | OK | Responsive grids; horizontal padding `px-6` |
| Auth | `/login` | OK | OK | OK | `max-w-sm`, centered |
| Auth | `/signup` and steps | Review | Review | OK | Long forms; use `text-base` inputs site-wide where needed |
| Public book | `/book/[slug]` flows | Review | Review | OK | See public booking implementation pass |
| Dashboard shell | Sidebar + main | Fixed | Fixed | OK | Safe area + viewport applied in root layout |
| Dashboard | Bookings + detail panel | OK | OK | OK | Slide-over full width on mobile |
| Dashboard | Reports tables | Improved | Improved | OK | Horizontal scroll hint on narrow viewports |
| Dashboard | Day sheet tables | Improved | Improved | OK | Scroll hint wrapper |
| Dashboard | Table grid / timeline | OK | OK | OK | Uses `100dvh` in places; touch targets reviewed |
| Dashboard | Settings tabs | OK | OK | OK | Horizontal scroll on tab strip |

### Findings addressed in code

1. **Explicit viewport:** Root layout exports Next.js `viewport` (`width: device-width`, `initialScale: 1`, `interactiveWidget: resizes-content`).
2. **Safe areas:** CSS utilities for `env(safe-area-inset-*)` on fixed dashboard header, drawer, and common bottom sheets.
3. **Dashboard height:** Shell uses `min-h-[100dvh]` with `min-h-0` on scroll region to reduce mobile browser chrome issues.
4. **Data tables:** Reports (and similar) show a "scroll for more columns" hint below `sm` when tables overflow horizontally.
5. **Public inputs:** Booking funnel inputs use at least `text-base` / `min-h-[44px]` on primary fields to reduce iOS zoom-on-focus.
6. **Conventions:** Documented in Part 1 above.

### Follow-up (manual QA)

- Verify on iPhone Safari: notch, home indicator, and virtual keyboard on long forms (`/onboarding`, booking funnel).
- Floor plan / Konva: pinch and pan on a physical tablet or phone.
