# Development notes

Important conventions and context for building Resneo. Extend this file as needed.

## User-facing copy

Do not use em dashes (—) in user- or customer-facing text (UI, emails, marketing, in-app help). Prefer colons, commas, parentheses, or separate sentences instead.

## Scheduled jobs (Vercel Cron)

Cron routes live under `src/app/api/cron/*/route.ts` and are registered in `vercel.json`. They use `requireCronAuthorisation()` (`src/lib/cron-auth.ts`): in production, set `**CRON_SECRET**` on the project and Vercel will invoke crons with `Authorization: Bearer <CRON_SECRET>`.

**Account hard delete** (`GET`/`POST` `/api/cron/account-hard-delete`): runs daily (05:00 UTC in `vercel.json`). Processes users whose `user_profiles.deleted_at` grace timestamp has passed, anonymises any remaining linked `guests` rows, then deletes the auth user via the Supabase secret key. Requires `**CRON_SECRET**`, `**SUPABASE_SECRET_KEY**`, and a deployed Supabase project where `user_profiles` / `guests` match the migrations.

**Release card holds** (`GET`/`POST` `/api/cron/release-card-holds`): runs daily (05:30 UTC in `vercel.json`). Expiry backstop for card-hold deposits (design doc §12.3): releases open `booking_card_holds` rows (`released_at IS NULL`) whose booking ended more than `CARD_HOLD_CHARGE_WINDOW_DAYS` (14) days ago, whatever the booking status. The charge window is derived from the booking's end (`src/lib/booking/card-hold-window.ts`), never stored; batches are bounded (200 oldest per run). Releasing stamps `released_at` / `release_reason: 'expired'`, inserts `card_hold_released` events, and best-effort deletes the booking-scoped Stripe customer (last open hold on a shared customer wins; Stripe failures log and continue). Requires `**CRON_SECRET**` and Stripe credentials.

**Venue hard delete** (`GET`/`POST` `/api/cron/venue-hard-delete`): runs daily (05:15 UTC in `vercel.json`). Processes venues whose `venues.deletion_scheduled_at` grace timestamp has passed: purges all venue storage objects (covers, logos, gallery, team/service photos, floor-plan backgrounds, guest documents, imports, compliance files via `purgeVenueStorage`), cancels the Stripe subscription, then calls `admin_hard_delete_venue` (which terminates linked accounts and notifies partner venues). A storage-purge failure leaves the venue queued for retry rather than orphaning files. Self-serve entry point: Settings -> Plan -> "Delete this venue" (admin only), backed by `POST /api/venue/delete-request` and `/cancel`, which set a 30-day grace and `cancel_at_period_end` on Stripe.