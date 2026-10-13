-- CreateEnum
CREATE TYPE "stock_status" AS ENUM ('IN_STOCK', 'OUT_OF_STOCK', 'PREORDER', 'UNKNOWN');

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "chatbot_id" UUID NOT NULL,
    "sku" VARCHAR(100),
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "price" DECIMAL(12,2),
    "compare_at_price" DECIMAL(12,2),
    "currency" CHAR(3) NOT NULL,
    "stock_status" "stock_status" NOT NULL DEFAULT 'UNKNOWN',
    "stock_quantity" INTEGER,
    "category" VARCHAR(100),
    "url" TEXT,
    "image_url" TEXT,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "external_id" TEXT,
    "embedding" vector(384),
    "embedding_model" VARCHAR(100),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "products_workspace_id_chatbot_id_is_active_idx" ON "products"("workspace_id", "chatbot_id", "is_active");

-- CreateIndex
CREATE INDEX "products_workspace_id_chatbot_id_category_idx" ON "products"("workspace_id", "chatbot_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "products_chatbot_id_sku_key" ON "products"("chatbot_id", "sku");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_chatbot_id_fkey" FOREIGN KEY ("chatbot_id") REFERENCES "chatbots"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written (D-1 §4): keyword search over products for the bot (M3).
-- Prisma cannot express expression indexes; it leaves this one alone.
CREATE INDEX "products_fts" ON "products"
  USING GIN (to_tsvector('english', "name" || ' ' || coalesce("category", '') || ' ' || coalesce("description", '')));
