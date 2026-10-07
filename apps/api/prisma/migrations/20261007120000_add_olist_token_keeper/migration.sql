CREATE TYPE "OlistAuthorizationStatus" AS ENUM ('ACTIVE', 'REAUTH_REQUIRED');

ALTER TABLE "olist_authorizations"
ADD COLUMN "status" "OlistAuthorizationStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "status_reason" TEXT,
ADD COLUMN "last_refresh_attempt_at" TIMESTAMPTZ(3),
ADD COLUMN "last_refresh_success_at" TIMESTAMPTZ(3);
