import type {
  MlbAbcMovementFilter,
  MlbSalesAbcItem,
} from "../types/mlb-sales-abc.js"

export function filterMlbSalesAbcItems(
  items: MlbSalesAbcItem[],
  search: string,
  movement: MlbAbcMovementFilter = "ALL",
): MlbSalesAbcItem[] {
  const normalized = search.trim().toLocaleLowerCase("pt-BR")
  return items.filter(
    (item) =>
      (movement === "ALL" || item.movement === movement) &&
      (!normalized ||
        item.mlb.toLocaleLowerCase("pt-BR").includes(normalized) ||
        item.title?.toLocaleLowerCase("pt-BR").includes(normalized)),
  )
}
