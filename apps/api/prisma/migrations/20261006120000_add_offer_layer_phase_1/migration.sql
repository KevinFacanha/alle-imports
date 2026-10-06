BEGIN;

-- Additive Offer Layer foundation. This migration creates schema objects only:
-- it does not rewrite existing rows or change ProductExternalIdentity semantics.
CREATE TYPE "OfferCompositionSource" AS ENUM (
    'MANUAL',
    'CATALOG',
    'MARKETPLACE',
    'INFERRED'
);

CREATE TYPE "ListingEquivalenceStatus" AS ENUM (
    'CANDIDATE',
    'CONFIRMED',
    'REJECTED'
);

CREATE TABLE "offer_compositions" (
    "id" UUID NOT NULL,
    "marketplace_listing_item_id" UUID NOT NULL,
    "component_product_id" UUID NOT NULL,
    "quantity" DECIMAL(30,10) NOT NULL,
    "source" "OfferCompositionSource" NOT NULL,
    "confidence" DECIMAL(5,4) NOT NULL,
    "evidence_version" TEXT NOT NULL,
    "evidence_hash" CHAR(64) NOT NULL,
    "evidence" JSONB,
    "valid_from" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "offer_compositions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "offer_compositions_quantity_check" CHECK ("quantity" > 0),
    CONSTRAINT "offer_compositions_confidence_check" CHECK (
        "confidence" >= 0 AND "confidence" <= 1
    ),
    CONSTRAINT "offer_compositions_validity_check" CHECK (
        "valid_to" IS NULL OR "valid_to" > "valid_from"
    ),
    CONSTRAINT "offer_compositions_marketplace_listing_item_id_fkey"
        FOREIGN KEY ("marketplace_listing_item_id")
        REFERENCES "marketplace_listing_items"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "offer_compositions_component_product_id_fkey"
        FOREIGN KEY ("component_product_id")
        REFERENCES "products"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "listing_equivalences" (
    "id" UUID NOT NULL,
    "left_listing_item_id" UUID NOT NULL,
    "right_listing_item_id" UUID NOT NULL,
    "component_signature" CHAR(64) NOT NULL,
    "status" "ListingEquivalenceStatus" NOT NULL,
    "confidence" DECIMAL(5,4) NOT NULL,
    "matching_version" TEXT NOT NULL,
    "evidence_hash" CHAR(64) NOT NULL,
    "evidence" JSONB,
    "valid_from" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "listing_equivalences_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "listing_equivalences_distinct_items_check" CHECK (
        "left_listing_item_id" <> "right_listing_item_id"
    ),
    CONSTRAINT "listing_equivalences_confidence_check" CHECK (
        "confidence" >= 0 AND "confidence" <= 1
    ),
    CONSTRAINT "listing_equivalences_validity_check" CHECK (
        "valid_to" IS NULL OR "valid_to" > "valid_from"
    ),
    CONSTRAINT "listing_equivalences_left_listing_item_id_fkey"
        FOREIGN KEY ("left_listing_item_id")
        REFERENCES "marketplace_listing_items"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "listing_equivalences_right_listing_item_id_fkey"
        FOREIGN KEY ("right_listing_item_id")
        REFERENCES "marketplace_listing_items"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "offer_compositions_listing_item_valid_to_idx"
ON "offer_compositions"("marketplace_listing_item_id", "valid_to");

CREATE INDEX "offer_compositions_component_product_valid_to_idx"
ON "offer_compositions"("component_product_id", "valid_to");

CREATE INDEX "offer_compositions_evidence_hash_idx"
ON "offer_compositions"("evidence_hash");

-- A current composition has one aggregated row per component. Closing the row
-- through valid_to preserves history and permits a later version.
CREATE UNIQUE INDEX "offer_compositions_current_component_key"
ON "offer_compositions"("marketplace_listing_item_id", "component_product_id")
WHERE "valid_to" IS NULL;

CREATE INDEX "listing_equivalences_left_valid_to_idx"
ON "listing_equivalences"("left_listing_item_id", "valid_to");

CREATE INDEX "listing_equivalences_right_valid_to_idx"
ON "listing_equivalences"("right_listing_item_id", "valid_to");

CREATE INDEX "listing_equivalences_signature_status_valid_to_idx"
ON "listing_equivalences"("component_signature", "status", "valid_to");

CREATE INDEX "listing_equivalences_evidence_hash_idx"
ON "listing_equivalences"("evidence_hash");

-- LEAST/GREATEST canonicalize both directions, so (A,B) and (B,A) cannot both
-- be current. Historical versions remain possible after valid_to is closed.
CREATE UNIQUE INDEX "listing_equivalences_current_canonical_pair_key"
ON "listing_equivalences"(
    LEAST("left_listing_item_id", "right_listing_item_id"),
    GREATEST("left_listing_item_id", "right_listing_item_id")
)
WHERE "valid_to" IS NULL;

COMMIT;
