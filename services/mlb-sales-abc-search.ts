import type { MlbSalesAbcItem } from "../types/mlb-sales-abc.js"

export function filterMlbSalesAbcItems(
  items: MlbSalesAbcItem[],
  search: string,
): MlbSalesAbcItem[] {
  const normalized = search.trim().toLocaleLowerCase("pt-BR")
  if (!normalized) return items
  return items.filter(
    (item) =>
      item.mlb.toLocaleLowerCase("pt-BR").includes(normalized) ||
      item.title?.toLocaleLowerCase("pt-BR").includes(normalized),
  )
}
