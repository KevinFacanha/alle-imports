"use client"

import { useMemo, useState, type ReactNode } from "react"
import {
  ArrowDown,
  BadgeDollarSign,
  BarChart3,
  Boxes,
  ChartNoAxesCombined,
  PackageSearch,
  RefreshCw,
  Search,
  ShoppingBag,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useMlbSalesAbc } from "@/features/product-intelligence/hooks/use-mlb-sales-abc"
import { MLB_ABC_PERIODS } from "@/services/mlb-sales-abc"
import type {
  MlbAbcClass,
  MlbAbcMetric,
  MlbSalesAbcItem,
  MlbSalesAbcReport,
} from "@/types/mlb-sales-abc"

import { MlbAbcFilters } from "./mlb-abc-filters"

const integer = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 })
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
const percentage = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const abcDefinitions = [
  { abcClass: "A", target: "80%", color: "emerald" },
  { abcClass: "B", target: "15%", color: "amber" },
  { abcClass: "C", target: "5%", color: "slate" },
] as const

export function MlbAbcPage() {
  const abc = useMlbSalesAbc()
  const [search, setSearch] = useState("")
  const normalizedSearch = search.trim().toLocaleLowerCase("pt-BR")
  const visibleMlbs = useMemo(
    () =>
      abc.report?.mlbs.filter(
        (item) =>
          !normalizedSearch ||
          item.mlb.toLocaleLowerCase("pt-BR").includes(normalizedSearch) ||
          item.title?.toLocaleLowerCase("pt-BR").includes(normalizedSearch),
      ) ?? [],
    [abc.report, normalizedSearch],
  )
  const period = MLB_ABC_PERIODS[abc.filters.period]

  return (
    <section className="space-y-6" aria-labelledby="mlb-abc-title">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.14em] text-[#6254d9]">
            <BarChart3 size={14} /> Product Intelligence
          </div>
          <h2 id="mlb-abc-title" className="text-2xl font-bold tracking-[-.035em] text-slate-900 sm:text-3xl">
            Curva ABC por MLB
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            Prioridade comercial dos anúncios pela participação em {metricLabel(abc.filters.metric).toLowerCase()}.
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-left sm:text-right">
          <p className="text-[10px] font-bold uppercase tracking-[.12em] text-slate-400">Janela analisada</p>
          <p className="mt-1 text-xs font-bold text-slate-700">
            {formatDate(period.start)} <span className="mx-1 text-slate-300">→</span> {formatDate(period.end)}
          </p>
        </div>
      </div>

      <MlbAbcFilters
        filters={abc.filters}
        disabled={abc.state === "loading"}
        onPeriodChange={abc.setPeriod}
        onScopeChange={abc.setScope}
        onMetricChange={abc.setMetric}
      />

      {abc.state === "loading" && <MlbAbcLoading />}

      {abc.state === "error" && (
        <StatePanel
          icon={<RefreshCw size={20} />}
          title="Não foi possível carregar a Curva ABC"
          description={abc.errorMessage ?? "Verifique a conexão com a API e tente novamente."}
          tone="error"
          action={
            <Button className="mt-5 rounded-xl bg-[#6254d9] hover:bg-[#5547cd]" onClick={abc.retry}>
              Tentar novamente
            </Button>
          }
        />
      )}

      {abc.state === "empty" && (
        <StatePanel
          icon={<ChartNoAxesCombined size={21} />}
          title="Nenhum MLB encontrado"
          description={`Não há vendas para ${scopeLabel(abc.filters.scope)} nesta janela de ${abc.filters.period} dias.`}
          tone="empty"
        />
      )}

      {abc.state === "success" && abc.report && (
        <div className="space-y-6">
          <ExecutiveCards report={abc.report} />
          <AbcSummary report={abc.report} />
          <MlbTable
            items={visibleMlbs}
            totalItems={abc.report.mlbs.length}
            metric={abc.filters.metric}
            search={search}
            onSearchChange={setSearch}
          />
        </div>
      )}
    </section>
  )
}

