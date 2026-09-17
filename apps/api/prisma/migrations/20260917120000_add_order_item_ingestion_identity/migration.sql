-- Add the listing identity as a snapshot. Existing rows are backfilled from
-- their catalog mapping when available and from the sellable identity otherwise.
ALTER TABLE "marketplace_order_items"
ADD COLUMN "external_listing_id" TEXT;

UPDATE "marketplace_order_items" AS "order_item"
SET "external_listing_id" = COALESCE(
    "listing"."external_listing_id",
    "order_item"."external_sellable_id"
)
FROM "marketplace_listing_items" AS "listing_item"
LEFT JOIN "marketplace_listings" AS "listing"
    ON "listing"."id" = "listing_item"."marketplace_listing_id"
WHERE "listing_item"."id" = "order_item"."marketplace_listing_item_id";

UPDATE "marketplace_order_items"
SET "external_listing_id" = "external_sellable_id"
WHERE "external_listing_id" IS NULL;

ALTER TABLE "marketplace_order_items"
ALTER COLUMN "external_listing_id" SET NOT NULL;

CREATE UNIQUE INDEX "marketplace_order_items_order_external_sellable_id_key"
ON "marketplace_order_items"("marketplace_order_id", "external_sellable_id");

CREATE INDEX "marketplace_order_items_external_listing_id_idx"
ON "marketplace_order_items"("external_listing_id");
