export type MlbAbcPeriod = 30 | 60 | 90

export type MlbAbcScope = "C1" | "C2" | "CONSOLIDATED"

export type MlbAbcMetric = "UNITS" | "GROSS_REVENUE"

export type MlbAbcClass = "A" | "B" | "C"

export type MlbAbcMovement = "IMPROVED" | "DECLINED" | "STABLE" | "NEW"

export type MlbAbcClassTransition = `${MlbAbcClass}_TO_${MlbAbcClass}`

export type MlbAbcMovementFilter = "ALL" | MlbAbcMovement

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
  currentClass: MlbAbcClass
  previousClass: MlbAbcClass | null
  movement: MlbAbcMovement
  classTransition: MlbAbcClassTransition | null
  currentRank: number
  previousRank: number | null
  rankDelta: number | null
  currentUnits: number
  previousUnits: number
  unitsDeltaPercent: number | null
  currentGrossRevenue: string
  previousGrossRevenue: string
  grossRevenueDeltaPercent: number | null
}

export interface MlbSalesAbcMovementSummary {
  declined: number
  improved: number
  stable: number
  new: number
  aToB: number
  aToC: number
  bToC: number
}

export interface MlbSalesAbcReport {
  periodStart: string
  periodEnd: string
  previousPeriodStart: string
  previousPeriodEnd: string
  timezone: string
  scope: MlbAbcScope
  metric: MlbAbcMetric
  totalSales: number
  totalUnits: number
  totalGrossRevenue: string
  totalMlbs: number
  lastUpdatedAt: string | null
  lastSyncedAt: string | null
  movementSummary: MlbSalesAbcMovementSummary
  mlbs: MlbSalesAbcItem[]
}
