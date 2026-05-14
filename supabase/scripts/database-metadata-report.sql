-- Full database metadata report for staging (read-only; no app data).
-- Paste into Supabase SQL Editor. If only one result set appears, run each
-- section (between the separator comments) one at a time.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Migration history
-- ═══════════════════════════════════════════════════════════════════════════
SELECT '1_migration_history' AS report_section, version, name
FROM supabase_migrations.schema_migrations
ORDER BY version;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Installed extensions
-- ═══════════════════════════════════════════════════════════════════════════
SELECT '2_extensions' AS report_section, extname, extversion
FROM pg_extension
ORDER BY extname;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) Tables & views in public
-- ═══════════════════════════════════════════════════════════════════════════
SELECT '3_tables_views' AS report_section, table_type, table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_type, table_name;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) Columns in public (Supabase UI often caps ~1000 rows — run in batches)
-- ═══════════════════════════════════════════════════════════════════════════
-- 4a) How many rows? Run once.
SELECT '4a_columns_count' AS report_section, COUNT(*)::int AS column_row_count
FROM information_schema.columns
WHERE table_schema = 'public';

-- 4b) Batched column list — re-run only changing BETWEEN start/end (step 400).
--     Example: 1–400, 401–800, 801–1200, … until row_num_max in (4c) is null/empty.
WITH ranked AS (
  SELECT
    ROW_NUMBER() OVER (ORDER BY c.table_name, c.ordinal_position) AS row_num,
    c.table_name,
    c.ordinal_position,
    c.column_name,
    c.data_type,
    c.character_maximum_length,
    c.is_nullable,
    c.column_default
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
)
SELECT
  '4b_columns_batch' AS report_section,
  row_num,
  table_name,
  ordinal_position,
  column_name,
  data_type,
  character_maximum_length,
  is_nullable,
  column_default
FROM ranked
WHERE row_num BETWEEN 1 AND 400;

-- 4c) Optional: min/max row_num returned in your current batch (sanity check)
--     Uncomment and set the same BETWEEN as 4b.
/*
WITH ranked AS (
  SELECT ROW_NUMBER() OVER (ORDER BY c.table_name, c.ordinal_position) AS row_num
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
)
SELECT MIN(row_num) AS batch_min, MAX(row_num) AS batch_max, COUNT(*) AS batch_rows
FROM ranked
WHERE row_num BETWEEN 1 AND 400;
*/

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) Primary keys & unique constraints
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  '5_primary_unique' AS report_section,
  tc.table_name,
  tc.constraint_type,
  tc.constraint_name,
  kcu.column_name,
  kcu.ordinal_position
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
 AND tc.table_schema = kcu.table_schema
 AND tc.table_name = kcu.table_name
WHERE tc.table_schema = 'public'
  AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name, kcu.ordinal_position;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6) Foreign keys
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  '6_foreign_keys' AS report_section,
  tc.table_name,
  tc.constraint_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name,
  rc.update_rule,
  rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
 AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name
 AND ccu.table_schema = tc.table_schema
JOIN information_schema.referential_constraints rc
  ON rc.constraint_name = tc.constraint_name
 AND rc.constraint_schema = tc.table_schema
WHERE tc.table_schema = 'public'
  AND tc.constraint_type = 'FOREIGN KEY'
ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7) Indexes in public
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  '7_indexes' AS report_section,
  tab.relname AS table_name,
  idx.relname AS index_name,
  pg_get_indexdef(idx.oid) AS index_definition
FROM pg_index i
JOIN pg_class idx ON idx.oid = i.indexrelid
JOIN pg_class tab ON tab.oid = i.indrelid
JOIN pg_namespace n ON n.oid = tab.relnamespace
WHERE n.nspname = 'public'
ORDER BY tab.relname, idx.relname;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8) RLS flags per table
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  '8_rls_table_flags' AS report_section,
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
ORDER BY c.relname;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9) All RLS policies in public
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  '9_rls_policies' AS report_section,
  n.nspname AS schema_name,
  c.relname AS table_name,
  pol.polname AS policy_name,
  CASE pol.polcmd
    WHEN 'r' THEN 'SELECT'
    WHEN 'a' THEN 'INSERT'
    WHEN 'w' THEN 'UPDATE'
    WHEN 'd' THEN 'DELETE'
    WHEN '*' THEN 'ALL'
    ELSE pol.polcmd::text
  END AS command,
  pol.polpermissive AS permissive,
  ARRAY(
    SELECT rolname
    FROM pg_roles
    WHERE oid = ANY (pol.polroles)
  ) AS roles,
  pg_get_expr(pol.polqual, pol.polrelid) AS using_expression,
  pg_get_expr(pol.polwithcheck, pol.polrelid) AS with_check_expression
FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
ORDER BY c.relname, pol.polname;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10) Triggers on public
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  '10_triggers' AS report_section,
  event_object_table AS table_name,
  trigger_name,
  event_manipulation,
  action_timing,
  action_orientation,
  action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;

-- ═══════════════════════════════════════════════════════════════════════════
-- 11) Functions in public
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  '11_functions' AS report_section,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS args,
  l.lanname AS language,
  pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language l ON l.oid = p.prolang
WHERE n.nspname = 'public'
ORDER BY p.proname;

-- ═══════════════════════════════════════════════════════════════════════════
-- 12) Sequences owned by columns in public
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  '12_sequences' AS report_section,
  t.relname AS table_name,
  a.attname AS column_name,
  s.relname AS sequence_name
FROM pg_class s
JOIN pg_depend d ON d.objid = s.oid AND d.deptype = 'a'
JOIN pg_class t ON d.refobjid = t.oid
JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE s.relkind = 'S'
  AND n.nspname = 'public'
ORDER BY t.relname, a.attname;
