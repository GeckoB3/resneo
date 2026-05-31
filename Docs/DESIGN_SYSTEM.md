# Reserve NI Design System

**Version:** 1.0 (foundation slice)  
**Date:** May 2026  
**Code:** `src/components/ui/primitives/` · `src/components/ui/dashboard/` · `src/app/globals.css`

This document covers the **UI foundation slice** primitives and rules. Broader IA, calendar polish, and marketing unification live in [UI_EXCELLENCE_REVIEW_AND_PLAN.md](./UI_EXCELLENCE_REVIEW_AND_PLAN.md).

---

## Component locations

| Area | Path | Use for |
|------|------|---------|
| **Primitives** | `src/components/ui/primitives/` | Button, Dialog, Sheet, FormField, Input — overlays and forms |
| **Dashboard** | `src/components/ui/dashboard/` | PageFrame, PageHeader, SectionCard, EmptyState, Pill, TabBar |
| **Legacy** | Ad hoc Tailwind in feature files | Migrate when touched; do not copy patterns into new code |

---

## Design tokens

Defined in `src/app/globals.css`.

### Brand & surfaces

- `--brand` / `--color-brand-600`: ResNeo Night — primary actions, links, headings (`#003B6F`)
- `--accent` / `--color-accent-500`: Neo Teal — accent labels, highlights, the wordmark (`#00C2C7`)
- `--surface-secondary` / `--surface-sunken`: Slate Gray app surfaces (`#F4F6F9`)
- `--surface-raised`, `--ds-shadow-card`, `--ds-radius-card`: dashboard cards

### Typography

- **Primary font:** Inter (loaded in `src/app/layout.tsx`, exposed as `--font-geist-sans` / Tailwind `font-sans`).
- **Body copy:** 16px baseline, regular (400) weight, dark slate (`--foreground`).
- **H1 / H2:** extra-bold (800) in ResNeo Night.
- **H3:** medium (500) in ResNeo Night (Neo Teal reserved for accent labels).
- Heading colour/weight is enforced via unlayered rules in `globals.css`; white/gradient headings on dark sections are preserved with `text-white` / `text-transparent`.

### Z-index

| Token | Value | Use |
|-------|-------|-----|
| `--z-dropdown` | 50 | Menus, popovers |
| `--z-modal` | 70 | Dialog, Sheet |
| `--z-toast` | 80 | Toast notifications |

Use Tailwind `z-[var(--z-modal)]` or primitive components — avoid arbitrary `z-[9999]`.

### Type scale

`--font-size-xs` through `--font-size-3xl` for consistent typography when not using Tailwind text utilities.

### Motion

- `--duration-fast`: 150ms — hovers, toggles
- `--duration-normal`: 200ms — panel open/close

---

## Overlay primitives

### When to use what

| Pattern | Component | Example |
|---------|-----------|---------|
| Confirm / auth / staff booking | `Dialog` | RequireAuthModal, WalkInModal |
| Booking detail from list | `Sheet` (right drawer) | BookingDetailSurface `presentation="drawer"` |
| Mobile-full booking detail | `Dialog` size `lg` | BookingDetailSurface `presentation="modal"` |
| Calendar click (anchored) | `BookingDetailPopover` (legacy positioning) | BookingDetailSurface `presentation="popover"` |
| Destructive confirm | `Dialog` + `Button variant="danger"` | Cancel booking, delete area |

### Migration rule (required)

**Do not add new hand-rolled modal shells** (`fixed inset-0` + `role="dialog"`). Use `Dialog` or `Sheet` from primitives.

CI (GitHub Actions): `npm run lint:modals` and `npm run test` on every PR. For a fast local check: `npm run test:ui-foundation`.

### Dialog manual a11y checklist

Before shipping a new Dialog:

- [ ] Focus moves into dialog on open
- [ ] Tab cycles within dialog only
- [ ] Escape closes (unless explicitly disabled)
- [ ] Title has `aria-labelledby` (built into primitive)
- [ ] Primary action is a `<button type="button">` or `type="submit"` in a form

---

## Button

```tsx
import { Button } from '@/components/ui/primitives';

<Button variant="primary" size="md">Save</Button>
<Button variant="danger" loading>Deleting…</Button>
```

| Variant | Use |
|---------|-----|
| `primary` | Main CTA |
| `secondary` | Secondary actions |
| `ghost` | Toolbar, low emphasis |
| `danger` | Irreversible confirm |
| `link` | Inline text actions |

---

## FormField

```tsx
<FormField label="Email" error={errors.email} required>
  <Input type="email" {...register('email')} />
</FormField>
```

Associates label, description, and error via `aria-describedby` / `aria-invalid`.

---

## Ladle (component playground)

```bash
npm run ladle
```

Stories live in `src/components/ui/primitives/*.stories.tsx`.

## Out of scope (this slice)

- Sidebar IA redesign
- Calendar card density — `BookingCard` with `density` (`compact` | `comfortable`) and `layout` (`reception` | `legacy`) in `src/app/dashboard/practitioner-calendar/BookingCard.tsx`
- Settings `neutral-*` → `slate-*` migration
- Command palette
- Full Storybook catalogue (Ladle covers primitives only)

---

## Related documents

- [UI_EXCELLENCE_REVIEW_AND_PLAN.md](./UI_EXCELLENCE_REVIEW_AND_PLAN.md)
- [Resneo-Appointments-Review-And-Roadmap.md](./Resneo-Appointments-Review-And-Roadmap.md) — P0.1, P0.2
- `.cursor/rules/frontend.mdc` — mobile, accessibility, loading states
