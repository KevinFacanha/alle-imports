"use client"

import { useMemo, useState, type ReactNode } from "react"
import {
  AlertTriangle,
  ArrowLeftRight,
  ChevronDown,
  Clock3,
  Layers3,
  RefreshCw,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useX1ProductIntelligence } from "@/features/product-intelligence/hooks/use-x1-product-intelligence"
import {
  isX1DataStale,
  summarizeX1,
  x1PrimaryTitle,
} from "@/features/product-intelligence/lib/x1-product-intelligence"
import type {
  X1AbcClassification,
  X1Component,
  X1MlbPair,
  X1Period,
  X1ProductIntelligenceResponse,
} from "@/types/x1-product-intelligence"

const integer = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 })
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
const percentage = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 })

export function X1ProductIntelligencePage({ initialPeriod = 30 }: { initialPeriod?: X1Period }) {
  const x1 = useX1ProductIntelligence(initialPeriod)
  const summary = useMemo(() => x1.report ? summarizeX1(x1.report) : null, [x1.report])
  const stale = x1.report ? isX1DataStale(x1.report.metadata.generatedAt) : false

  return (
    <section className="space-y-6" aria-labelledby="x1-title">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.14em] text-[#6254d9]">
            <ArrowLeftRight size={14} /> Product Intelligence
          </div>
          <h2 id="x1-title" className="text-2xl font-bold tracking-[-.035em] text-slate-900 sm:text-3xl">
            X1 C1×C2
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            Comparação direta de anúncios equivalentes, com métricas calculadas apenas para pares totalmente comparáveis.
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-left sm:text-right">
          <p className="text-[10px] font-bold uppercase tracking-[.12em] text-slate-400">Dados até</p>
          <p className="mt-1 text-xs font-bold text-slate-700">
            {x1.report ? formatDate(x1.report.metadata.periodEnd) : `Últimos ${x1.period} dias fechados`}
          </p>
          <p className={`mt-1 text-[10px] font-semibold ${stale ? "text-amber-700" : "text-slate-400"}`} aria-live="polite">
            {x1.isRefreshing
              ? "Atualizando…"
              : x1.report
                ? `${stale ? "Dados desatualizados" : "Atualizado"} em ${formatDateTime(x1.report.metadata.generatedAt)}`
                : "Aguardando dados"}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/30 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div>
          <p className="text-xs font-bold text-slate-800">Período analisado</p>
          <p className="mt-1 text-[11px] text-slate-400">Dias civis fechados · fuso America/Sao_Paulo</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-xl bg-slate-100 p-1" aria-label="Selecionar período">
            {([30, 60, 90] as const).map((period) => (
              <button
                key={period}
                type="button"
                aria-pressed={x1.period === period}
                disabled={x1.state === "loading"}
                onClick={() => x1.setPeriod(period)}
                className={`rounded-lg px-3 py-2 text-xs font-bold transition disabled:opacity-50 ${x1.period === period ? "bg-white text-[#6254d9] shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
              >
                {period}D
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="icon"
            className="size-10 rounded-xl border-slate-200"
            onClick={x1.refresh}
            disabled={x1.state === "loading" || x1.isRefreshing}
            aria-label="Atualizar comparativo"
            title="Atualizar agora"
          >
            <RefreshCw className={x1.isRefreshing ? "animate-spin" : ""} size={16} />
          </Button>
        </div>
      </div>

      {x1.state === "loading" && <Loading />}
      {x1.state === "error" && (
        <StatePanel
          icon={<RefreshCw size={21} />}
          title="Não foi possível carregar o X1 C1×C2"
          description={x1.errorMessage ?? "Verifique a conexão com a API e tente novamente."}
          tone="error"
          action={<Button onClick={x1.retry}>Tentar novamente</Button>}
        />
      )}
      {x1.state === "empty" && (
        <StatePanel
          icon={<ArrowLeftRight size={21} />}
          title="Nenhum par totalmente comparável"
          description={`Não há pares com cobertura completa na janela de ${x1.period} dias.`}
          tone="empty"
        />
      )}
      {x1.state === "success" && x1.report && summary && (
        <div className="space-y-6">
          {stale && <StaleBanner report={x1.report} onRefresh={x1.refresh} refreshing={x1.isRefreshing} />}
          <Coverage report={x1.report} />
          <Summary summary={summary} />
          <PairsTable pairs={x1.report.pairs} />
        </div>
      )}
    </section>
  )
}

function Coverage({ report }: { report: X1ProductIntelligenceResponse }) {
  return (
    <section className="grid overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/30 md:grid-cols-2" aria-labelledby="x1-coverage-title">
      <h3 id="x1-coverage-title" className="sr-only">Cobertura da comparação</h3>
      <div className="flex items-start gap-3 p-4 sm:p-5">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><Layers3 size={18} /></span>
        <div>
          <p className="text-xl font-extrabold tracking-tight text-slate-900">{integer.format(report.coverage.fullyComparableMlbPairs)}</p>
          <p className="text-sm font-bold text-slate-700">pares totalmente comparáveis</p>
          <p className="mt-1 text-xs leading-5 text-slate-400">Incluídos em todos os totais e na tabela abaixo.</p>
        </div>
      </div>
      <div className="flex items-start gap-3 border-t border-slate-100 p-4 sm:p-5 md:border-l md:border-t-0">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-700"><Clock3 size={18} /></span>
        <div>
          <p className="text-xl font-extrabold tracking-tight text-slate-900">{integer.format(report.coverage.reviewRequiredMlbPairs)}</p>
          <p className="text-sm font-bold text-slate-700">pares aguardando revisão</p>
          <p className="mt-1 text-xs leading-5 text-slate-400">Excluídos das métricas principais e sem comparação completa.</p>
        </div>
      </div>
    </section>
  )
}

function Summary({ summary }: { summary: ReturnType<typeof summarizeX1> }) {
  const metrics = [
    { label: "Pares comparados", value: integer.format(summary.pairCount) },
    { label: "Faturamento C1", value: currency.format(summary.c1GrossRevenue) },
    { label: "Faturamento C2", value: currency.format(summary.c2GrossRevenue) },
    { label: "Diferença C1 − C2", value: signedCurrency(summary.grossRevenueDelta) },
    { label: "Unidades de oferta C1 / C2", value: `${integer.format(summary.c1OfferUnits)} / ${integer.format(summary.c2OfferUnits)}` },
  ]
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/30" aria-labelledby="x1-summary-title">
      <h3 id="x1-summary-title" className="sr-only">Resumo do comparativo</h3>
      <div className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-5">
        {metrics.map((metric) => (
          <div key={metric.label} className="min-w-0 p-4 sm:p-5">
            <p className="text-[10px] font-bold uppercase tracking-[.1em] text-slate-400">{metric.label}</p>
            <p className="mt-2 truncate text-lg font-extrabold tracking-tight text-slate-900" title={metric.value}>{metric.value}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function PairsTable({ pairs }: { pairs: X1MlbPair[] }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/30" aria-labelledby="x1-pairs-title">
      <div className="border-b border-slate-100 p-4 sm:p-5">
        <h3 id="x1-pairs-title" className="text-sm font-bold text-slate-900">Comparação por par MLB</h3>
        <p className="mt-1 text-xs text-slate-400">Diferenças calculadas como C1 − C2. Nenhum vencedor é atribuído automaticamente.</p>
      </div>
      <Table>
        <TableHeader className="bg-slate-50/80">
          <TableRow className="hover:bg-transparent">
            <Head className="min-w-64 pl-5">Produto / MLBs</Head>
            <Head className="text-right">Vendas C1 / C2</Head>
            <Head className="text-right">Unidades C1 / C2</Head>
            <Head className="min-w-48 text-right">Faturamento C1 / C2</Head>
            <Head className="min-w-40 text-right">Delta R$ / %</Head>
            <Head className="min-w-32 text-center">ABC C1</Head>
            <Head className="min-w-32 text-center">ABC C2</Head>
            <Head className="w-16 pr-5 text-right">Itens</Head>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pairs.map((pair) => <PairRows key={`${pair.c1.mlb}-${pair.c2.mlb}`} pair={pair} />)}
        </TableBody>
      </Table>
    </section>
  )
}

function PairRows({ pair }: { pair: X1MlbPair }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <>
      <TableRow className="group hover:bg-slate-50/70">
        <TableCell className="whitespace-normal py-4 pl-5">
          <p className="max-w-80 font-bold leading-5 text-slate-900" title={x1PrimaryTitle(pair)}>{x1PrimaryTitle(pair)}</p>
          <p className="mt-1 text-[11px] font-semibold text-slate-400">{pair.c1.mlb} <span className="mx-1 text-slate-300">×</span> {pair.c2.mlb}</p>
        </TableCell>
        <ComparisonCell c1={integer.format(pair.c1.salesCount)} c2={integer.format(pair.c2.salesCount)} />
        <ComparisonCell c1={integer.format(pair.c1.soldOfferUnits)} c2={integer.format(pair.c2.soldOfferUnits)} />
        <ComparisonCell c1={currency.format(Number(pair.c1.grossRevenue))} c2={currency.format(Number(pair.c2.grossRevenue))} />
        <TableCell className="text-right">
          <p className="font-bold text-slate-800">{signedCurrency(Number(pair.deltas.grossRevenue.absolute))}</p>
          <p className="mt-1 text-[11px] font-semibold text-slate-400">{signedPercentage(pair.deltas.grossRevenue.percent)}</p>
        </TableCell>
        <TableCell><AbcCell abc={pair.c1.abc} /></TableCell>
        <TableCell><AbcCell abc={pair.c2.abc} /></TableCell>
        <TableCell className="pr-5 text-right">
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-bold text-[#6254d9] hover:bg-[#f1efff]"
          >
            {integer.format(pair.components.length)} <ChevronDown className={`transition ${expanded ? "rotate-180" : ""}`} size={14} />
          </button>
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow className="bg-slate-50/60 hover:bg-slate-50/60">
          <TableCell colSpan={8} className="p-0 whitespace-normal">
            <ComponentDetails pair={pair} />
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

function ComponentDetails({ pair }: { pair: X1MlbPair }) {
  return (
    <div className="px-5 py-4">
      <p className="mb-3 text-[10px] font-bold uppercase tracking-[.1em] text-slate-400">Componentes confirmados</p>
      <div className="grid gap-2">
        {pair.components.map((component, index) => (
          <ComponentRow key={`${component.c1SellableId}-${component.c2SellableId}-${component.baseProduct.id}-${index}`} component={component} />
        ))}
      </div>
    </div>
  )
}

function ComponentRow({ component }: { component: X1Component }) {
  return (
    <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 text-xs md:grid-cols-[1.3fr_1.3fr_1.8fr_.8fr_.7fr_1.4fr] md:items-center">
      <Detail label="Sellable C1" value={component.c1SellableId} />
      <Detail label="Sellable C2" value={component.c2SellableId} />
      <Detail label="Product base" value={`${component.baseProduct.name} · ${component.baseProduct.sku} · ${component.baseProduct.id}`} />
      <Detail label="Composição C1 / C2" value={`${formatQuantity(component.compositionQuantity.c1)} / ${formatQuantity(component.compositionQuantity.c2)}`} />
      <Detail label="Confiança" value={formatConfidence(component.confidence)} />
      <Detail label="Matching version" value={component.matchingVersion} />
    </div>
  )
}

function ComparisonCell({ c1, c2 }: { c1: string; c2: string }) {
  return (
    <TableCell className="text-right">
      <p className="font-bold text-slate-800">{c1}</p>
      <p className="mt-1 text-xs font-semibold text-slate-400">{c2}</p>
    </TableCell>
  )
}

function AbcCell({ abc }: { abc: X1MlbPair["c1"]["abc"] }) {
  return (
    <div className="flex justify-center gap-1.5">
      <AbcBadge label="Un." classification={abc.units} />
      <AbcBadge label="R$" classification={abc.grossRevenue} />
    </div>
  )
}

function AbcBadge({ label, classification }: { label: string; classification: X1AbcClassification }) {
  const value = classification.class ?? "—"
  const className = value === "A"
    ? "bg-emerald-50 text-emerald-700"
    : value === "B"
      ? "bg-amber-50 text-amber-700"
      : value === "C"
        ? "bg-slate-100 text-slate-600"
        : "bg-slate-50 text-slate-400"
  return (
    <span className={`inline-flex min-w-10 flex-col items-center rounded-lg px-2 py-1 ${className}`} title={classification.rank ? `Rank #${classification.rank}` : "Sem classificação"}>
      <span className="text-[9px] font-bold uppercase opacity-70">{label}</span>
      <span className="text-xs font-extrabold">{value}</span>
    </span>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><p className="text-[9px] font-bold uppercase tracking-[.08em] text-slate-400">{label}</p><p className="mt-1 break-words font-semibold text-slate-700">{value}</p></div>
}

function StaleBanner({ report, onRefresh, refreshing }: {
  report: X1ProductIntelligenceResponse
  onRefresh: () => void
  refreshing: boolean
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900 sm:flex-row sm:items-center sm:justify-between" role="status">
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 shrink-0" size={18} />
        <div>
          <p className="text-sm font-bold">Os dados podem estar desatualizados</p>
          <p className="mt-1 text-xs leading-5 text-amber-800">Dados até {formatDate(report.metadata.periodEnd)} · resposta gerada em {formatDateTime(report.metadata.generatedAt)}.</p>
        </div>
      </div>
      <Button variant="outline" size="sm" className="border-amber-300 bg-white" onClick={onRefresh} disabled={refreshing}><RefreshCw className={refreshing ? "animate-spin" : ""} size={14} /> Atualizar</Button>
    </div>
  )
}

function Loading() {
  return <div className="space-y-6" aria-label="Carregando X1 C1×C2" aria-busy="true"><Skeleton className="h-28 rounded-2xl" /><Skeleton className="h-24 rounded-2xl" /><Skeleton className="h-96 rounded-2xl" /></div>
}

function StatePanel({ icon, title, description, tone, action }: {
  icon: ReactNode
  title: string
  description: string
  tone: "error" | "empty"
  action?: ReactNode
}) {
  return (
    <div className={`grid min-h-72 place-items-center rounded-2xl bg-white p-8 text-center ${tone === "error" ? "border border-rose-200" : "border border-dashed border-slate-300"}`}>
      <div>
        <div className={`mx-auto grid size-12 place-items-center rounded-2xl ${tone === "error" ? "bg-rose-50 text-rose-500" : "bg-slate-100 text-slate-400"}`}>{icon}</div>
        <h3 className="mt-4 font-bold text-slate-900">{title}</h3>
        <p className="mt-2 text-sm text-slate-500">{description}</p>
        {action && <div className="mt-5">{action}</div>}
      </div>
    </div>
  )
}

function Head({ className = "", ...props }: React.ComponentProps<typeof TableHead>) {
  return <TableHead className={`text-[10px] font-bold uppercase tracking-[.1em] text-slate-400 ${className}`} {...props} />
}

function signedCurrency(value: number): string {
  if (value === 0) return currency.format(0)
  return `${value > 0 ? "+" : "−"}${currency.format(Math.abs(value))}`
}

function signedPercentage(value: number | null): string {
  if (value === null) return "Base C2 igual a zero"
  if (value === 0) return "0,0%"
  return `${value > 0 ? "+" : "−"}${percentage.format(Math.abs(value))}%`
}

function formatConfidence(value: string): string {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return "—"
  return `${percentage.format(parsed * 100)}%`
}

function formatQuantity(value: string | null): string {
  if (value === null) return "—"
  const parsed = Number(value)
  return Number.isFinite(parsed) ? decimal.format(parsed) : value
}

function formatDate(value: string): string {
  const [year, month, day] = value.split("-")
  return `${day}/${month}/${year}`
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(date)
}
