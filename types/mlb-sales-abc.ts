export type MlbAbcPeriod = 30 | 60 | 90

export type MlbAbcScope = "C1" | "C2" | "CONSOLIDATED"

export type MlbAbcMetric = "UNITS" | "GROSS_REVENUE"

export type MlbAbcClass = "A" | "B" | "C"

export interface MlbSalesAbcFilters {
  period: MlbAbcPeriod
  scope: MlbAbcScope
  metric: MlbAbcMetric
}

export interface MlbSalesAbcItem {
  mlb: string
  title: string | null
  account: string
  salesCount: number
  unitsSold: number
  grossRevenue: string
  participationPercent: number
  cumulativePercent: number
  abcClass: MlbAbcClass
  rank: number
}

export interface MlbSalesAbcReport {
  periodStart: string
  periodEnd: string
  timezone: string
  scope: MlbAbcScope
  metric: MlbAbcMetric
  totalSales: number
  totalUnits: number
  totalGrossRevenue: string
  totalMlbs: number
  lastUpdatedAt: string | null
  lastSyncedAt: string | null
  mlbs: MlbSalesAbcItem[]
}
