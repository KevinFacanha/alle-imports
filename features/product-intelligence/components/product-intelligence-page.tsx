"use client"

import { useState } from "react"
import { BarChart3, PackageSearch } from "lucide-react"

import { MlbAbcPage } from "./mlb-abc-page"
import { NoSaleListingsPage } from "./no-sale-listings-page"

export type ProductIntelligenceSection = "no-sale" | "abc"

export function ProductIntelligencePage({ initialSection = "no-sale" }: { initialSection?: ProductIntelligenceSection }) {
  const [section, setSection] = useState(initialSection)
  return (
    <div className="space-y-6">
      <nav className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm" aria-label="Seções de Product Intelligence">
        <Tab active={section === "no-sale"} onClick={() => setSection("no-sale")}><PackageSearch size={15} /> Anúncios sem venda</Tab>
        <Tab active={section === "abc"} onClick={() => setSection("abc")}><BarChart3 size={15} /> Curva ABC</Tab>
      </nav>
      {section === "no-sale" ? <NoSaleListingsPage /> : <MlbAbcPage />}
    </div>
  )
}

function Tab({ active, className = "", ...props }: React.ComponentProps<"button"> & { active: boolean }) {
  return <button type="button" aria-current={active ? "page" : undefined} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition ${active ? "bg-[#6254d9] text-white" : "text-slate-500 hover:bg-slate-50"} ${className}`} {...props} />
}
