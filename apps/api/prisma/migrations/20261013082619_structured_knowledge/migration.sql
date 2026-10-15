-- CreateEnum
CREATE TYPE "knowledge_source_type" AS ENUM ('POLICY', 'TEXT', 'DOCUMENT', 'URL');

-- CreateEnum
CREATE TYPE "ingest_status" AS ENUM ('QUEUED', 'PROCESSING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "faqs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "chatbot_id" UUID NOT NULL,
    "question" VARCHAR(500) NOT NULL,
    "answer" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "faqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_answers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "chatbot_id" UUID NOT NULL,
    "trigger_question" VARCHAR(500) NOT NULL,
    "answer" TEXT NOT NULL,
    "embedding" vector(384),
    "embedding_model" VARCHAR(100),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "custom_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_sources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "chatbot_id" UUID NOT NULL,
    "type" "knowledge_source_type" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "content" TEXT,
    "file_key" TEXT,
    "file_name" VARCHAR(255),
    "file_size" INTEGER,
    "mime_type" VARCHAR(100),
    "url" TEXT,
    "status" "ingest_status" NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "knowledge_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "faqs_workspace_id_chatbot_id_idx" ON "faqs"("workspace_id", "chatbot_id");

-- CreateIndex
CREATE INDEX "custom_answers_workspace_id_chatbot_id_idx" ON "custom_answers"("workspace_id", "chatbot_id");

-- CreateIndex
CREATE INDEX "knowledge_sources_workspace_id_chatbot_id_type_idx" ON "knowledge_sources"("workspace_id", "chatbot_id", "type");

-- AddForeignKey
ALTER TABLE "faqs" ADD CONSTRAINT "faqs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faqs" ADD CONSTRAINT "faqs_chatbot_id_fkey" FOREIGN KEY ("chatbot_id") REFERENCES "chatbots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_answers" ADD CONSTRAINT "custom_answers_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_answers" ADD CONSTRAINT "custom_answers_chatbot_id_fkey" FOREIGN KEY ("chatbot_id") REFERENCES "chatbots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_chatbot_id_fkey" FOREIGN KEY ("chatbot_id") REFERENCES "chatbots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

