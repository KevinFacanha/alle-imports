import {
  BadgeDollarSign,
  ChartNoAxesCombined,
  CircleDollarSign,
  PackageCheck,
  ReceiptText,
  ShoppingBag,
  type LucideIcon,
} from "lucide-react"

import type {
  ComparisonMetricName,
  SellerMetricsComparisonAccount,
} from "@/types/seller-metrics"

type MetricFormat = "currency" | "percentage" | "integer"

const metrics: {
  name: ComparisonMetricName
  label: string
  format: MetricFormat
  icon: LucideIcon
}[] = [
  { name: "grossSales", label: "Faturamento", format: "currency", icon: BadgeDollarSign },
  {
    name: "marginRate",
    label: "Margem de contribuição",
    format: "percentage",
    icon: ChartNoAxesCombined,
  },
  { name: "fullGrossSales", label: "Faturamento Full", format: "currency", icon: CircleDollarSign },
  { name: "averageTicket", label: "Ticket médio", format: "currency", icon: ReceiptText },
  { name: "salesCount", label: "Vendas", format: "integer", icon: ShoppingBag },
  { name: "fullSalesCount", label: "Vendas Full", format: "integer", icon: PackageCheck },
]

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
})
const integer = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 })
const percentage = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function ComparisonSummary({
  accounts,
}: {
  accounts: SellerMetricsComparisonAccount[]
}) {
  const [accountA, accountB] = accounts
  if (!accountA || !accountB) return null

  return (
    <section aria-labelledby="comparison-summary-title">
      <div className="mb-4">
        <h3
          id="comparison-summary-title"
          className="text-sm font-bold uppercase tracking-[.12em] text-slate-800"
        >
          Resumo do período
        </h3>
        <p className="mt-1 text-xs text-slate-400">
          Totais e indicadores consolidados fornecidos pela API
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {metrics.map((metric) => (
          <SummaryCard
            key={metric.name}
            metric={metric}
            accountA={accountA}
            accountB={accountB}
          />
        ))}
      </div>
    </section>
  )
}

function SummaryCard({
  metric,
  accountA,
  accountB,
}: {
  metric: (typeof metrics)[number]
  accountA: SellerMetricsComparisonAccount
  accountB: SellerMetricsComparisonAccount
}) {
  const Icon = metric.icon
  const valueA = accountA.summary[metric.name]
  const valueB = accountB.summary[metric.name]

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/30">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-slate-500">{metric.label}</p>
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#f1efff] text-[#6254d9]">
          <Icon size={17} />
        </span>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-4">
        <AccountValue
          shortName="Conta 1"
          name={accountA.name}
          value={formatMetric(valueA, metric.format)}
          color="bg-[#6254d9]"
        />
        <AccountValue
          shortName="Conta 2"
          name={accountB.name}
          value={formatMetric(valueB, metric.format)}
          color="bg-[#0f766e]"
        />
      </div>
      <p className="mt-4 border-t border-slate-100 pt-3 text-[10px] font-medium text-slate-400">
        {formatDifference(valueA, valueB, metric.format)}
      </p>
    </article>
  )
}

function AccountValue({
  shortName,
  name,
  value,
  color,
}: {
  shortName: string
  name: string
  value: string
  color: string
}) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.08em] text-slate-400">
        <span className={`size-2 rounded-full ${color}`} />
        {shortName}
      </p>
      <p className="mt-1 truncate text-[10px] text-slate-400" title={name}>
        {name}
      </p>
      <p className="mt-2 break-words text-lg font-bold tracking-[-.035em] text-slate-900">
        {value}
      </p>
    </div>
  )
}

function formatMetric(value: string | null, format: MetricFormat): string {
  const numeric = value === null ? Number.NaN : Number(value)
  if (!Number.isFinite(numeric)) return "Indisponível"
  if (format === "currency") return currency.format(numeric)
  if (format === "percentage") return `${percentage.format(numeric)}%`
  return integer.format(numeric)
}

function formatDifference(
  valueA: string | null,
  valueB: string | null,
  format: MetricFormat,
): string {
  const accountA = valueA === null ? Number.NaN : Number(valueA)
  const accountB = valueB === null ? Number.NaN : Number(valueB)
  if (!Number.isFinite(accountA) || !Number.isFinite(accountB)) {
    return "Diferença indisponível"
  }
  const difference = accountA - accountB
  const sign = difference > 0 ? "+" : ""
  if (format === "percentage") {
    return `Diferença C1 − C2: ${sign}${percentage.format(difference)} p.p.`
  }
  return `Diferença C1 − C2: ${sign}${formatMetric(String(difference), format)}`
}
