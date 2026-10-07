import { FinanceApp } from "@/components/finance/finance-app"
import type { X1Period } from "@/types/x1-product-intelligence"

export default async function ProductIntelligenceX1Route({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const query = await searchParams
  return (
    <FinanceApp
      initialView="product-intelligence"
      initialProductIntelligenceSection="x1"
      initialProductIntelligenceState={{ x1: { period: period(query.days) } }}
    />
  )
}

function period(value: string | string[] | undefined): X1Period {
  return value === "60" ? 60 : value === "90" ? 90 : 30
}
