import { FinanceApp } from "@/components/finance/finance-app"
import type { MlbAbcScope } from "@/types/mlb-sales-abc"

export default async function ProductIntelligenceRoute({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const query = await searchParams
  return (
    <FinanceApp
      initialView="product-intelligence"
      initialProductIntelligenceSection="attention"
      initialProductIntelligenceState={{ attentionScope: scope(query.scope) }}
    />
  )
}

function scope(value: string | string[] | undefined): MlbAbcScope {
  return value === "C1" || value === "C2" ? value : "CONSOLIDATED"
}
