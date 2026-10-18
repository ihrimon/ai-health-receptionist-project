-- M7-31: keyword (full-text) search reads a stored tsvector instead of
-- recomputing to_tsvector() for every matching row on every message (the
-- load test spent most of its time ranking: ts_rank_cd needs each row's
-- tsvector). Hand-written: Prisma has no generated columns; the columns are
-- declared in schema.prisma as Unsupported("tsvector")? so `migrate dev`
-- neither drops them nor reports drift.
--
-- The text-search config is the constant 'english' (what the queries use), so
-- to_tsvector(regconfig, text) is IMMUTABLE and a GENERATED ... STORED column
-- is allowed: Postgres fills it for existing rows now and keeps it current on
-- every insert/update of the source columns, no trigger and no app code.
--
-- Cost on an existing table: ADD COLUMN ... GENERATED STORED rewrites the
-- table under an ACCESS EXCLUSIVE lock (reads and writes wait), and the GIN
-- build blocks writes. That is acceptable at the current size (seconds for
-- tens of thousands of chunks; about 15 s for 90,000 chunks on the load-test
-- database). CREATE INDEX CONCURRENTLY can't run inside the migration
-- transaction, and the rewrite already holds the exclusive lock, so a plain
-- CREATE INDEX adds no extra waiting. If the table is ever far bigger,
-- build the index by hand with CONCURRENTLY first (same name, then this
-- migration's IF NOT EXISTS skips it).
--
-- Row-Level Security: policies are per row (workspace_id), the new columns
-- change none of them, and the rewrite is DDL which RLS does not filter.
-- The bypass is still set first, as the rule for migrations on tenant
-- tables says, so nothing here can ever be hidden by a policy.
-- Re-runnable: IF NOT EXISTS / IF EXISTS throughout.
SELECT set_config('app.rls_bypass', 'on', true);

ALTER TABLE "knowledge_chunks"
  ADD COLUMN IF NOT EXISTS "content_tsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED;

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "search_tsv" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', "name" || ' ' || coalesce("category", '') || ' ' || coalesce("description", ''))
  ) STORED;

CREATE INDEX IF NOT EXISTS "knowledge_chunks_content_tsv_idx"
  ON "knowledge_chunks" USING GIN ("content_tsv");
CREATE INDEX IF NOT EXISTS "products_search_tsv_idx"
  ON "products" USING GIN ("search_tsv");

-- The old expression indexes are replaced (keeping both would only slow
-- every insert down).
DROP INDEX IF EXISTS "knowledge_chunks_fts";
DROP INDEX IF EXISTS "products_fts";
