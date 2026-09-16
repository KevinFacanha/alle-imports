-- CreateEnum
CREATE TYPE "MarketplaceOrderStatus" AS ENUM (
    'PENDING',
    'PAID',
    'PROCESSING',
    'SHIPPED',
    'DELIVERED',
    'CANCELLED',
    'PARTIALLY_REFUNDED',
    'REFUNDED',
    'UNKNOWN'
);

-- CreateTable
CREATE TABLE "marketplace_orders" (
    "id" UUID NOT NULL,
    "marketplace_account_id" UUID NOT NULL,
    "external_order_id" TEXT NOT NULL,
    "normalized_status" "MarketplaceOrderStatus" NOT NULL,
    "raw_status" TEXT,
    "sold_at" TIMESTAMPTZ(3) NOT NULL,
    "cancelled_at" TIMESTAMPTZ(3),
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "gross_amount" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "marketplace_orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "marketplace_orders_gross_amount_check" CHECK ("gross_amount" >= 0)
);

-- CreateTable
CREATE TABLE "marketplace_order_items" (
    "id" UUID NOT NULL,
    "marketplace_order_id" UUID NOT NULL,
    "marketplace_listing_item_id" UUID,
    "product_id" UUID,
    "external_sellable_id" TEXT NOT NULL,
    "seller_sku" TEXT,
    "title" TEXT,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(14,2) NOT NULL,
    "gross_amount" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketplace_order_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "marketplace_order_items_quantity_check" CHECK ("quantity" > 0),
    CONSTRAINT "marketplace_order_items_unit_price_check" CHECK ("unit_price" >= 0),
    CONSTRAINT "marketplace_order_items_gross_amount_check" CHECK ("gross_amount" >= 0)
);

-- CreateIndex
CREATE INDEX "marketplace_orders_marketplace_account_id_idx" ON "marketplace_orders"("marketplace_account_id");

-- CreateIndex
CREATE INDEX "marketplace_orders_sold_at_idx" ON "marketplace_orders"("sold_at");

-- CreateIndex
CREATE INDEX "marketplace_orders_normalized_status_idx" ON "marketplace_orders"("normalized_status");

-- CreateIndex
CREATE INDEX "marketplace_orders_account_sold_at_idx" ON "marketplace_orders"("marketplace_account_id", "sold_at");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_orders_account_external_order_id_key" ON "marketplace_orders"("marketplace_account_id", "external_order_id");

-- CreateIndex
CREATE INDEX "marketplace_order_items_marketplace_order_id_idx" ON "marketplace_order_items"("marketplace_order_id");

-- CreateIndex
CREATE INDEX "marketplace_order_items_marketplace_listing_item_id_idx" ON "marketplace_order_items"("marketplace_listing_item_id");

-- CreateIndex
CREATE INDEX "marketplace_order_items_product_id_idx" ON "marketplace_order_items"("product_id");

-- CreateIndex
CREATE INDEX "marketplace_order_items_seller_sku_idx" ON "marketplace_order_items"("seller_sku");

-- CreateIndex
CREATE INDEX "marketplace_order_items_external_sellable_id_idx" ON "marketplace_order_items"("external_sellable_id");

-- AddForeignKey
ALTER TABLE "marketplace_orders" ADD CONSTRAINT "marketplace_orders_marketplace_account_id_fkey" FOREIGN KEY ("marketplace_account_id") REFERENCES "marketplace_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_order_items" ADD CONSTRAINT "marketplace_order_items_marketplace_order_id_fkey" FOREIGN KEY ("marketplace_order_id") REFERENCES "marketplace_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_order_items" ADD CONSTRAINT "marketplace_order_items_marketplace_listing_item_id_fkey" FOREIGN KEY ("marketplace_listing_item_id") REFERENCES "marketplace_listing_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_order_items" ADD CONSTRAINT "marketplace_order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
