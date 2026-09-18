CREATE TABLE "olist_accounts" (
    "id" UUID NOT NULL,
    "external_account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "olist_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "olist_authorizations" (
    "id" UUID NOT NULL,
    "olist_account_id" UUID NOT NULL,
    "access_token_encrypted" TEXT NOT NULL,
    "refresh_token_encrypted" TEXT NOT NULL,
    "token_type" TEXT,
    "scope" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "refresh_expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "olist_authorizations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "olist_accounts_external_account_id_key"
ON "olist_accounts"("external_account_id");

CREATE UNIQUE INDEX "olist_authorizations_olist_account_id_key"
ON "olist_authorizations"("olist_account_id");

ALTER TABLE "olist_authorizations"
ADD CONSTRAINT "olist_authorizations_olist_account_id_fkey"
FOREIGN KEY ("olist_account_id") REFERENCES "olist_accounts"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
