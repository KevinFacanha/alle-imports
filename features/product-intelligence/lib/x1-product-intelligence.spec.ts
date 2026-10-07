import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type {
  X1MlbPair,
  X1ProductIntelligenceResponse,
} from "../../../types/x1-product-intelligence.js"
import {
  isX1DataStale,
  summarizeX1,
  x1PrimaryTitle,
} from "./x1-product-intelligence.js"

describe("X1 Product Intelligence frontend model", () => {
  it("summarizes only the fully comparable pairs returned by the endpoint", () => {
    const report = response([
      pair("MLB-C1-A", "MLB-C2-A", "100.50", "80.25", 4, 2),
      pair("MLB-C1-B", "MLB-C2-B", "10.00", "30.00", 1, 3),
    ])

    assert.deepEqual(summarizeX1(report), {
      pairCount: 2,
      c1GrossRevenue: 110.5,
      c2GrossRevenue: 110.25,
      grossRevenueDelta: 0.25,
      c1OfferUnits: 5,
      c2OfferUnits: 5,
    })
  })

  it("derives the main title from Product base without inventing listing data", () => {
    const item = pair("MLB-C1", "MLB-C2", "0", "0", 0, 0)
    item.components.push({
      ...item.components[0]!,
      baseProduct: { id: "p2", sku: "SKU-2", name: "Refil" },
    })

    assert.equal(x1PrimaryTitle(item), "Produto principal (+1 componentes)")
  })

  it("marks invalid or older generated data as stale", () => {
    const now = Date.parse("2026-10-07T15:20:00.000Z")
    assert.equal(isX1DataStale("2026-10-07T15:15:00.000Z", now), false)
    assert.equal(isX1DataStale("2026-10-07T15:00:00.000Z", now), true)
    assert.equal(isX1DataStale("invalid", now), true)
  })
})

function response(pairs: X1MlbPair[]): X1ProductIntelligenceResponse {
  return {
    metadata: {
      generatedAt: "2026-10-07T15:00:00.000Z",
      timezone: "America/Sao_Paulo",
      days: 30,
      periodStart: "2026-09-07",
      periodEnd: "2026-10-06",
      saleDefinition: { includedStatuses: [], excludedStatuses: [] },
    },
    coverage: {
      confirmedEquivalences: 33,
      fullyComparableMlbPairs: pairs.length,
      reviewRequiredMlbPairs: 15,
      matchingVersion: "product-identity-matching-v2",
    },
    pairs,
  }
}

function pair(
  c1Mlb: string,
  c2Mlb: string,
  c1Revenue: string,
  c2Revenue: string,
  c1Units: number,
  c2Units: number,
): X1MlbPair {
  return {
    c1: account(c1Mlb, c1Revenue, c1Units),
    c2: account(c2Mlb, c2Revenue, c2Units),
    deltas: {
      salesCount: { absolute: 0, percent: 0 },
      soldOfferUnits: { absolute: c1Units - c2Units, percent: null },
      normalizedPhysicalUnits: { absolute: "0", percent: 0 },
      grossRevenue: { absolute: String(Number(c1Revenue) - Number(c2Revenue)), percent: null },
    },
    components: [{
      c1SellableId: "SELL-C1",
      c2SellableId: "SELL-C2",
      baseProduct: { id: "p1", sku: "SKU-1", name: "Produto principal" },
      compositionQuantity: { c1: "1", c2: "1" },
      componentSignature: "p1:1",
      confidence: "1",
      matchingVersion: "product-identity-matching-v2",
      consistencyError: false,
    }],
    consistencyError: false,
  }
}

function account(mlb: string, grossRevenue: string, soldOfferUnits: number) {
  return {
    mlb,
    salesCount: soldOfferUnits,
    soldOfferUnits,
    grossRevenue,
    normalizedPhysicalUnits: String(soldOfferUnits),
    abc: {
      units: { class: "A" as const, rank: 1 },
      grossRevenue: { class: "A" as const, rank: 1 },
    },
  }
}
