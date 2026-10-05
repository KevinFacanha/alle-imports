import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type { MlbSalesAbcItem, MlbSalesAbcReport } from "../../../types/mlb-sales-abc.js"
import type { NoSaleListingItem, NoSaleListingsResponse } from "../../../types/no-sale-listings.js"
import { buildAttentionCenter } from "./attention-center.js"

describe("buildAttentionCenter", () => {
  it("prioritizes curve transitions and then the largest revenue loss", () => {
    const view = buildAttentionCenter(
      abcReport([
        abcItem("B-C", "B_TO_C", "-900.00"),
        abcItem("A-B-small", "A_TO_B", "-100.00"),
        abcItem("A-C", "A_TO_C", "-20.00"),
        abcItem("A-B-large", "A_TO_B", "-500.00"),
      ]),
      null,
    )

    assert.deepEqual(view.curveDrops.map(({ mlb }) => mlb), [
      "A-C",
      "A-B-large",
      "A-B-small",
      "B-C",
    ])
  })

  it("includes stable curves in revenue drops and sorts by the most negative delta", () => {
    const stable = abcItem("A-A", "A_TO_A", "-1000.00", "STABLE")
    const declined = abcItem("A-B", "A_TO_B", "-50.00")
    const view = buildAttentionCenter(abcReport([declined, stable]), null)

    assert.deepEqual(view.revenueDrops.map(({ mlb }) => mlb), ["A-A", "A-B"])
  })

  it("creates exclusive no-sale buckets, including listings without a known last sale", () => {
    const view = buildAttentionCenter(null, noSaleReport([
      noSaleItem("30", 30),
      noSaleItem("59", 59),
      noSaleItem("60", 60),
      noSaleItem("89", 89),
      noSaleItem("90", 90),
      noSaleItem("never", 120, null),
    ]))

    assert.deepEqual(view.noSale.from30To59.map(({ mlb }) => mlb), ["59", "30"])
    assert.deepEqual(view.noSale.from60To89.map(({ mlb }) => mlb), ["89", "60"])
    assert.deepEqual(view.noSale.from90.map(({ mlb }) => mlb), ["never", "90"])
  })

  it("handles empty sources", () => {
    assert.deepEqual(buildAttentionCenter(null, null), {
      curveDrops: [],
      revenueDrops: [],
      noSale: { from30To59: [], from60To89: [], from90: [] },
    })
  })
})

function abcReport(mlbs: MlbSalesAbcItem[]): MlbSalesAbcReport {
  return {
    periodStart: "2026-09-06",
    periodEnd: "2026-10-06",
    previousPeriodStart: "2026-09-05",
    previousPeriodEnd: "2026-10-05",
    timezone: "America/Sao_Paulo",
    scope: "CONSOLIDATED",
    metric: "UNITS",
    totalSales: 0,
    totalUnits: 0,
    totalGrossRevenue: "0.00",
    totalMlbs: mlbs.length,
    lastUpdatedAt: null,
    lastSyncedAt: null,
    movementSummary: {
      declined: mlbs.filter(({ movement }) => movement === "DECLINED").length,
      improved: 0,
      stable: 0,
      new: 0,
      aToB: 0,
      aToC: 0,
      bToC: 0,
      revenueDecreased: mlbs.length,
      revenueIncreased: 0,
      grossRevenueLoss: "0.00",
      grossRevenueGain: "0.00",
    },
    mlbs,
  }
}

function abcItem(
  mlb: string,
  classTransition: MlbSalesAbcItem["classTransition"],
  grossRevenueDelta: string,
  movement: MlbSalesAbcItem["movement"] = "DECLINED",
): MlbSalesAbcItem {
  const previousClass = classTransition?.startsWith("A") ? "A" : "B"
  const currentClass = classTransition?.endsWith("C") ? "C" : classTransition?.endsWith("B") ? "B" : "A"
  return {
    mlb,
    title: null,
    account: "C1",
    salesCount: 1,
    unitsSold: 1,
    grossRevenue: "10.00",
    participationPercent: 1,
    cumulativePercent: 1,
    abcClass: currentClass,
    rank: 1,
    currentClass,
    previousClass,
    movement,
    classTransition,
    currentRank: 1,
    previousRank: 1,
    rankDelta: 0,
    currentUnits: 1,
    previousUnits: 1,
    unitsDelta: 0,
    unitsDeltaPercent: 0,
    currentGrossRevenue: "10.00",
    previousGrossRevenue: "20.00",
    grossRevenueDelta,
    grossRevenueDeltaPercent: -50,
    revenueMovement: "DECREASED",
    revenueEnteringWindow: "0.00",
    revenueLeavingWindow: "10.00",
    unitsEnteringWindow: 0,
    unitsLeavingWindow: 1,
  }
}

function noSaleReport(listings: NoSaleListingItem[]): NoSaleListingsResponse {
  return {
    metadata: {
      generatedAt: "2026-10-05T12:00:00.000Z",
      timezone: "America/Sao_Paulo",
      dataThrough: "2026-10-05T12:00:00.000Z",
      historyThrough: "2026-10-05T12:00:00.000Z",
      isDataCurrent: true,
      staleDays: 0,
      thresholdDays: 30,
      account: "ALL",
      listingStatus: "ACTIVE",
      activeOnlyByDefault: true,
      identity: "BUSINESS_ACCOUNT_AND_EXTERNAL_LISTING_ID",
      listingAgeSource: "EARLIEST_LOCAL_EVIDENCE",
      saleDefinition: { includedStatuses: [], excludedStatuses: [], description: "" },
      history: [],
    },
    summary: {
      noSale30d: listings.length,
      noSale60d: listings.filter((item) => (item.daysSinceLastSale ?? item.observedNoSaleDays) >= 60).length,
      noSale90d: listings.filter((item) => (item.daysSinceLastSale ?? item.observedNoSaleDays) >= 90).length,
      potentialRevenueAtRisk: null,
      potentialRevenueAtRiskReason: "",
    },
    total: listings.length,
    listings,
  }
}

function noSaleItem(mlb: string, days: number, daysSinceLastSale: number | null = days): NoSaleListingItem {
  return {
    mlb,
    title: null,
    account: "C1",
    listingStatus: "ACTIVE",
    listingCreatedAt: null,
    listingFirstSeenAt: "2026-01-01T00:00:00.000Z",
    listingAgeDays: days,
    lastSaleAt: daysSinceLastSale === null ? null : "2026-01-01T00:00:00.000Z",
    daysSinceLastSale,
    observedNoSaleDays: days,
    salesCount30d: 0,
    unitsSold30d: 0,
    grossRevenue30d: "0.00",
    abcClass30d: null,
    abcMovement30d: null,
    operationalStatus: daysSinceLastSale === null
      ? "NO_SALE_IN_AVAILABLE_HISTORY"
      : days >= 90
        ? "NO_SALE_90D"
        : days >= 60
          ? "NO_SALE_60D"
          : "NO_SALE_30D",
  }
}
