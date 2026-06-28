# ResNeo — project guide for Claude

## User-facing copy

- **Never use em-dashes (—, U+2014) in any user-facing copy.** This applies to every string a user or guest can read: help articles, figure labels and captions, UI text, button labels, emails, SMS, marketing copy, and error messages. Rewrite instead with a comma, colon, full stop, parentheses, or the word "to". (En-dashes in numeric/time ranges like `9:00–17:00` are acceptable; this rule is specifically about the em-dash used as punctuation.)
- Write in plain, warm, second-person language aimed at non-technical business owners. Prefer short sentences and concrete, numbered steps.

## Help centre (`/help`)

- Articles are authored as markdown strings in `src/lib/help/articles/*.ts` and rendered through `HelpArticleContent`.
- The **Getting started** hub (`src/lib/help/articles/getting-started.ts`) and the **Appointments** category support inline figures: put a `:::help-figure <id>` marker on its own line, then define that figure as a hand-built SVG component.
  - Getting started figures: `src/components/help/getting-started-figures/GettingStartedHelpFigures.tsx`
  - Appointments figures: `src/components/help/appointments-figures/AppointmentsHelpFigures.tsx`
- Figures are hand-built SVG schematics that mirror the real screens, using the brand tokens (`--brand` navy `#003B6F`, `--accent` teal `#00C2C7`). Keep every label accurate to the live UI. No em-dashes in figure text or captions.
- The Getting started hub targets **appointments businesses** (salons, clinics, studios, practitioners). Do not add restaurant or table-reservation content there.
