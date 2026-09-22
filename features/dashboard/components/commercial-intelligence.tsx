"use client"

import {
  BadgeDollarSign,
  Boxes,
  ChartNoAxesCombined,
  CircleDollarSign,
  Eye,
  PackageCheck,
  Percent,
  ReceiptText,
  RefreshCw,
  ShoppingBag,
  Truck,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useSellerMetrics } from "@/features/dashboard/hooks/use-seller-metrics"
import type { SellerMetricName } from "@/types/seller-metrics"

import { SellerMetricCard } from "./seller-metric-card"
import { SellerMetricsFilters } from "./seller-metrics-filters"

const generalMetrics = [
  { name: "salesCount", label: "Vendas", format: "integer", icon: ShoppingBag },
  { name: "unitsSold", label: "Unidades", format: "integer", icon: Boxes },
  { name: "grossSales", label: "Faturamento", format: "currency", icon: BadgeDollarSign },
  { name: "marginRate", label: "Margem de contribuição", format: "percentage", icon: ChartNoAxesCombined },
  { name: "averageTicket", label: "Ticket médio", format: "currency", icon: ReceiptText },
  { name: "visits", label: "Visitas", format: "integer", icon: Eye },
  { name: "conversionRate", label: "Taxa de conversão", format: "percentage", icon: Percent },
] as const

const fullMetrics = [
  { name: "fullSalesCount", label: "Vendas Full", format: "integer", icon: PackageCheck },
  { name: "fullUnitsSold", label: "Unidades Full", format: "integer", icon: Truck },
  { name: "fullGrossSales", label: "Valor Full", format: "currency", icon: CircleDollarSign },
] as const

export function CommercialIntelligence() {
  const sellerMetrics = useSellerMetrics()
  const selectedAccount = sellerMetrics.accounts.find(
    (account) => account.id === sellerMetrics.selectedAccountId,
  )

  return (
    <section className="space-y-6" aria-labelledby="commercial-intelligence-title">
      <div className="flex flex-col gap-5 rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-[#f8f7ff] p-5 sm:p-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-xl">
          <p className="mb-2 text-xs font-bold uppercase tracking-[.15em] text-[#6254d9]">GABI · Comercial</p>
          <h2 id="commercial-intelligence-title" className="text-2xl font-bold tracking-[-.04em] sm:text-3xl">
            Inteligência Comercial
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Indicadores processados e conciliados por conta e data de negócio.
          </p>
        </div>
        <SellerMetricsFilters
          accounts={sellerMetrics.accounts}
          selectedAccountId={sellerMetrics.selectedAccountId}
          selectedDate={sellerMetrics.selectedDate}
          availableDates={sellerMetrics.availableDates}
          disabled={sellerMetrics.state === "loading" && sellerMetrics.accounts.length === 0}
          onAccountChange={sellerMetrics.setAccount}
          onDateChange={sellerMetrics.setDate}
        />
      </div>

      {sellerMetrics.state === "loading" && <MetricsLoading />}

      {sellerMetrics.state === "error" && (
        <div className="grid min-h-72 place-items-center rounded-2xl border border-rose-200 bg-white p-8 text-center">
          <div>
            <div className="mx-auto grid size-11 place-items-center rounded-full bg-rose-50 text-rose-500">
              <RefreshCw size={19} />
            </div>
            <h3 className="mt-4 font-bold text-slate-900">Erro ao consultar a Seller Metrics API</h3>
            <p className="mt-2 text-sm text-slate-500">{sellerMetrics.errorMessage}</p>
            <Button className="mt-5 rounded-xl bg-[#6254d9] hover:bg-[#5547cd]" onClick={sellerMetrics.retry}>
              Tentar novamente
            </Button>
          </div>
        </div>
      )}

      {sellerMetrics.state === "empty" && (
        <div className="grid min-h-72 place-items-center rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <div>
            <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-slate-100 text-slate-400">
              <ChartNoAxesCombined size={21} />
            </div>
            <h3 className="mt-4 font-bold text-slate-900">
              {sellerMetrics.accounts.length === 0
                ? "Nenhuma conta ativa disponível."
                : "Nenhuma métrica processada para esta data."}
            </h3>
            {selectedAccount && (
              <p className="mt-2 text-sm text-slate-500">
                {selectedAccount.name} · {formatBusinessDate(sellerMetrics.selectedDate)}
              </p>
            )}
          </div>
        </div>
      )}

      {sellerMetrics.state === "success" && sellerMetrics.snapshot && (
        <div className="space-y-7">
          <MetricSection
            title="Geral"
            description={`${selectedAccount?.name ?? "Conta"} · ${formatBusinessDate(sellerMetrics.snapshot.businessDate)}`}
            metrics={generalMetrics}
            values={sellerMetrics.snapshot.metrics}
          />
          <MetricSection
            title="Full"
            description="Desempenho dos pedidos classificados como Full"
            metrics={fullMetrics}
            values={sellerMetrics.snapshot.metrics}
          />
          <p className="text-right text-[11px] text-slate-400">
            Processado em {formatCalculatedAt(sellerMetrics.snapshot.calculatedAt)} · {sellerMetrics.snapshot.timezone}
          </p>
        </div>
      )}
    </section>
  )
}

interface MetricDefinition {
  readonly name: SellerMetricName
  readonly label: string
  readonly format: "integer" | "currency" | "percentage" | "ratioPercentage"
  readonly icon: typeof ShoppingBag
}

function MetricSection({
  title,
  description,
  metrics,
  values,
}: {
  title: string
  description: string
  metrics: readonly MetricDefinition[]
  values: NonNullable<ReturnType<typeof useSellerMetrics>["snapshot"]>["metrics"]
}) {
  return (
    <section aria-labelledby={`metric-section-${title.toLowerCase()}`}>
      <div className="mb-4">
        <h3 id={`metric-section-${title.toLowerCase()}`} className="text-sm font-bold uppercase tracking-[.12em] text-slate-800">
          {title}
        </h3>
        <p className="mt-1 text-xs text-slate-400">{description}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <SellerMetricCard key={metric.name} {...metric} metric={values[metric.name]} />
        ))}
      </div>
    </section>
  )
}

function MetricsLoading() {
  return (
    <div className="space-y-7" aria-label="Carregando métricas">
      {[7, 3].map((count, section) => (
        <div key={count}>
          <Skeleton className="mb-4 h-5 w-28 bg-slate-200" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: count }, (_, index) => (
              <Skeleton key={`${section}-${index}`} className="h-40 rounded-2xl bg-slate-200" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function formatBusinessDate(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`))
}

function formatCalculatedAt(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value))
}
