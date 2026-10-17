-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "chatbot_id" UUID NOT NULL,
    "conversation_id" UUID,
    "name" VARCHAR(100),
    "email" VARCHAR(255),
    "phone" VARCHAR(30),
    "answers" JSONB NOT NULL DEFAULT '{}',
    "source_url" TEXT,
    "notified_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "leads_conversation_id_key" ON "leads"("conversation_id");

-- CreateIndex
CREATE INDEX "leads_workspace_id_created_at_idx" ON "leads"("workspace_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "leads_chatbot_id_idx" ON "leads"("chatbot_id");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_chatbot_id_fkey" FOREIGN KEY ("chatbot_id") REFERENCES "chatbots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
