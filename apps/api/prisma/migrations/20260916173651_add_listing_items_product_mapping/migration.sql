-- CreateTable
CREATE TABLE "marketplace_listing_items" (
    "id" UUID NOT NULL,
    "marketplace_listing_id" UUID NOT NULL,
    "product_id" UUID,
    "external_sellable_id" TEXT NOT NULL,
    "seller_sku" TEXT,
    "variation_label" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "marketplace_listing_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "marketplace_listing_items_marketplace_listing_id_idx" ON "marketplace_listing_items"("marketplace_listing_id");

-- CreateIndex
CREATE INDEX "marketplace_listing_items_product_id_idx" ON "marketplace_listing_items"("product_id");

-- CreateIndex
CREATE INDEX "marketplace_listing_items_seller_sku_idx" ON "marketplace_listing_items"("seller_sku");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_listing_items_listing_external_sellable_id_key" ON "marketplace_listing_items"("marketplace_listing_id", "external_sellable_id");

-- AddForeignKey
ALTER TABLE "marketplace_listing_items" ADD CONSTRAINT "marketplace_listing_items_marketplace_listing_id_fkey" FOREIGN KEY ("marketplace_listing_id") REFERENCES "marketplace_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_listing_items" ADD CONSTRAINT "marketplace_listing_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
