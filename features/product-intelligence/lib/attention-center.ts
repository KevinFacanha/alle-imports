import type { MlbSalesAbcItem, MlbSalesAbcReport } from "../../../types/mlb-sales-abc.js"
import type { NoSaleListingItem, NoSaleListingsResponse } from "../../../types/no-sale-listings.js"

export interface AttentionCenterView {
  curveDrops: MlbSalesAbcItem[]
  revenueDrops: MlbSalesAbcItem[]
  noSale: {
    from30To59: NoSaleListingItem[]
    from60To89: NoSaleListingItem[]
    from90: NoSaleListingItem[]
  }
}

const transitionPriority = new Map([
  ["A_TO_C", 0],
  ["A_TO_B", 1],
  ["B_TO_C", 2],
])

export function buildAttentionCenter(
  abc: MlbSalesAbcReport | null,
  noSale: NoSaleListingsResponse | null,
): AttentionCenterView {
  const curveDrops = (abc?.mlbs ?? [])
    .filter((item) => item.movement === "DECLINED")
    .sort((left, right) =>
      transitionOrder(left) - transitionOrder(right) ||
      numericDelta(left) - numericDelta(right) ||
      left.mlb.localeCompare(right.mlb),
    )
  const revenueDrops = (abc?.mlbs ?? [])
    .filter((item) => item.revenueMovement === "DECREASED")
    .sort((left, right) =>
      numericDelta(left) - numericDelta(right) ||
      left.mlb.localeCompare(right.mlb),
    )
  const buckets = {
    from30To59: [] as NoSaleListingItem[],
    from60To89: [] as NoSaleListingItem[],
    from90: [] as NoSaleListingItem[],
  }

  for (const listing of noSale?.listings ?? []) {
    const days = noSaleDays(listing)
    if (days >= 90) buckets.from90.push(listing)
    else if (days >= 60) buckets.from60To89.push(listing)
    else if (days >= 30) buckets.from30To59.push(listing)
  }

  const noSaleOrder = (left: NoSaleListingItem, right: NoSaleListingItem) =>
    noSaleDays(right) - noSaleDays(left) ||
    left.account.localeCompare(right.account) ||
    left.mlb.localeCompare(right.mlb)
  buckets.from90.sort(noSaleOrder)
  buckets.from60To89.sort(noSaleOrder)
  buckets.from30To59.sort(noSaleOrder)

  return { curveDrops, revenueDrops, noSale: buckets }
}

export function noSaleDays(listing: NoSaleListingItem): number {
  return listing.daysSinceLastSale ?? listing.observedNoSaleDays
}

function transitionOrder(item: MlbSalesAbcItem): number {
  return transitionPriority.get(item.classTransition ?? "") ?? Number.MAX_SAFE_INTEGER
}

function numericDelta(item: MlbSalesAbcItem): number {
  const value = Number(item.grossRevenueDelta)
  return Number.isFinite(value) ? value : 0
}
