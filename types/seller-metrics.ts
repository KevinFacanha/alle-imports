export type Marketplace = "MERCADO_LIVRE" | "SHOPEE"

export interface MarketplaceAccountSummary {
  id: string
  name: string
  marketplace: Marketplace
}

export type SellerMetricName =
  | "salesCount"
  | "unitsSold"
  | "grossSales"
  | "marginRate"
  | "fullSalesCount"
  | "fullUnitsSold"
  | "fullGrossSales"
  | "visits"
  | "averageTicket"
  | "conversionRate"

export type SellerMetricSource = "MERCADO_LIVRE" | "OLIST" | "GEFINANCE" | "DERIVED"

export type SellerMetricStatus =
  | "AVAILABLE"
  | "UNAVAILABLE"
  | "INCOMPATIBLE_SEMANTICS"
  | "PROVISIONAL"

export interface SellerMetric {
  value: string | null
  source: SellerMetricSource
  status: SellerMetricStatus
  confidence: "HIGH" | "MEDIUM" | "LOW"
  validationEvidence: unknown[]
}

export interface DailySellerMetrics {
  marketplaceAccountId: string
  businessDate: string
  timezone: string
  calculatedAt: string
  metrics: Record<SellerMetricName, SellerMetric>
}

export interface DailySellerMetricsRange {
  marketplaceAccountId: string
  from: string
  to: string
  days: DailySellerMetrics[]
}
