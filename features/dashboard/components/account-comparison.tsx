"use client"

import { useState } from "react"
import {
  AlertTriangle,
  BarChart3,
  RefreshCw,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useAccountComparison } from "@/features/dashboard/hooks/use-account-comparison"
import type { ComparisonMetricName } from "@/types/seller-metrics"

import { CommercialHeader, type CommercialView } from "./commercial-header"
import { ComparisonChart } from "./comparison-chart"
import { ComparisonPerformance } from "./comparison-performance"
import { ComparisonPeriodFilter } from "./comparison-period-filter"
import { ComparisonSummary } from "./comparison-summary"

export function AccountComparison({
  onViewChange,
}: {
  onViewChange: (view: CommercialView) => void
}) {
  const comparison = useAccountComparison()
  const [salesMetric, setSalesMetric] =
    useState<Extract<ComparisonMetricName, "salesCount" | "fullSalesCount">>("salesCount")

  const periodControls = (
    <ComparisonPeriodFilter
      period={comparison.period}
      preset={comparison.preset}
      latestAvailableDate={comparison.latestAvailableDate}
      disabled={comparison.state === "loading" && !comparison.period}
      onPresetChange={comparison.setPreset}
      onShowCustom={comparison.showCustom}
      onCustomPeriodChange={comparison.setCustomPeriod}
    />
  )

  return (
    <section className="space-y-6" aria-labelledby="commercial-intelligence-title">
      <CommercialHeader
        view="comparison"
        controls={periodControls}
        onViewChange={onViewChange}
      />

      {comparison.state === "loading" && <ComparisonLoading />}

      {comparison.state === "error" && (
        <div className="grid min-h-72 place-items-center rounded-2xl border border-rose-200 bg-white p-8 text-center">
          <div>
            <div className="mx-auto grid size-11 place-items-center rounded-full bg-rose-50 text-rose-500">
              <RefreshCw size={19} />
            </div>
            <h3 className="mt-4 font-bold text-slate-900">Erro ao comparar as contas</h3>
            <p className="mt-2 max-w-lg text-sm text-slate-500">{comparison.errorMessage}</p>
            <Button
              className="mt-5 rounded-xl bg-[#6254d9] hover:bg-[#5547cd]"
              onClick={comparison.retry}
            >
              Tentar novamente
            </Button>
          </div>
        </div>
      )}

      {comparison.state === "empty" && (
        <div className="grid min-h-72 place-items-center rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <div>
            <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-slate-100 text-slate-400">
              <BarChart3 size={21} />
            </div>
            <h3 className="mt-4 font-bold text-slate-900">Nenhum dado disponível neste período</h3>
            <p className="mt-2 text-sm text-slate-500">
              Selecione outro intervalo para comparar as contas.
            </p>
          </div>
        </div>
      )}

      {(comparison.state === "success" || comparison.state === "partial") &&
        comparison.comparison && (
          <div className="space-y-7">
            <ComparisonCompleteness
              accounts={comparison.comparison.accounts}
              partial={comparison.state === "partial"}
            />
            <ComparisonSummary accounts={comparison.comparison.accounts} />
            <ComparisonPerformance accounts={comparison.comparison.accounts} />

            <section aria-labelledby="comparison-charts-title">
              <div className="mb-4">
                <h3
                  id="comparison-charts-title"
                  className="text-sm font-bold uppercase tracking-[.12em] text-slate-800"
                >
                  Evolução diária
                </h3>
                <p className="mt-1 text-xs text-slate-400">
                  Conta 1 e Conta 2 no mesmo eixo temporal
                </p>
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                <ComparisonChart
                  title="Faturamento"
                  description="Faturamento bruto por dia"
                  metric="grossSales"
                  format="currency"
                  accounts={comparison.comparison.accounts}
                />
                <ComparisonChart
                  title="Margem de contribuição"
                  description="Percentual de margem por dia"
                  metric="marginRate"
                  format="percentage"
                  accounts={comparison.comparison.accounts}
                />
                <ComparisonChart
                  title="Faturamento Full"
                  description="Faturamento de pedidos Full por dia"
                  metric="fullGrossSales"
                  format="currency"
                  accounts={comparison.comparison.accounts}
                />
                <ComparisonChart
                  title="Ticket médio"
                  description="Valor médio por venda em cada dia"
                  metric="averageTicket"
                  format="currency"
                  accounts={comparison.comparison.accounts}
                />
                <ComparisonChart
                  title="Vendas"
                  description={
                    salesMetric === "salesCount"
                      ? "Quantidade total de vendas por dia"
                      : "Quantidade de vendas Full por dia"
                  }
                  metric={salesMetric}
                  format="integer"
                  accounts={comparison.comparison.accounts}
                  className="xl:col-span-2"
                  action={
                    <SalesMetricToggle value={salesMetric} onChange={setSalesMetric} />
                  }
                />
              </div>
            </section>
          </div>
        )}
    </section>
  )
}

function ComparisonCompleteness({
  accounts,
  partial,
}: {
  accounts: NonNullable<ReturnType<typeof useAccountComparison>["comparison"]>["accounts"]
  partial: boolean
}) {
  return (
    <div
      className={
        partial
          ? "flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          : "flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
      }
    >
      <div className="flex items-center gap-2">
        {partial && <AlertTriangle size={16} className="shrink-0 text-amber-600" />}
        <p className={partial ? "text-xs font-semibold text-amber-800" : "text-xs font-semibold text-slate-500"}>
          {partial
            ? "Comparação parcial: há dias ou indicadores indisponíveis."
            : "Período completo para as duas contas."}
        </p>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
        {accounts.map((account, index) => (
          <span key={account.marketplaceAccountId}>
            <strong className="text-slate-700">Conta {index + 1}:</strong>{" "}
            {account.availableDays}/{account.expectedDays} dias disponíveis
            {account.missingDays > 0 && (
              <span className="text-amber-700"> · {account.missingDays} ausentes</span>
            )}
          </span>
        ))}
      </div>
    </div>
  )
}

function SalesMetricToggle({
  value,
  onChange,
}: {
  value: "salesCount" | "fullSalesCount"
  onChange: (value: "salesCount" | "fullSalesCount") => void
}) {
  return (
    <div
      className="inline-flex self-start rounded-xl border border-slate-200 bg-slate-50 p-1"
      role="group"
      aria-label="Indicador de vendas"
    >
      <button
        type="button"
        aria-pressed={value === "salesCount"}
        onClick={() => onChange("salesCount")}
        className={
          value === "salesCount"
            ? "rounded-lg bg-white px-3 py-1.5 text-[11px] font-bold text-[#6254d9] shadow-sm"
            : "rounded-lg px-3 py-1.5 text-[11px] font-semibold text-slate-500"
        }
      >
        Vendas totais
      </button>
      <button
        type="button"
        aria-pressed={value === "fullSalesCount"}
        onClick={() => onChange("fullSalesCount")}
        className={
          value === "fullSalesCount"
            ? "rounded-lg bg-white px-3 py-1.5 text-[11px] font-bold text-[#6254d9] shadow-sm"
            : "rounded-lg px-3 py-1.5 text-[11px] font-semibold text-slate-500"
        }
      >
        Vendas Full
      </button>
    </div>
  )
}

function ComparisonLoading() {
  return (
    <div className="space-y-7" aria-label="Carregando comparação">
      <Skeleton className="h-14 rounded-2xl bg-slate-200" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-48 rounded-2xl bg-slate-200" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-96 rounded-2xl bg-slate-200" />
        ))}
      </div>
    </div>
  )
}