function ExecutiveCards({ report }: { report: MlbSalesAbcReport }) {
  const cards = [
    { label: "Vendas", value: integer.format(report.totalSales), icon: ShoppingBag },
    { label: "Unidades", value: integer.format(report.totalUnits), icon: Boxes },
    { label: "Faturamento", value: formatCurrency(report.totalGrossRevenue), icon: BadgeDollarSign },
    { label: "MLBs analisados", value: integer.format(report.totalMlbs), icon: PackageSearch },
  ]

  return (
    <section aria-labelledby="abc-indicators-title">
      <h3 id="abc-indicators-title" className="sr-only">Indicadores do período</h3>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {cards.map(({ label, value, icon: Icon }) => (
          <article key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/30 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-slate-500 sm:text-sm">{label}</p>
                <p className="mt-3 truncate text-xl font-bold tracking-[-.04em] text-slate-900 sm:text-2xl" title={value}>
                  {value}
                </p>
              </div>
              <span className="hidden size-9 shrink-0 place-items-center rounded-xl bg-[#f1efff] text-[#6254d9] sm:grid">
                <Icon size={17} />
              </span>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function AbcSummary({ report }: { report: MlbSalesAbcReport }) {
  const summaries = abcDefinitions.map((definition) => {
    const items = report.mlbs.filter((item) => item.abcClass === definition.abcClass)
    return {
      ...definition,
      count: items.length,
      participation: items.reduce((total, item) => total + item.participationPercent, 0),
    }
  })

  return (
    <section aria-labelledby="abc-summary-title">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h3 id="abc-summary-title" className="text-sm font-bold text-slate-900">Resumo ABC</h3>
          <p className="mt-1 text-xs text-slate-400">Faixas oficiais de 80% · 15% · 5%</p>
        </div>
        <span className="hidden text-[11px] font-semibold text-slate-400 sm:block">
          Participação em {metricLabel(report.metric).toLowerCase()}
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {summaries.map((summary) => (
          <article key={summary.abcClass} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/30">
            <div className={`h-1.5 ${abcBarClass(summary.color)}`} />
            <div className="flex items-center gap-4 p-4 sm:p-5">
              <span className={`grid size-11 shrink-0 place-items-center rounded-xl text-lg font-extrabold ${abcBadgeClass(summary.abcClass)}`}>
                {summary.abcClass}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-slate-400">Faixa {summary.target}</p>
                <p className="mt-1 text-lg font-bold tracking-tight text-slate-900">
                  {integer.format(summary.count)} <span className="text-xs font-semibold text-slate-400">MLBs</span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold tracking-tight text-slate-900">
                  {formatPercentage(summary.participation)}
                </p>
                <p className="text-[10px] font-semibold uppercase tracking-[.1em] text-slate-400">participação</p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function MlbTable({
  items,
  totalItems,
  metric,
  search,
  onSearchChange,
}: {
  items: MlbSalesAbcItem[]
  totalItems: number
  metric: MlbAbcMetric
  search: string
  onSearchChange: (value: string) => void
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/30" aria-labelledby="mlb-ranking-title">
      <div className="flex flex-col gap-4 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div>
          <h3 id="mlb-ranking-title" className="text-sm font-bold text-slate-900">Ranking de anúncios</h3>
          <p className="mt-1 text-xs text-slate-400">
            Ordenado por {metricLabel(metric).toLowerCase()} · {integer.format(totalItems)} MLBs
          </p>
        </div>
        <label className="relative block w-full sm:max-w-xs">
          <span className="sr-only">Buscar por MLB ou título</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <Input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Buscar MLB ou título"
            className="h-10 rounded-xl border-slate-200 bg-slate-50 pl-9 shadow-none"
          />
        </label>
      </div>

      {items.length === 0 ? (
        <div className="grid min-h-52 place-items-center p-8 text-center">
          <div>
            <div className="mx-auto grid size-11 place-items-center rounded-xl bg-slate-100 text-slate-400">
              <Search size={19} />
            </div>
            <p className="mt-3 text-sm font-bold text-slate-800">Nenhum resultado para “{search.trim()}”</p>
            <button className="mt-2 text-xs font-bold text-[#6254d9]" onClick={() => onSearchChange("")}>
              Limpar busca
            </button>
          </div>
        </div>
      ) : (
        <Table>
          <TableHeader className="bg-slate-50/80">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-16 px-4 text-[10px] font-bold uppercase tracking-[.1em] text-slate-400 sm:px-5">Rank</TableHead>
              <TableHead className="min-w-52 text-[10px] font-bold uppercase tracking-[.1em] text-slate-400">MLB / anúncio</TableHead>
              <TableHead className="text-[10px] font-bold uppercase tracking-[.1em] text-slate-400">Conta</TableHead>
              <TableHead className="text-center text-[10px] font-bold uppercase tracking-[.1em] text-slate-400">Curva</TableHead>
              <TableHead className="text-right text-[10px] font-bold uppercase tracking-[.1em] text-slate-400">Vendas</TableHead>
              <MetricTableHead active={metric === "UNITS"}>Unidades</MetricTableHead>
              <MetricTableHead active={metric === "GROSS_REVENUE"}>Faturamento</MetricTableHead>
              <TableHead className="pr-4 text-right text-[10px] font-bold uppercase tracking-[.1em] text-slate-400 sm:pr-5">Participação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={`${item.account}-${item.mlb}`} className="hover:bg-slate-50/70">
                <TableCell className="px-4 py-3.5 font-bold text-slate-400 sm:px-5">#{item.rank}</TableCell>
                <TableCell className="py-3.5">
                  <span className="block font-bold text-slate-900">{item.mlb}</span>
                  {item.title && <span className="mt-0.5 block max-w-80 truncate text-xs text-slate-400" title={item.title}>{item.title}</span>}
                </TableCell>
                <TableCell className="py-3.5 text-xs font-semibold text-slate-500">{formatAccount(item.account)}</TableCell>
                <TableCell className="py-3.5 text-center">
                  <span className={`inline-grid size-7 place-items-center rounded-lg text-xs font-extrabold ${abcBadgeClass(item.abcClass)}`}>
                    {item.abcClass}
                  </span>
                </TableCell>
                <TableCell className="py-3.5 text-right font-semibold text-slate-600">{integer.format(item.salesCount)}</TableCell>
                <TableCell className={`py-3.5 text-right font-semibold ${metric === "UNITS" ? "text-[#6254d9]" : "text-slate-600"}`}>
                  {integer.format(item.unitsSold)}
                </TableCell>
                <TableCell className={`py-3.5 text-right font-semibold ${metric === "GROSS_REVENUE" ? "text-[#6254d9]" : "text-slate-600"}`}>
                  {formatCurrency(item.grossRevenue)}
                </TableCell>
                <TableCell className="pr-4 py-3.5 text-right sm:pr-5">
                  <span className="font-bold text-slate-800">{formatPercentage(item.participationPercent)}</span>
                  <span className="ml-2 inline-block h-1.5 w-10 overflow-hidden rounded-full bg-slate-100 align-middle">
                    <span className="block h-full rounded-full bg-[#6254d9]" style={{ width: `${Math.min(item.participationPercent, 100)}%` }} />
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  )
}

function MetricTableHead({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <TableHead className={`text-right text-[10px] font-bold uppercase tracking-[.1em] ${active ? "text-[#6254d9]" : "text-slate-400"}`}>
      <span className="inline-flex items-center gap-1">
        {children} {active && <ArrowDown size={12} aria-label="Ordenação decrescente" />}
      </span>
    </TableHead>
  )
}

function MlbAbcLoading() {
  return (
    <div className="space-y-6" aria-label="Carregando Curva ABC" aria-busy="true">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-28 rounded-2xl bg-slate-200" />
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-24 rounded-2xl bg-slate-200" />
        ))}
      </div>
      <Skeleton className="h-96 rounded-2xl bg-slate-200" />
    </div>
  )
}

function StatePanel({
  icon,
  title,
  description,
  tone,
  action,
}: {
  icon: ReactNode
  title: string
  description: string
  tone: "error" | "empty"
  action?: ReactNode
}) {
  return (
    <div className={`grid min-h-72 place-items-center rounded-2xl bg-white p-8 text-center ${tone === "error" ? "border border-rose-200" : "border border-dashed border-slate-300"}`}>
      <div>
        <div className={`mx-auto grid size-12 place-items-center rounded-2xl ${tone === "error" ? "bg-rose-50 text-rose-500" : "bg-slate-100 text-slate-400"}`}>
          {icon}
        </div>
        <h3 className="mt-4 font-bold text-slate-900">{title}</h3>
        <p className="mt-2 text-sm text-slate-500">{description}</p>
        {action}
      </div>
    </div>
  )
}

function metricLabel(metric: MlbAbcMetric): string {
  return metric === "UNITS" ? "Unidades" : "Faturamento"
}

function scopeLabel(scope: MlbSalesAbcReport["scope"]): string {
  return scope === "CONSOLIDATED" ? "o consolidado" : `a conta ${scope}`
}

function formatDate(value: string): string {
  const [year, month, day] = value.split("-")
  return `${day}/${month}/${year}`
}

function formatCurrency(value: string): string {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? currency.format(numericValue) : "—"
}

function formatPercentage(value: number): string {
  return `${percentage.format(value)}%`
}

function formatAccount(account: string): string {
  return account.split(",").join(" + ")
}

function abcBadgeClass(abcClass: MlbAbcClass): string {
  if (abcClass === "A") return "bg-emerald-50 text-emerald-700"
  if (abcClass === "B") return "bg-amber-50 text-amber-700"
  return "bg-slate-100 text-slate-600"
}

function abcBarClass(color: (typeof abcDefinitions)[number]["color"]): string {
  if (color === "emerald") return "bg-emerald-400"
  if (color === "amber") return "bg-amber-400"
  return "bg-slate-400"
}
