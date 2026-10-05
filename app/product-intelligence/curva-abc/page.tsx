import { FinanceApp } from "@/components/finance/finance-app"
import type { MlbAbcMetric, MlbAbcMovementFilter, MlbAbcPeriod, MlbAbcScope, MlbRevenueMovementFilter } from "@/types/mlb-sales-abc"

export default async function ProductIntelligenceAbcPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const query = await searchParams
  return (
    <FinanceApp
      initialView="product-intelligence"
      initialProductIntelligenceSection="abc"
      initialProductIntelligenceState={{
        abc: {
          filters: {
            period: period(query.days),
            scope: scope(query.scope),
            metric: metric(query.metric),
          },
          search: scalar(query.search),
          revenueMovement: revenueMovement(query.revenueMovement),
          curveMovement: curveMovement(query.curveMovement),
        },
      }}
    />
  )
}

function scalar(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined
}

function period(value: string | string[] | undefined): MlbAbcPeriod {
  return value === "60" ? 60 : value === "90" ? 90 : 30
}

function scope(value: string | string[] | undefined): MlbAbcScope {
  return value === "C1" || value === "C2" ? value : "CONSOLIDATED"
}

function metric(value: string | string[] | undefined): MlbAbcMetric {
  return value === "GROSS_REVENUE" ? value : "UNITS"
}

function revenueMovement(value: string | string[] | undefined): MlbRevenueMovementFilter {
  return value === "DECREASED" || value === "INCREASED" ? value : "ALL"
}

function curveMovement(value: string | string[] | undefined): MlbAbcMovementFilter {
  return value === "DECLINED" || value === "IMPROVED" ? value : "ALL"
}
