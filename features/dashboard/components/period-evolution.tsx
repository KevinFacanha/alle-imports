import { AlertTriangle } from "lucide-react"

import {
  calculateTemporalMetric,
  describeTemporalVariation,
  formatComparisonDate,
  formatComparisonMetric,
  formatTemporalDifference,
  formatTemporalVariation,
  isComparisonPeriodPartial,
  type ComparisonMetricFormat,
  type ComparisonPeriod,
  type TemporalMetricComparison,
} from "@/features/dashboard/lib/comparison-metrics"
import type {
  ComparisonMetricName,
  SellerMetricsComparison,
  SellerMetricsComparisonAccount,
} from "@/types/seller-metrics"

const metrics: {
  name: ComparisonMetricName
  label: string
  format: ComparisonMetricFormat
  usePercentagePoints?: boolean
}[] = [
  { name: "grossSales", label: "Faturamento", format: "currency" },
  { name: "marginRate", label: "Margem", format: "percentage", usePercentagePoints: true },
  { name: "fullGrossSales", label: "Faturamento Full", format: "currency" },
  { name: "averageTicket", label: "Ticket médio", format: "currency" },
  { name: "salesCount", label: "Vendas", format: "integer" },
  { name: "fullSalesCount", label: "Vendas Full", format: "integer" },
]

export function PeriodEvolution({
  current,
  previous,
  previousPeriod,
  state,
}: {
  current: SellerMetricsComparison
  previous: SellerMetricsComparison | null
  previousPeriod: ComparisonPeriod | null
  state: "idle" | "loading" | "success" | "error"
}) {
  const previousIsPartial = previous ? isComparisonPeriodPartial(previous.accounts) : false

  return (
    <section aria-labelledby="period-evolution-title">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3
            id="period-evolution-title"
            className="text-sm font-bold uppercase tracking-[.12em] text-slate-800"
          >
            Evolução do período
          </h3>
          <p className="mt-1 text-xs text-slate-400">
            Período atual vs período anterior de mesma duração
          </p>
        </div>
        {previousPeriod && (
          <p className="text-xs font-medium text-slate-500">
            Anterior: {formatComparisonDate(previousPeriod.from)}–{formatComparisonDate(previousPeriod.to)}
          </p>
        )}
      </div>

      {(state === "error" || (!previous && state !== "loading")) && (
        <EvolutionNotice>
          O período atual permanece disponível, mas a evolução temporal está indisponível.
        </EvolutionNotice>
      )}
      {state === "loading" && !previous && (
        <p className="mb-4 text-xs text-slate-400">Carregando período anterior…</p>
      )}
      {previousIsPartial && previous && (
        <EvolutionNotice>
          Período anterior parcial: {previous.accounts.map((account, index) => (
            <span key={account.marketplaceAccountId} className="ml-1 whitespace-nowrap">
              Conta {index + 1}: {account.availableDays}/{account.expectedDays} dias
              {index < previous.accounts.length - 1 ? ";" : "."}
            </span>
          ))}
        </EvolutionNotice>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {current.accounts.slice(0, 2).map((account, index) => (
          <AccountEvolution
            key={account.marketplaceAccountId}
            current={account}
            previous={previous?.accounts.find(
              (item) => item.marketplaceAccountId === account.marketplaceAccountId,
            ) ?? null}
            accountNumber={index + 1}
          />
        ))}
      </div>
    </section>
  )
}

function EvolutionNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-800">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <p>{children}</p>
    </div>
  )
}

function AccountEvolution({
  current,
  previous,
  accountNumber,
}: {
  current: SellerMetricsComparisonAccount
  previous: SellerMetricsComparisonAccount | null
  accountNumber: number
}) {
  const hasCurrentData = current.availableDays > 0
  const hasPreviousData = Boolean(previous && previous.availableDays > 0)
  const comparisons = metrics.map((metric) => ({
    metric,
    comparison: calculateTemporalMetric(
      hasCurrentData ? current.summary[metric.name] : null,
      hasPreviousData && previous ? previous.summary[metric.name] : null,
      metric.usePercentagePoints,
    ),
  }))
  const accent = accountNumber === 1 ? "bg-[#6254d9]" : "bg-[#0f766e]"

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/30">
      <header className="border-b border-slate-100 px-5 py-4">
        <p className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <span className={`size-2 rounded-full ${accent}`} />
          Conta {accountNumber}
        </p>
        <p className="mt-1 truncate text-xs text-slate-400" title={current.name}>
          {current.name}
        </p>
      </header>

      <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-3">
        <p className="text-[10px] font-bold uppercase tracking-[.1em] text-slate-400">Resumo</p>
        <div className="mt-1 space-y-0.5 text-xs text-slate-600">
          {comparisons.map(({ metric, comparison }) => (
            <p key={metric.name}>
              {describeTemporalVariation(metric.label, comparison, metric.usePercentagePoints)}
            </p>
          ))}
        </div>
      </div>

      <div className="divide-y divide-slate-100">
        {comparisons.map(({ metric, comparison }) => (
          <MetricEvolution
            key={metric.name}
            label={metric.label}
            format={metric.format}
            usePercentagePoints={metric.usePercentagePoints}
            comparison={comparison}
          />
        ))}
      </div>
    </article>
  )
}

function MetricEvolution({
  label,
  format,
  usePercentagePoints,
  comparison,
}: {
  label: string
  format: ComparisonMetricFormat
  usePercentagePoints?: boolean
  comparison: TemporalMetricComparison
}) {
  return (
    <div className="px-5 py-4">
      <p className="text-xs font-bold text-slate-700">{label}</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <EvolutionValue
          label="Atual"
          value={formatComparisonMetric(comparison.current, format)}
        />
        <EvolutionValue
          label="Anterior"
          value={formatComparisonMetric(comparison.previous, format)}
        />
        <EvolutionValue label="Diferença" value={formatTemporalDifference(comparison, format)} />
        <EvolutionValue
          label="Variação"
          value={formatTemporalVariation(comparison, usePercentagePoints)}
        />
      </dl>
    </div>
  )
}

function EvolutionValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[9px] font-bold uppercase tracking-[.08em] text-slate-400">{label}</dt>
      <dd className="mt-1 break-words text-xs font-semibold tabular-nums text-slate-700">{value}</dd>
    </div>
  )
}
