-- AlterTable
ALTER TABLE "chatbots" ADD COLUMN     "allowed_domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "published_version_id" UUID;

-- CreateTable
CREATE TABLE "chatbot_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "chatbot_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "published_by_id" UUID,
    "published_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chatbot_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chatbot_versions_workspace_id_idx" ON "chatbot_versions"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "chatbot_versions_chatbot_id_version_key" ON "chatbot_versions"("chatbot_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "chatbots_published_version_id_key" ON "chatbots"("published_version_id");

-- AddForeignKey
ALTER TABLE "chatbots" ADD CONSTRAINT "chatbots_published_version_id_fkey" FOREIGN KEY ("published_version_id") REFERENCES "chatbot_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chatbot_versions" ADD CONSTRAINT "chatbot_versions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chatbot_versions" ADD CONSTRAINT "chatbot_versions_chatbot_id_fkey" FOREIGN KEY ("chatbot_id") REFERENCES "chatbots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chatbot_versions" ADD CONSTRAINT "chatbot_versions_published_by_id_fkey" FOREIGN KEY ("published_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

