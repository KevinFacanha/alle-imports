CREATE TYPE "DailySellerMetricName" AS ENUM (
    'SALES_COUNT',
    'UNITS_SOLD',
    'GROSS_SALES',
    'MARGIN_RATE',
    'FULL_SALES_COUNT',
    'FULL_UNITS_SOLD',
    'FULL_GROSS_SALES',
    'VISITS',
    'AVERAGE_TICKET',
    'CONVERSION_RATE'
);

CREATE TYPE "DailySellerMetricSource" AS ENUM (
    'MERCADO_LIVRE',
    'OLIST',
    'GEFINANCE',
    'DERIVED'
);

CREATE TYPE "DailySellerMetricStatus" AS ENUM (
    'AVAILABLE',
    'UNAVAILABLE',
    'INCOMPATIBLE_SEMANTICS',
    'PROVISIONAL'
);

CREATE TYPE "DailySellerMetricConfidence" AS ENUM (
    'HIGH',
    'MEDIUM',
    'LOW'
);

CREATE TABLE "daily_seller_metrics" (
    "id" UUID NOT NULL,
    "marketplace_account_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "timezone" TEXT NOT NULL,
    "gefinance_report_sha256" CHAR(64),
    "calculated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "daily_seller_metrics_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "daily_seller_metric_values" (
    "id" UUID NOT NULL,
    "daily_seller_metrics_id" UUID NOT NULL,
    "name" "DailySellerMetricName" NOT NULL,
    "value" DECIMAL(30,10),
    "source" "DailySellerMetricSource" NOT NULL,
    "status" "DailySellerMetricStatus" NOT NULL,
    "confidence" "DailySellerMetricConfidence" NOT NULL,
    "validation_evidence" JSONB NOT NULL,

    CONSTRAINT "daily_seller_metric_values_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "daily_seller_metrics_account_business_date_key"
ON "daily_seller_metrics"("marketplace_account_id", "business_date");

CREATE INDEX "daily_seller_metrics_business_date_idx"
ON "daily_seller_metrics"("business_date");

CREATE UNIQUE INDEX "daily_seller_metric_snapshot_name_key"
ON "daily_seller_metric_values"("daily_seller_metrics_id", "name");

ALTER TABLE "daily_seller_metrics"
ADD CONSTRAINT "daily_seller_metrics_marketplace_account_id_fkey"
FOREIGN KEY ("marketplace_account_id") REFERENCES "marketplace_accounts"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "daily_seller_metric_values"
ADD CONSTRAINT "daily_seller_metric_daily_seller_metrics_id_fkey"
FOREIGN KEY ("daily_seller_metrics_id") REFERENCES "daily_seller_metrics"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
