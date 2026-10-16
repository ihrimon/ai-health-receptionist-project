-- Hand-written: the old rows are transcripts of the retired single-tenant
-- demo chat (lead's call, 2026-10-15). No workspace owns them, and the new
-- NOT NULL tenant columns could not be filled for them. The rating CHECK
-- (1-5) on the rating column stays as it is.
DELETE FROM "conversations";

/*
  Warnings:

  - You are about to drop the column `call_sid` on the `conversations` table. All the data in the column will be lost.
  - You are about to drop the column `created_at` on the `conversations` table. All the data in the column will be lost.
  - You are about to drop the column `duration` on the `conversations` table. All the data in the column will be lost.
  - You are about to drop the column `summary` on the `conversations` table. All the data in the column will be lost.
  - You are about to drop the column `transcript` on the `conversations` table. All the data in the column will be lost.
  - Added the required column `chatbot_id` to the `conversations` table without a default value. This is not possible if the table is not empty.
  - Added the required column `visitor_id` to the `conversations` table without a default value. This is not possible if the table is not empty.
  - Added the required column `workspace_id` to the `conversations` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT');

-- DropIndex
DROP INDEX "conversations_call_sid_idx";

-- AlterTable
ALTER TABLE "conversations" DROP COLUMN "call_sid",
DROP COLUMN "created_at",
DROP COLUMN "duration",
DROP COLUMN "summary",
DROP COLUMN "transcript",
ADD COLUMN     "chatbot_id" UUID NOT NULL,
ADD COLUMN     "is_preview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "last_message_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "message_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "origin_url" TEXT,
ADD COLUMN     "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "version_id" UUID,
ADD COLUMN     "visitor_id" VARCHAR(64) NOT NULL,
ADD COLUMN     "workspace_id" UUID NOT NULL;

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "sources" JSONB,
    "answered_by" VARCHAR(20),
    "model" VARCHAR(100),
    "tokens_in" INTEGER,
    "tokens_out" INTEGER,
    "latency_ms" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_workspace_id_answered_by_created_at_idx" ON "messages"("workspace_id", "answered_by", "created_at");

-- CreateIndex
CREATE INDEX "conversations_workspace_id_chatbot_id_last_message_at_idx" ON "conversations"("workspace_id", "chatbot_id", "last_message_at" DESC);

-- CreateIndex
CREATE INDEX "conversations_chatbot_id_visitor_id_idx" ON "conversations"("chatbot_id", "visitor_id");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_chatbot_id_fkey" FOREIGN KEY ("chatbot_id") REFERENCES "chatbots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
