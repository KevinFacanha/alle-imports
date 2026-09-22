import type { LucideIcon } from "lucide-react"

import type { SellerMetric, SellerMetricStatus } from "@/types/seller-metrics"

interface SellerMetricCardProps {
  label: string
  metric: SellerMetric
  format: "integer" | "currency" | "percentage" | "ratioPercentage"
  icon: LucideIcon
}

const integer = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 })
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
const percentage = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const sourceLabels: Record<SellerMetric["source"], string> = {
  MERCADO_LIVRE: "Mercado Livre",
  OLIST: "Olist",
  GEFINANCE: "GeFinance",
  DERIVED: "Calculado",
}

const statusLabels: Record<SellerMetricStatus, string> = {
  AVAILABLE: "Disponível",
  UNAVAILABLE: "Indisponível",
  INCOMPATIBLE_SEMANTICS: "Sem compatibilidade",
  PROVISIONAL: "Provisório",
}

export function SellerMetricCard({ label, metric, format, icon: Icon }: SellerMetricCardProps) {
  return (
    <article className="flex min-h-40 flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/30">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-slate-500">{label}</p>
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#f1efff] text-[#6254d9]">
          <Icon size={17} />
        </span>
      </div>
      <p className={`mt-4 font-bold tracking-[-.035em] ${metric.value === null ? "text-xl text-slate-400" : "text-2xl text-slate-900"}`}>
        {formatMetric(metric.value, format)}
      </p>
      <p className="mt-auto pt-4 text-[11px] font-medium text-slate-400">
        {sourceLabels[metric.source]} <span aria-hidden="true">•</span> {statusLabels[metric.status]}
      </p>
    </article>
  )
}

function formatMetric(value: string | null, format: SellerMetricCardProps["format"]): string {
  if (value === null) return "Indisponível"
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) return "Indisponível"

  if (format === "currency") return currency.format(numericValue)
  if (format === "percentage") return `${percentage.format(numericValue)}%`
  if (format === "ratioPercentage") return `${percentage.format(numericValue * 100)}%`
  return integer.format(numericValue)
}
