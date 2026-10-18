-- M7-1 (decision T4): Postgres Row-Level Security as a second layer of
-- tenant isolation behind the app-level workspace scoping.
--
-- How it works: the API sets two transaction-local settings before it touches
-- the database (database/rls-adapter.ts):
--   app.workspace_id  the current workspace (uuid as text)
--   app.rls_bypass    'on' only inside the few reviewed cross-tenant code
--                     paths (runAsSystem in the API)
-- A setting that is missing or empty matches nothing: no rows are visible
-- and no row can be written (fail closed, never "all rows").
--
-- Safe to run on a database whose app role already exists, and safe to run
-- as a role that cannot create roles (the grants are then skipped; see
-- docs/design/m7-1-rls-plan.md for the manual statements).

-- ───────────────────────── helper functions ─────────────────────────

CREATE OR REPLACE FUNCTION app_workspace_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.workspace_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_rls_bypass() RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT COALESCE(current_setting('app.rls_bypass', true), '') = 'on' $$;

-- ───────────────────────── policies ─────────────────────────
-- FORCE makes the policies apply to the table owner too (Render's default
-- user is the owner), so a mis-set DATABASE_URL still cannot see across
-- workspaces. Superusers and BYPASSRLS roles are never subject to them.
-- (SELECT …) makes Postgres evaluate each function once per query, not once
-- per row, so indexes on workspace_id stay usable.

-- Tables with a workspace_id column.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'workspace_members', 'chatbots', 'chatbot_versions', 'faqs',
    'custom_answers', 'knowledge_sources', 'products', 'knowledge_chunks',
    'workspace_llm_keys', 'conversations', 'messages', 'usage_counters',
    'leads'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING ((SELECT app_rls_bypass()) OR workspace_id = (SELECT app_workspace_id()))
         WITH CHECK ((SELECT app_rls_bypass()) OR workspace_id = (SELECT app_workspace_id()))',
      t);
  END LOOP;
END $$;

-- The tenant itself: its own row only.
ALTER TABLE "workspaces" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workspaces" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "workspaces";
CREATE POLICY tenant_isolation ON "workspaces"
  USING ((SELECT app_rls_bypass()) OR id = (SELECT app_workspace_id()))
  WITH CHECK ((SELECT app_rls_bypass()) OR id = (SELECT app_workspace_id()));

-- Platform audit trail: it carries a workspace_id but belongs to the
-- platform team, so only the bypass (platform-admin code) may touch it.
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_only ON "audit_logs";
CREATE POLICY platform_only ON "audit_logs"
  USING ((SELECT app_rls_bypass()))
  WITH CHECK ((SELECT app_rls_bypass()));

-- ───────────────────────── the app role ─────────────────────────
-- brainstack_app: what the API connects as at runtime. Not a superuser, not
-- BYPASSRLS, cannot change the schema. Created without a login: whoever
-- operates the database sets the password (ALTER ROLE … LOGIN PASSWORD …).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'brainstack_app') THEN
    BEGIN
      CREATE ROLE brainstack_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'Could not create role brainstack_app (no CREATEROLE). Create it by hand: see docs/design/m7-1-rls-plan.md';
    END;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'brainstack_app') THEN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO brainstack_app', current_database());
    GRANT USAGE ON SCHEMA public TO brainstack_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO brainstack_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO brainstack_app;
    -- Prisma's own bookkeeping is not the app's business.
    REVOKE ALL ON TABLE "_prisma_migrations" FROM brainstack_app;
    -- Tables created by later migrations (by whoever runs them) are granted
    -- automatically; their policies still have to be written, which the
    -- tenant-models guard test enforces.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO brainstack_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO brainstack_app;
  END IF;
END $$;
