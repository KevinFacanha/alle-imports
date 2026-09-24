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

export type ComparisonDayStatus = "AVAILABLE" | "PARTIAL" | "MISSING_SNAPSHOT"

export type ComparisonMarginRateStatus =
  | "AVAILABLE"
  | "UNAVAILABLE_COMPONENTS"
  | "UNAVAILABLE_ZERO_BASE"
  | "NO_SNAPSHOTS"

export type ComparisonMetricName =
  | "grossSales"
  | "marginRate"
  | "fullGrossSales"
  | "averageTicket"
  | "salesCount"
  | "fullSalesCount"

export interface SellerMetricsComparisonDay {
  date: string
  grossSales: string | null
  marginRate: string | null
  fullGrossSales: string | null
  averageTicket: string | null
  salesCount: string | null
  fullSalesCount: string | null
  snapshotAvailable: boolean
  status: ComparisonDayStatus
}

export interface SellerMetricsComparisonAccount {
  marketplaceAccountId: string
  name: string
  summary: Record<ComparisonMetricName, string | null> & {
    marginRateStatus: ComparisonMarginRateStatus
  }
  days: SellerMetricsComparisonDay[]
  availableDays: number
  missingDays: number
  expectedDays: number
}

export interface SellerMetricsComparison {
  from: string
  to: string
  accounts: SellerMetricsComparisonAccount[]
}
