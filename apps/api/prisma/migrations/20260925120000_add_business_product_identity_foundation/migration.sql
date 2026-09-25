BEGIN;

-- CreateEnum
CREATE TYPE "ProductIdentityProvider" AS ENUM (
    'MERCADO_LIVRE',
    'OLIST',
    'SHOPEE'
);

-- CreateTable
CREATE TABLE "business_accounts" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "business_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "business_accounts_code_key"
ON "business_accounts"("code");

-- Add nullable relationships first so existing integrations keep working
-- even when an account is not one of the two known production accounts.
ALTER TABLE "marketplace_accounts"
ADD COLUMN "business_account_id" UUID;

ALTER TABLE "olist_accounts"
ADD COLUMN "business_account_id" UUID;

-- Seed stable business identities. Names remain display-only; all
-- relationships use the UUID primary key.
INSERT INTO "business_accounts" (
    "id",
    "code",
    "display_name",
    "updated_at"
)
VALUES
    ('c1000000-0000-4000-8000-000000000001', 'C1', 'Conta 1', CURRENT_TIMESTAMP),
    ('c2000000-0000-4000-8000-000000000002', 'C2', 'Conta 2', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- One-time bootstrap from immutable Mercado Livre seller ids observed in the
-- existing installation. Account names are deliberately not used.
UPDATE "marketplace_accounts" AS marketplace_account
SET "business_account_id" = business_account."id"
FROM (
    VALUES
        ('740458955', 'C1'),
        ('1196767962', 'C2')
) AS known_account("external_account_id", "business_account_code")
JOIN "business_accounts" AS business_account
  ON business_account."code" = known_account."business_account_code"
WHERE marketplace_account."marketplace" = 'MERCADO_LIVRE'
  AND marketplace_account."external_account_id" = known_account."external_account_id"
  AND marketplace_account."business_account_id" IS NULL;

-- integration_key is used only to bootstrap the current Olist rows. Once the
-- UUID is stored, it is no longer the cross-provider relationship key.
UPDATE "olist_accounts" AS olist_account
SET "business_account_id" = business_account."id"
FROM "olist_authorizations" AS olist_authorization
JOIN "business_accounts" AS business_account
  ON LOWER(business_account."code") = olist_authorization."integration_key"
WHERE olist_authorization."olist_account_id" = olist_account."id"
  AND olist_authorization."integration_key" IN ('c1', 'c2')
  AND olist_account."business_account_id" IS NULL;

-- CreateIndex
CREATE INDEX "marketplace_accounts_business_account_id_idx"
ON "marketplace_accounts"("business_account_id");

CREATE INDEX "olist_accounts_business_account_id_idx"
ON "olist_accounts"("business_account_id");

-- AddForeignKey
ALTER TABLE "marketplace_accounts"
ADD CONSTRAINT "marketplace_accounts_business_account_id_fkey"
FOREIGN KEY ("business_account_id") REFERENCES "business_accounts"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "olist_accounts"
ADD CONSTRAINT "olist_accounts_business_account_id_fkey"
FOREIGN KEY ("business_account_id") REFERENCES "business_accounts"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "product_external_identities" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "business_account_id" UUID NOT NULL,
    "provider" "ProductIdentityProvider" NOT NULL,
    "seller_sku" TEXT,
    "external_listing_id" TEXT,
    "external_variation_id" TEXT,
    "marketplace_listing_item_id" UUID,
    "valid_from" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_external_identities_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_external_identities_identifier_check" CHECK (
        NULLIF(BTRIM("seller_sku"), '') IS NOT NULL
        OR NULLIF(BTRIM("external_listing_id"), '') IS NOT NULL
        OR NULLIF(BTRIM("external_variation_id"), '') IS NOT NULL
    ),
    CONSTRAINT "product_external_identities_variation_listing_check" CHECK (
        "external_variation_id" IS NULL
        OR NULLIF(BTRIM("external_listing_id"), '') IS NOT NULL
    ),
    CONSTRAINT "product_external_identities_validity_check" CHECK (
        "valid_to" IS NULL OR "valid_to" > "valid_from"
    )
);

-- CreateIndex
CREATE INDEX "product_external_identities_product_id_idx"
ON "product_external_identities"("product_id");

CREATE INDEX "product_external_identities_account_provider_idx"
ON "product_external_identities"("business_account_id", "provider");

CREATE INDEX "product_external_identities_account_provider_seller_sku_idx"
ON "product_external_identities"("business_account_id", "provider", "seller_sku");

CREATE INDEX "product_external_identities_external_sellable_idx"
ON "product_external_identities"(
    "business_account_id",
    "provider",
    "external_listing_id",
    "external_variation_id"
);

CREATE INDEX "product_external_identities_listing_item_idx"
ON "product_external_identities"("marketplace_listing_item_id");

-- Only one current mapping may own a provider sellable in a business account.
-- seller_sku intentionally remains non-unique because it can repeat by account,
-- listing, variation, and over time.
CREATE UNIQUE INDEX "product_external_identities_current_sellable_key"
ON "product_external_identities"(
    "business_account_id",
    "provider",
    "external_listing_id",
    COALESCE("external_variation_id", '')
)
WHERE "valid_to" IS NULL AND "external_listing_id" IS NOT NULL;

CREATE UNIQUE INDEX "product_external_identities_current_listing_item_key"
ON "product_external_identities"("marketplace_listing_item_id")
WHERE "valid_to" IS NULL AND "marketplace_listing_item_id" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "product_external_identities"
ADD CONSTRAINT "product_external_identities_product_id_fkey"
FOREIGN KEY ("product_id") REFERENCES "products"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "product_external_identities"
ADD CONSTRAINT "product_external_identities_business_account_id_fkey"
FOREIGN KEY ("business_account_id") REFERENCES "business_accounts"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "product_external_identities"
ADD CONSTRAINT "product_external_identities_marketplace_listing_item_id_fkey"
FOREIGN KEY ("marketplace_listing_item_id") REFERENCES "marketplace_listing_items"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill only existing explicit listing-to-product mappings. Order items are
-- intentionally untouched in this migration.
INSERT INTO "product_external_identities" (
    "id",
    "product_id",
    "business_account_id",
    "provider",
    "seller_sku",
    "external_listing_id",
    "external_variation_id",
    "marketplace_listing_item_id",
    "valid_from",
    "created_at",
    "updated_at"
)
SELECT
    listing_item."id",
    listing_item."product_id",
    marketplace_account."business_account_id",
    marketplace_account."marketplace"::TEXT::"ProductIdentityProvider",
    listing_item."seller_sku",
    listing."external_listing_id",
    CASE
        WHEN listing_item."external_sellable_id" = listing."external_listing_id" THEN NULL
        ELSE listing_item."external_sellable_id"
    END,
    listing_item."id",
    listing_item."created_at",
    listing_item."created_at",
    listing_item."updated_at"
FROM "marketplace_listing_items" AS listing_item
JOIN "marketplace_listings" AS listing
  ON listing."id" = listing_item."marketplace_listing_id"
JOIN "marketplace_accounts" AS marketplace_account
  ON marketplace_account."id" = listing."marketplace_account_id"
WHERE listing_item."product_id" IS NOT NULL
  AND marketplace_account."business_account_id" IS NOT NULL;

COMMIT;
