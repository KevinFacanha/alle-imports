-- CreateTable
CREATE TABLE "marketplace_authorizations" (
    "id" UUID NOT NULL,
    "marketplace_account_id" UUID NOT NULL,
    "access_token_encrypted" TEXT NOT NULL,
    "refresh_token_encrypted" TEXT NOT NULL,
    "token_type" TEXT,
    "scope" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "marketplace_authorizations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_authorizations_marketplace_account_id_key" ON "marketplace_authorizations"("marketplace_account_id");

-- AddForeignKey
ALTER TABLE "marketplace_authorizations" ADD CONSTRAINT "marketplace_authorizations_marketplace_account_id_fkey" FOREIGN KEY ("marketplace_account_id") REFERENCES "marketplace_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
