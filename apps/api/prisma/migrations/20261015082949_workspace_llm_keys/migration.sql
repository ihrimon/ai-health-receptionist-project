-- CreateTable
CREATE TABLE "workspace_llm_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "provider" "llm_provider" NOT NULL,
    "model" VARCHAR(100) NOT NULL,
    "api_key_encrypted" TEXT NOT NULL,
    "key_last4" VARCHAR(4) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "workspace_llm_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workspace_llm_keys_workspace_id_created_at_idx" ON "workspace_llm_keys"("workspace_id", "created_at");

-- AddForeignKey
ALTER TABLE "workspace_llm_keys" ADD CONSTRAINT "workspace_llm_keys_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
