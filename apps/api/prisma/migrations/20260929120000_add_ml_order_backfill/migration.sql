BEGIN;

CREATE TYPE "MarketplaceOrderBackfillStatus" AS ENUM (
    'PENDING',
    'RUNNING',
    'COMPLETED',
    'FAILED'
);

ALTER TABLE "marketplace_orders"
ADD COLUMN "closed_at" TIMESTAMPTZ(3),
ADD COLUMN "last_updated_at" TIMESTAMPTZ(3),
ADD COLUMN "paid_amount" DECIMAL(14,2),
ADD COLUMN "refunded_amount" DECIMAL(14,2);

ALTER TABLE "marketplace_orders"
ADD CONSTRAINT "marketplace_orders_paid_amount_check"
CHECK ("paid_amount" IS NULL OR "paid_amount" >= 0),
ADD CONSTRAINT "marketplace_orders_refunded_amount_check"
CHECK ("refunded_amount" IS NULL OR "refunded_amount" >= 0);

ALTER TABLE "marketplace_order_items"
ADD COLUMN "user_product_id" TEXT,
ADD COLUMN "catalog_product_id" TEXT;

-- The old key incorrectly merged two different listings when Mercado Livre
-- reused the same variation/sellable id inside one order. Widening the key
-- preserves every existing row and does not rewrite product associations.
DROP INDEX "marketplace_order_items_order_external_sellable_id_key";

CREATE UNIQUE INDEX "marketplace_order_items_order_listing_sellable_key"
ON "marketplace_order_items"(
    "marketplace_order_id",
    "external_listing_id",
    "external_sellable_id"
);

CREATE TABLE "marketplace_order_backfill_runs" (
    "id" UUID NOT NULL,
    "marketplace_account_id" UUID NOT NULL,
    "business_account_id" UUID NOT NULL,
    "date_from" TIMESTAMPTZ(3) NOT NULL,
    "date_to" TIMESTAMPTZ(3) NOT NULL,
    "chunk_days" INTEGER NOT NULL DEFAULT 1,
    "max_rps" DECIMAL(10,3) NOT NULL DEFAULT 1,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "status" "MarketplaceOrderBackfillStatus" NOT NULL DEFAULT 'PENDING',
    "total_chunks" INTEGER NOT NULL,
    "completed_chunks" INTEGER NOT NULL DEFAULT 0,
    "failed_chunks" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "pages_processed" INTEGER NOT NULL DEFAULT 0,
    "orders_processed" INTEGER NOT NULL DEFAULT 0,
    "items_mapped" INTEGER NOT NULL DEFAULT 0,
    "items_unmapped" INTEGER NOT NULL DEFAULT 0,
    "execution_id" UUID,
    "heartbeat_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "marketplace_order_backfill_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "marketplace_order_backfill_runs_interval_check" CHECK ("date_from" < "date_to"),
    CONSTRAINT "marketplace_order_backfill_runs_chunk_days_check" CHECK ("chunk_days" > 0),
    CONSTRAINT "marketplace_order_backfill_runs_max_rps_check" CHECK ("max_rps" > 0),
    CONSTRAINT "marketplace_order_backfill_runs_max_attempts_check" CHECK ("max_attempts" > 0),
    CONSTRAINT "marketplace_order_backfill_runs_counters_check" CHECK (
        "total_chunks" > 0
        AND "completed_chunks" >= 0
        AND "failed_chunks" >= 0
        AND "attempts" >= 0
        AND "pages_processed" >= 0
        AND "orders_processed" >= 0
        AND "items_mapped" >= 0
        AND "items_unmapped" >= 0
    )
);

CREATE TABLE "marketplace_order_backfill_chunks" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "date_from" TIMESTAMPTZ(3) NOT NULL,
    "date_to" TIMESTAMPTZ(3) NOT NULL,
    "status" "MarketplaceOrderBackfillStatus" NOT NULL DEFAULT 'PENDING',
    "next_offset" INTEGER NOT NULL DEFAULT 0,
    "total_orders" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "pages_processed" INTEGER NOT NULL DEFAULT 0,
    "orders_processed" INTEGER NOT NULL DEFAULT 0,
    "items_mapped" INTEGER NOT NULL DEFAULT 0,
    "items_unmapped" INTEGER NOT NULL DEFAULT 0,
    "partial" BOOLEAN NOT NULL DEFAULT false,
    "last_error" TEXT,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "marketplace_order_backfill_chunks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "marketplace_order_backfill_chunks_interval_check" CHECK ("date_from" < "date_to"),
    CONSTRAINT "marketplace_order_backfill_chunks_counters_check" CHECK (
        "next_offset" >= 0
        AND ("total_orders" IS NULL OR "total_orders" >= 0)
        AND "attempts" >= 0
        AND "pages_processed" >= 0
        AND "orders_processed" >= 0
        AND "items_mapped" >= 0
        AND "items_unmapped" >= 0
    )
);

CREATE INDEX "marketplace_order_backfill_runs_account_status_idx"
ON "marketplace_order_backfill_runs"("marketplace_account_id", "status");

CREATE INDEX "marketplace_order_backfill_runs_business_account_id_idx"
ON "marketplace_order_backfill_runs"("business_account_id");

-- Prevents two active historical scans for the same marketplace account.
CREATE UNIQUE INDEX "marketplace_order_backfill_runs_one_active_account_key"
ON "marketplace_order_backfill_runs"("marketplace_account_id")
WHERE "status" IN ('PENDING', 'RUNNING');

CREATE UNIQUE INDEX "marketplace_order_backfill_chunks_run_date_from_key"
ON "marketplace_order_backfill_chunks"("run_id", "date_from");

CREATE INDEX "marketplace_order_backfill_chunks_run_status_idx"
ON "marketplace_order_backfill_chunks"("run_id", "status");

ALTER TABLE "marketplace_order_backfill_runs"
ADD CONSTRAINT "marketplace_order_backfill_runs_marketplace_account_id_fkey"
FOREIGN KEY ("marketplace_account_id") REFERENCES "marketplace_accounts"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "marketplace_order_backfill_runs"
ADD CONSTRAINT "marketplace_order_backfill_runs_business_account_id_fkey"
FOREIGN KEY ("business_account_id") REFERENCES "business_accounts"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "marketplace_order_backfill_chunks"
ADD CONSTRAINT "marketplace_order_backfill_chunks_run_id_fkey"
FOREIGN KEY ("run_id") REFERENCES "marketplace_order_backfill_runs"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
