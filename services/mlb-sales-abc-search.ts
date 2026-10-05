import type {
  MlbAbcMovementFilter,
  MlbRevenueMovementFilter,
  MlbSalesAbcItem,
} from "../types/mlb-sales-abc.js"

export function filterMlbSalesAbcItems(
  items: MlbSalesAbcItem[],
  search: string,
  revenueMovement: MlbRevenueMovementFilter = "ALL",
  curveMovement: MlbAbcMovementFilter = "ALL",
): MlbSalesAbcItem[] {
  const normalized = search.trim().toLocaleLowerCase("pt-BR")
  return items.filter(
    (item) =>
      (revenueMovement === "ALL" || item.revenueMovement === revenueMovement) &&
      (curveMovement === "ALL" || item.movement === curveMovement) &&
      (!normalized ||
        item.mlb.toLocaleLowerCase("pt-BR").includes(normalized) ||
        item.title?.toLocaleLowerCase("pt-BR").includes(normalized)),
  )
}
