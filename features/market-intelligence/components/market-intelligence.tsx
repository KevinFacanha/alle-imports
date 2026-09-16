import { ArrowUpRight, ChevronRight, Search } from "lucide-react"

import type { MarketIntelligenceProps } from "@/features/market-intelligence/types"
import {
  listingHealthMetrics,
  marketAdvantages,
  marketCompetitors,
  marketProducts,
  marketSummaryMetrics,
} from "@/mocks/market-intelligence"

export function MarketIntelligence({ product, setProduct }: MarketIntelligenceProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-[.15em] text-[#6254d9]">
            MIRA · Inteligência competitiva
          </p>
          <h2 className="text-3xl font-bold tracking-[-.04em]">Inteligência de Mercado</h2>
          <p className="mt-2 text-sm text-slate-500">
            Entenda sua posição e encontre oportunidades antes da concorrência.
          </p>
        </div>
        <select
          value={product}
          onChange={(event) => setProduct(event.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs font-bold text-slate-700 outline-none"
        >
          <option disabled>Selecione um produto</option>
          {marketProducts.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {marketSummaryMetrics.map(({ label, value, detail, icon: Icon }) => (
          <div key={label} className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="mb-4 flex items-center justify-between text-xs font-semibold text-slate-400">
              <span>{label}</span>
              <Icon size={16} className="text-[#6254d9]" />
            </div>
            <p className="text-2xl font-bold tracking-tight">{value}</p>
            <p className="mt-2 text-[11px] font-bold text-emerald-600">{detail}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-5">
            <h3 className="font-bold">Comparativo de anúncios</h3>
            <p className="mt-1 text-xs text-slate-400">{product} · dados monitorados hoje</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-left text-xs">
              <thead className="border-b border-slate-100 text-[10px] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="pb-3">Vendedor</th>
                  <th className="pb-3">Preço</th>
                  <th className="pb-3">Vendas/mês</th>
                  <th className="pb-3">Posição</th>
                  <th className="pb-3">Sinais</th>
                </tr>
              </thead>
              <tbody>
                {marketCompetitors.map((item, index) => (
                  <tr key={item.name} className="border-b border-slate-50 last:border-0">
                    <td className="py-4 font-bold">
                      {item.name}
                      {index === 0 && (
                        <span className="ml-2 rounded-full bg-slate-100 px-2 py-1 text-[9px] font-semibold text-slate-500">
                          Você
                        </span>
                      )}
                    </td>
                    <td className="font-semibold">{item.price}</td>
                    <td>{item.sales}</td>
                    <td>
                      <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${item.tone}`}>
                        {item.position}
                      </span>
                    </td>
                    <td>
                      <div className="flex gap-1">
                        <span className="rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-bold text-emerald-700">
                          FULL
                        </span>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-bold text-slate-500">
                          4,5 ★
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h3 className="font-bold">Saúde do anúncio</h3>
          <p className="mt-1 text-xs text-slate-400">Indicadores que influenciam sua posição</p>
          <div className="mt-6 flex flex-col gap-5">
            {listingHealthMetrics.map(({ label, value, colorClassName }) => (
              <div
                key={label}
                className="flex items-center justify-between border-b border-slate-100 pb-4 text-sm last:border-0"
              >
                <span className="font-semibold text-slate-600">{label}</span>
                <span className={`font-bold ${colorClassName}`}>{value}</span>
              </div>
            ))}
          </div>
          <button className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-[#6254d9] px-4 py-3 text-xs font-bold text-white">
            Ver recomendação <ArrowUpRight size={14} />
          </button>
        </div>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="mb-5">
          <h3 className="font-bold">Por que esses concorrentes estão na nossa frente?</h3>
          <p className="mt-1 text-xs text-slate-400">Principais diferenças identificadas pela MIRA</p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {marketAdvantages.map((item) => (
            <div key={item.title} className="rounded-2xl bg-slate-50 p-4">
              <div className={`mb-4 grid size-9 place-items-center rounded-xl ${item.backgroundClassName}`}>
                <Search size={16} className={item.tone} />
              </div>
              <h4 className="text-sm font-bold">{item.title}</h4>
              <p className="mt-2 text-xs leading-5 text-slate-500">{item.detail}</p>
              <button className="mt-4 flex items-center gap-1 text-[11px] font-bold text-[#6254d9]">
                Ver diferença <ChevronRight size={13} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
