-- Guard the legacy service sync columns until the engine retires them
-- (Docs/collective-one-venue-plan.md §8.2 item 4; Pass 0).
--
-- `service_items.synced_from_service_id`, `sync_state` and `synced_at` (20270209120000) decide
-- which service a member's copy follows: every save of the origin writes its shape onto the copy.
-- Two gaps:
--
--   * A CLIENT ROLE COULD WRITE THEM. `staff_manage_service_items` is `FOR ALL`, so staff signed
--     in with their own session (PostgREST, not the app) could point their copy at any service
--     on the platform, or mark it `linked`, and receive pushes from it. The app never does: every
--     writer (`service-duplication.ts`, `service-sync.ts`, `PATCH /api/venue/appointment-services`)
--     uses the service-role client and checks the host first (SB-15). This trigger refuses the
--     same change from `anon` or `authenticated`.
--   * NOTHING STOPPED A SERVICE FOLLOWING ITSELF, which would make every save re-sync onto itself.
--
-- The columns are retired in C2 (plan §8.2), after the engine's replica links replace them.

-- A service never follows itself. Added NOT VALID so an environment holding a bad row still
-- migrates; it is validated straight away when no row violates it (staging 2026-09-15: none).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_items_sync_not_self') THEN
    ALTER TABLE public.service_items
      ADD CONSTRAINT service_items_sync_not_self
      CHECK (synced_from_service_id IS NULL OR synced_from_service_id <> id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.service_items WHERE synced_from_service_id = id) THEN
    ALTER TABLE public.service_items VALIDATE CONSTRAINT service_items_sync_not_self;
  ELSE
    RAISE WARNING 'service_items_sync_not_self left NOT VALID: % row(s) follow themselves',
      (SELECT count(*) FROM public.service_items WHERE synced_from_service_id = id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.guard_service_items_sync_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- No claim at all (a direct database session, a migration) is the server too. Without the
  -- coalesce, `NULL NOT IN (...)` is not true and every such write would be refused.
  IF coalesce(auth.role(), '') NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.synced_from_service_id IS NOT NULL
       OR NEW.sync_state IS DISTINCT FROM 'independent'
       OR NEW.synced_at IS NOT NULL THEN
      RAISE EXCEPTION 'service sync columns are maintained by the server'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.synced_from_service_id IS DISTINCT FROM OLD.synced_from_service_id
     OR NEW.sync_state IS DISTINCT FROM OLD.sync_state
     OR NEW.synced_at IS DISTINCT FROM OLD.synced_at THEN
    RAISE EXCEPTION 'service sync columns are maintained by the server'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_service_items_sync_columns() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_service_items_sync_columns ON public.service_items;
CREATE TRIGGER trg_guard_service_items_sync_columns
  BEFORE INSERT OR UPDATE OF synced_from_service_id, sync_state, synced_at ON public.service_items
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_service_items_sync_columns();
