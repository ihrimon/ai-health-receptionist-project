-- Hand-added: Prisma doesn't create extensions on its own. Needed by
-- knowledge_chunks.embedding. The pgvector/pgvector:pg16 image ships it.
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "llm_provider" AS ENUM ('groq', 'openai', 'anthropic', 'gemini', 'openrouter', 'unorouter');

-- CreateTable
CREATE TABLE "llm_credentials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" "llm_provider" NOT NULL DEFAULT 'groq',
    "api_key" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_used_at" TIMESTAMPTZ,
    "rl_limit_requests" INTEGER,
    "rl_remaining_requests" INTEGER,
    "rl_reset_requests" VARCHAR(50),
    "rl_limit_tokens" INTEGER,
    "rl_remaining_tokens" INTEGER,
    "rl_reset_tokens" VARCHAR(50),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "llm_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "call_sid" TEXT NOT NULL,
    "transcript" JSONB,
    "summary" TEXT,
    "duration" INTEGER,
    "rating" SMALLINT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source" VARCHAR(255) NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(384) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversations_call_sid_idx" ON "conversations"("call_sid");

-- Hand-added: Prisma can't express CHECK constraints.
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_rating_range" CHECK ("rating" BETWEEN 1 AND 5);
