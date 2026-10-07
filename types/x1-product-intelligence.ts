import type { MlbAbcClass } from "./mlb-sales-abc"

export type X1Period = 30 | 60 | 90

export interface X1AbcClassification {
  class: MlbAbcClass | null
  rank: number | null
}

export interface X1AccountMetrics {
  mlb: string
  salesCount: number
  soldOfferUnits: number
  grossRevenue: string
  normalizedPhysicalUnits: string
  abc: {
    units: X1AbcClassification
    grossRevenue: X1AbcClassification
  }
}

export interface X1MetricDelta<T extends number | string> {
  absolute: T
  percent: number | null
}

export interface X1Component {
  c1SellableId: string
  c2SellableId: string
  baseProduct: {
    id: string
    sku: string
    name: string
  }
  compositionQuantity: {
    c1: string | null
    c2: string | null
  }
  componentSignature: string
  confidence: string
  matchingVersion: string
  consistencyError: boolean
}

export interface X1MlbPair {
  c1: X1AccountMetrics
  c2: X1AccountMetrics
  deltas: {
    salesCount: X1MetricDelta<number>
    soldOfferUnits: X1MetricDelta<number>
    normalizedPhysicalUnits: X1MetricDelta<string>
    grossRevenue: X1MetricDelta<string>
  }
  components: X1Component[]
  consistencyError: boolean
}

export interface X1ProductIntelligenceResponse {
  metadata: {
    generatedAt: string
    timezone: string
    days: X1Period
    periodStart: string
    periodEnd: string
    saleDefinition: {
      includedStatuses: string[]
      excludedStatuses: string[]
    }
  }
  coverage: {
    confirmedEquivalences: number
    fullyComparableMlbPairs: number
    reviewRequiredMlbPairs: number
    matchingVersion: string | null
  }
  pairs: X1MlbPair[]
}

export interface X1Summary {
  pairCount: number
  c1GrossRevenue: number
  c2GrossRevenue: number
  grossRevenueDelta: number
  c1OfferUnits: number
  c2OfferUnits: number
}
