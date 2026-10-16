-- CreateTable
CREATE TABLE "usage_counters" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "period" CHAR(7) NOT NULL,
    "messages" INTEGER NOT NULL DEFAULT 0,
    "preview_messages" INTEGER NOT NULL DEFAULT 0,
    "tokens_in" BIGINT NOT NULL DEFAULT 0,
    "tokens_out" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "usage_counters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usage_counters_workspace_id_period_key" ON "usage_counters"("workspace_id", "period");

-- AddForeignKey
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
