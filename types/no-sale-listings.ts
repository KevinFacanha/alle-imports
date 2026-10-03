import type { MlbAbcClass, MlbAbcMovement } from "./mlb-sales-abc"

export type NoSaleAccount = "C1" | "C2" | "ALL"
export type NoSaleThreshold = 30 | 60 | 90
export type NoSaleListingStatusFilter = "ACTIVE" | "PAUSED" | "INACTIVE" | "ALL"
export type NoSaleOperationalStatus =
  | "NO_SALE_30D"
  | "NO_SALE_60D"
  | "NO_SALE_90D"
  | "NO_SALE_IN_AVAILABLE_HISTORY"

export interface NoSaleListingsFilters {
  account: NoSaleAccount
  days: NoSaleThreshold
  listingStatus: NoSaleListingStatusFilter
}

export interface NoSaleListingItem {
  mlb: string
  title: string | null
  account: string
  listingStatus: string
  listingCreatedAt: null
  listingFirstSeenAt: string
  listingAgeDays: number
  lastSaleAt: string | null
  daysSinceLastSale: number | null
  observedNoSaleDays: number
  salesCount30d: number
  unitsSold30d: number
  grossRevenue30d: string
  abcClass30d: MlbAbcClass | null
  abcMovement30d: MlbAbcMovement | null
  operationalStatus: NoSaleOperationalStatus
}

export interface NoSaleListingsResponse {
  metadata: {
    generatedAt: string
    timezone: string
    thresholdDays: NoSaleThreshold
    account: NoSaleAccount
    listingStatus: NoSaleListingStatusFilter
    activeOnlyByDefault: true
    identity: "BUSINESS_ACCOUNT_AND_EXTERNAL_LISTING_ID"
    listingAgeSource: "EARLIEST_LOCAL_EVIDENCE"
    saleDefinition: {
      includedStatuses: string[]
      excludedStatuses: string[]
      description: string
    }
    history: Array<{
      account: string
      availableFrom: string | null
      availableThrough: string | null
      availableDays: number
      currentThroughBusinessDay: boolean
    }>
  }
  summary: {
    noSale30d: number
    noSale60d: number
    noSale90d: number
    potentialRevenueAtRisk: null
    potentialRevenueAtRiskReason: string
  }
  total: number
  listings: NoSaleListingItem[]
}
