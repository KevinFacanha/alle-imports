ALTER TABLE "olist_authorizations"
ADD COLUMN "integration_key" TEXT;

-- Every authorization created before multi-app support belongs to the
-- existing Conta 2 application. Tokens are not changed or re-encrypted.
UPDATE "olist_authorizations"
SET "integration_key" = 'c2'
WHERE "integration_key" IS NULL;

ALTER TABLE "olist_authorizations"
ALTER COLUMN "integration_key" SET NOT NULL;

CREATE UNIQUE INDEX "olist_authorizations_integration_key_key"
ON "olist_authorizations"("integration_key");
