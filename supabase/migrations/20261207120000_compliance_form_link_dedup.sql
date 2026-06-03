-- Reserve NI: enforce one pending compliance form link per (venue, guest, type).
--
-- issueOrReuseFormLink (spec §5.2) reads-then-inserts: two concurrent callers (e.g.
-- booking auto-send racing a manual staff send, or two group siblings) could both
-- find "no existing pending link" and both insert, leaving the guest with duplicate
-- live links for the same form. This adds the missing DB-level guarantee.
--
-- 1. Resolve any pre-existing duplicates by revoking all but the newest pending link
--    per (venue_id, guest_id, compliance_type_id) so the unique index can be created.
-- 2. Create a partial UNIQUE index over pending links only (consumed/expired/revoked
--    links are intentionally allowed to repeat). The service handles 23505 from this
--    index by re-selecting and reusing the winning link.

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY venue_id, guest_id, compliance_type_id
      ORDER BY created_at DESC, id DESC
    ) AS rn
  FROM public.compliance_form_links
  WHERE status = 'pending'
)
UPDATE public.compliance_form_links l
SET status = 'revoked'
FROM ranked
WHERE l.id = ranked.id
  AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_compliance_form_links_pending
  ON public.compliance_form_links (venue_id, guest_id, compliance_type_id)
  WHERE status = 'pending';
