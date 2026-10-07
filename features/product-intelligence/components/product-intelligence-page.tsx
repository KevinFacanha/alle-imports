"use client"

import { useState } from "react"
import { ArrowLeftRight, BarChart3, PackageSearch, ShieldAlert } from "lucide-react"

import type { MlbAbcMovementFilter, MlbAbcScope, MlbRevenueMovementFilter, MlbSalesAbcFilters } from "@/types/mlb-sales-abc"
import type { NoSaleListingsFilters } from "@/types/no-sale-listings"
import type { X1Period } from "@/types/x1-product-intelligence"

import { AttentionCenterPage } from "./attention-center-page"
import { MlbAbcPage } from "./mlb-abc-page"
import { NoSaleListingsPage } from "./no-sale-listings-page"
import { X1ProductIntelligencePage } from "./x1-product-intelligence-page"

export type ProductIntelligenceSection = "attention" | "no-sale" | "abc" | "x1"

export interface ProductIntelligenceInitialState {
  attentionScope?: MlbAbcScope
  abc?: {
    filters: MlbSalesAbcFilters
    search?: string
    revenueMovement?: MlbRevenueMovementFilter
    curveMovement?: MlbAbcMovementFilter
  }
  noSale?: {
    filters: NoSaleListingsFilters
    search?: string
  }
  x1?: {
    period: X1Period
  }
}

export function ProductIntelligencePage({ initialSection = "attention", initialState = {} }: {
  initialSection?: ProductIntelligenceSection
  initialState?: ProductIntelligenceInitialState
}) {
  const [section, setSection] = useState(initialSection)
  return (
    <div className="space-y-6">
      <nav className="inline-flex flex-wrap rounded-xl border border-slate-200 bg-white p-1 shadow-sm" aria-label="Seções de Product Intelligence">
        <Tab active={section === "attention"} onClick={() => setSection("attention")}><ShieldAlert size={15} /> Central de Atenção</Tab>
        <Tab active={section === "no-sale"} onClick={() => setSection("no-sale")}><PackageSearch size={15} /> Anúncios sem venda</Tab>
        <Tab active={section === "abc"} onClick={() => setSection("abc")}><BarChart3 size={15} /> Curva ABC</Tab>
        <Tab active={section === "x1"} onClick={() => setSection("x1")}><ArrowLeftRight size={15} /> X1 C1×C2</Tab>
      </nav>
      {section === "attention" && <AttentionCenterPage initialScope={initialState.attentionScope} />}
      {section === "no-sale" && <NoSaleListingsPage initialFilters={initialState.noSale?.filters} initialSearch={initialState.noSale?.search} />}
      {section === "abc" && (
        <MlbAbcPage
          initialFilters={initialState.abc?.filters}
          initialSearch={initialState.abc?.search}
          initialRevenueMovement={initialState.abc?.revenueMovement}
          initialCurveMovement={initialState.abc?.curveMovement}
        />
      )}
      {section === "x1" && <X1ProductIntelligencePage initialPeriod={initialState.x1?.period} />}
    </div>
  )
}

function Tab({ active, className = "", ...props }: React.ComponentProps<"button"> & { active: boolean }) {
  return <button type="button" aria-current={active ? "page" : undefined} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition ${active ? "bg-[#6254d9] text-white" : "text-slate-500 hover:bg-slate-50"} ${className}`} {...props} />
}
