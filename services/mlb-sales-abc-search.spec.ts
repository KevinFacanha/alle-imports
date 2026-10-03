import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { filterMlbSalesAbcItems } from "./mlb-sales-abc-search.js"
import type { MlbSalesAbcItem } from "../types/mlb-sales-abc.js"

const items = [
  item("MLB123", "Cafeteira Elétrica"),
  item("MLB456", null),
]

describe("filterMlbSalesAbcItems", () => {
  it("searches by MLB and listing title and keeps null titles searchable by MLB", () => {
    assert.deepEqual(filterMlbSalesAbcItems(items, "mlb456"), [items[1]])
    assert.deepEqual(filterMlbSalesAbcItems(items, "CAFETEIRA"), [items[0]])
    assert.deepEqual(filterMlbSalesAbcItems(items, "inexistente"), [])
  })

  it("filters movement together with the text search", () => {
    const movingItems = [
      { ...items[0]!, movement: "DECLINED" as const },
      { ...items[1]!, movement: "IMPROVED" as const },
    ]

    assert.deepEqual(filterMlbSalesAbcItems(movingItems, "", "DECLINED"), [movingItems[0]])
    assert.deepEqual(filterMlbSalesAbcItems(movingItems, "mlb456", "IMPROVED"), [movingItems[1]])
    assert.deepEqual(filterMlbSalesAbcItems(movingItems, "mlb123", "IMPROVED"), [])
  })
})

function item(mlb: string, title: string | null): MlbSalesAbcItem {
  return {
    mlb,
    title,
    account: "C1",
    salesCount: 1,
    unitsSold: 1,
    grossRevenue: "10.00",
    participationPercent: 100,
    cumulativePercent: 100,
    abcClass: "A",
    rank: 1,
    currentClass: "A",
    previousClass: "A",
    movement: "STABLE",
    classTransition: "A_TO_A",
    currentRank: 1,
    previousRank: 1,
    rankDelta: 0,
    currentUnits: 1,
    previousUnits: 1,
    unitsDeltaPercent: 0,
    currentGrossRevenue: "10.00",
    previousGrossRevenue: "10.00",
    grossRevenueDeltaPercent: 0,
  }
}
