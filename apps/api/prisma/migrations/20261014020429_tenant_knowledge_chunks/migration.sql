-- Hand-written: the old rows are the retired single-tenant demo FAQ (lead's
-- call, 2026-10-14). No workspace owns them, and the new NOT NULL tenant
-- columns could not be filled for them.
DELETE FROM "knowledge_chunks";

-- AlterTable
ALTER TABLE "knowledge_chunks" DROP COLUMN "source",
ADD COLUMN     "chatbot_id" UUID NOT NULL,
ADD COLUMN     "chunk_index" INTEGER NOT NULL,
ADD COLUMN     "embedding_model" VARCHAR(100) NOT NULL,
ADD COLUMN     "faq_id" UUID,
ADD COLUMN     "metadata" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "source_id" UUID,
ADD COLUMN     "workspace_id" UUID NOT NULL;

-- CreateIndex
CREATE INDEX "knowledge_chunks_workspace_id_chatbot_id_idx" ON "knowledge_chunks"("workspace_id", "chatbot_id");

-- CreateIndex
CREATE INDEX "knowledge_chunks_faq_id_idx" ON "knowledge_chunks"("faq_id");

-- CreateIndex
CREATE INDEX "knowledge_chunks_source_id_idx" ON "knowledge_chunks"("source_id");

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_chatbot_id_fkey" FOREIGN KEY ("chatbot_id") REFERENCES "chatbots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_faq_id_fkey" FOREIGN KEY ("faq_id") REFERENCES "faqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "knowledge_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written (D-1 §4): a chunk belongs to exactly one FAQ or source.
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_one_source"
  CHECK ((faq_id IS NOT NULL)::int + (source_id IS NOT NULL)::int = 1);

-- Hand-written (D-1 decision 8): keyword search for hybrid retrieval (M3),
-- an expression index rather than a tsvector column Prisma can't model.
CREATE INDEX "knowledge_chunks_fts" ON "knowledge_chunks"
  USING GIN (to_tsvector('english', "content"));
