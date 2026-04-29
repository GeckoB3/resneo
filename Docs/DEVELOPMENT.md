# Development notes

Important conventions and context for building ReserveNI. Extend this file as needed.

## User-facing copy

Do not use em dashes (—) in user- or customer-facing text (UI, emails, marketing, in-app help). Prefer colons, commas, parentheses, or separate sentences instead.

## Scheduled jobs (Vercel Cron)

Cron routes live under `src/app/api/cron/*/route.ts` and are registered in `vercel.json`. They use `requireCronAuthorisation()` (`src/lib/cron-auth.ts`): in production, set `**CRON_SECRET**` on the project and Vercel will invoke crons with `Authorization: Bearer <CRON_SECRET>`.

**Account hard delete** (`GET`/`POST` `/api/cron/account-hard-delete`): runs daily (05:00 UTC in `vercel.json`). Processes users whose `user_profiles.deleted_at` grace timestamp has passed, anonymises any remaining linked `guests` rows, then deletes the auth user via the service role. Requires `**CRON_SECRET`**, `**SUPABASE_SERVICE_ROLE_KEY**`, and a deployed Supabase project where `user_profiles` / `guests` match the migrations.