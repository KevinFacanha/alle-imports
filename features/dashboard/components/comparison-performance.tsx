import {
  BadgeDollarSign,
  ChartNoAxesCombined,
  CircleDollarSign,
  ShoppingBag,
  type LucideIcon,
} from "lucide-react"

import {
  calculatePeriodPerformance,
  formatComparisonDate,
  formatComparisonMetric,
  type ComparisonMetricFormat,
  type DailyMetricPeak,
} from "@/features/dashboard/lib/comparison-metrics"
import type { SellerMetricsComparisonAccount } from "@/types/seller-metrics"

export function ComparisonPerformance({
  accounts,
}: {
  accounts: SellerMetricsComparisonAccount[]
}) {
  if (accounts.length < 2) return null

  return (
    <section aria-labelledby="comparison-performance-title">
      <div className="mb-4">
        <h3
          id="comparison-performance-title"
          className="text-sm font-bold uppercase tracking-[.12em] text-slate-800"
        >
          Desempenho do período
        </h3>
        <p className="mt-1 text-xs text-slate-400">
          Médias e destaques calculados somente com dias disponíveis
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {accounts.slice(0, 2).map((account, index) => (
          <AccountPerformanceCard
            key={account.marketplaceAccountId}
            account={account}
            accountNumber={index + 1}
          />
        ))}
      </div>
    </section>
  )
}

function AccountPerformanceCard({
  account,
  accountNumber,
}: {
  account: SellerMetricsComparisonAccount
  accountNumber: number
}) {
  const performance = calculatePeriodPerformance(account)
  const accent = accountNumber === 1 ? "bg-[#6254d9]" : "bg-[#0f766e]"

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/30">
      <header className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <span className={`size-2 rounded-full ${accent}`} />
            Conta {accountNumber}
          </p>
          <p className="mt-1 truncate text-xs text-slate-400" title={account.name}>
            {account.name}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-slate-50 px-3 py-1 text-[10px] font-semibold text-slate-500">
          {performance.availableDays} {performance.availableDays === 1 ? "dia disponível" : "dias disponíveis"}
        </span>
      </header>

      <div className="grid sm:grid-cols-2">
        <PerformanceItem
          icon={BadgeDollarSign}
          label="Faturamento médio/dia"
          value={formatComparisonMetric(performance.averageGrossSales, "currency")}
        />
        <PerformanceItem
          icon={ShoppingBag}
          label="Média de vendas/dia"
          value={formatComparisonMetric(performance.averageSalesCount, "decimal")}
        />
        <PeakPerformanceItem
          icon={BadgeDollarSign}
          label="Melhor dia em faturamento"
          peak={performance.bestGrossSalesDay}
          format="currency"
        />
        <PeakPerformanceItem
          icon={ShoppingBag}
          label="Maior quantidade de vendas em um dia"
          peak={performance.highestSalesCountDay}
          format="integer"
        />
        <PeakPerformanceItem
          icon={ChartNoAxesCombined}
          label="Maior margem diária"
          peak={performance.highestMarginRateDay}
          format="percentage"
        />
        <PeakPerformanceItem
          icon={CircleDollarSign}
          label="Maior faturamento Full em um dia"
          peak={performance.highestFullGrossSalesDay}
          format="currency"
        />
      </div>
    </article>
  )
}

function PeakPerformanceItem({
  icon,
  label,
  peak,
  format,
}: {
  icon: LucideIcon
  label: string
  peak: DailyMetricPeak | null
  format: ComparisonMetricFormat
}) {
  return (
    <PerformanceItem
      icon={icon}
      label={label}
      value={
        peak
          ? `${formatComparisonDate(peak.date)} · ${formatComparisonMetric(peak.value, format)}`
          : "Indisponível"
      }
    />
  )
}

function PerformanceItem({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon
  label: string
  value: string
}) {
  return (
    <div className="flex min-w-0 gap-3 border-b border-slate-100 px-5 py-4 last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0 sm:[&:nth-child(odd)]:border-r">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#f1efff] text-[#6254d9]">
        <Icon size={15} />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-slate-400">{label}</p>
        <p className="mt-1 text-sm font-bold tabular-nums text-slate-800">{value}</p>
      </div>
    </div>
  )
}
