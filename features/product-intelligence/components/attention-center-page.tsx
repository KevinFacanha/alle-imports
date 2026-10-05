"use client"

import Link from "next/link"
import type { ReactNode } from "react"
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Clock3,
  PackageSearch,
  RefreshCw,
  ShieldAlert,
  TrendingDown,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useAttentionCenter } from "@/features/product-intelligence/hooks/use-attention-center"
import {
  buildAttentionCenter,
  noSaleDays,
} from "@/features/product-intelligence/lib/attention-center"
import { noSaleStaleBanner } from "@/features/product-intelligence/lib/no-sale-data-coverage"
import {
  formatAbcCurrency,
  formatSignedAbcPercentage,
} from "@/services/mlb-sales-abc-format"
import type { MlbAbcScope, MlbSalesAbcItem } from "@/types/mlb-sales-abc"
import type { NoSaleListingItem } from "@/types/no-sale-listings"

const integer = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 })
const scopes: Array<{ value: MlbAbcScope; label: string }> = [
  { value: "CONSOLIDATED", label: "Todos" },
  { value: "C1", label: "C1" },
  { value: "C2", label: "C2" },
]

export function AttentionCenterPage({ initialScope = "CONSOLIDATED" }: { initialScope?: MlbAbcScope }) {
  const attention = useAttentionCenter(initialScope)
  const view = buildAttentionCenter(attention.abcReport, attention.noSaleReport)
  const stale = attention.noSaleReport
    ? noSaleStaleBanner(attention.noSaleReport.metadata, formatDate)
    : null
  const abcQuery = new URLSearchParams({
    days: "30",
    scope: attention.scope,
    metric: "UNITS",
  })
  const noSaleAccount = attention.scope === "CONSOLIDATED" ? "ALL" : attention.scope
  const isInitialLoading = !attention.abcReport && !attention.noSaleReport &&
    (attention.abcState === "loading" || attention.noSaleState === "loading")
  const hasNoAlerts = attention.abcReport !== null && attention.noSaleReport !== null &&
    view.curveDrops.length === 0 && view.revenueDrops.length === 0 &&
    attention.noSaleReport.summary.noSale30d === 0

  return (
    <section className="space-y-6" aria-labelledby="attention-center-title">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.14em] text-[#6254d9]">
            <ShieldAlert size={14} /> Product Intelligence
          </div>
          <h2 id="attention-center-title" className="text-2xl font-bold tracking-[-.035em] text-slate-900 sm:text-3xl">
            Central de Atenção
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            O que precisa da sua atenção hoje, priorizado por queda de curva, perda de faturamento e tempo sem venda.
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-left lg:text-right">
          <p className="text-[10px] font-bold uppercase tracking-[.12em] text-slate-400">ABC 30D · mesma janela −1 dia</p>
          <p className="mt-1 text-xs font-bold text-slate-700" aria-live="polite">
            {attention.isRefreshing
              ? "Atualizando…"
              : attention.abcReport
                ? `${formatDate(attention.abcReport.periodStart)} → ${formatExclusiveEnd(attention.abcReport.periodEnd)}`
                : "Aguardando dados"}
          </p>
          <p className="mt-1 text-[10px] font-semibold text-slate-400">
            {attention.abcReport?.lastUpdatedAt
              ? `Pedidos atualizados em ${formatDateTime(attention.abcReport.lastUpdatedAt)}`
              : "Sem atualização de pedidos informada"}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/30 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.16em] text-slate-400">Conta</p>
          <p className="mt-1 text-xs text-slate-500">A classificação é recalculada no escopo selecionado.</p>
        </div>
        <div className="flex min-w-72 rounded-xl bg-slate-100 p-1" aria-label="Filtrar por conta">
          {scopes.map((scope) => (
            <button
              key={scope.value}
              type="button"
              aria-pressed={attention.scope === scope.value}
              disabled={isInitialLoading}
              onClick={() => attention.setScope(scope.value)}
              className={`min-w-0 flex-1 rounded-lg px-3 py-2 text-xs font-bold transition disabled:cursor-wait disabled:opacity-60 ${attention.scope === scope.value ? "bg-white text-[#6254d9] shadow-sm" : "text-slate-500 hover:bg-white/60"}`}
            >
              {scope.label}
            </button>
          ))}
        </div>
      </div>

      {isInitialLoading && <Loading />}

      {!isInitialLoading && (
        <>
          {(attention.abcState === "error" || attention.noSaleState === "error") && (
            <PartialError
              abcError={attention.abcError}
              noSaleError={attention.noSaleError}
              onRetry={attention.retry}
            />
          )}

          {stale && (
            <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900" role="status">
              <Clock3 className="mt-0.5 shrink-0" size={18} />
              <div>
                <p className="text-sm font-bold">{stale.title}</p>
                {stale.detail && <p className="mt-1 text-xs text-amber-800">{stale.detail}</p>}
              </div>
            </div>
          )}

          {hasNoAlerts && (
            <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-800">
              <CheckCircle2 size={21} />
              <div>
                <p className="text-sm font-bold">Nenhum alerta para hoje</p>
                <p className="mt-1 text-xs">Não há quedas de curva, perdas de faturamento nem anúncios ativos sem venda há 30 dias.</p>
              </div>
            </div>
          )}

          <SummaryCards
            abc={attention.abcReport}
            noSale={attention.noSaleReport}
            abcQuery={abcQuery}
            noSaleAccount={noSaleAccount}
          />

          <section className="space-y-4" aria-labelledby="priority-title">
            <div>
              <h3 id="priority-title" className="text-lg font-bold tracking-tight text-slate-900">Atenção prioritária</h3>
              <p className="mt-1 text-xs text-slate-400">Até cinco itens por grupo · clique para investigar com os filtros preservados</p>
            </div>
            <div className="grid gap-5 xl:grid-cols-3">
              <PriorityGroup
                title="Quedas de curva"
                description="A→C, A→B e B→C; maior perda primeiro dentro da transição."
                count={view.curveDrops.length}
                icon={<BarChart3 size={18} />}
                tone="rose"
                empty={attention.abcState === "success" && view.curveDrops.length === 0}
                unavailable={!attention.abcReport}
              >
                {view.curveDrops.slice(0, 5).map((item) => (
                  <AbcAttentionItem
                    key={`${item.account}-${item.mlb}`}
                    item={item}
                    href={abcHref(abcQuery, item, "curve")}
                  />
                ))}
              </PriorityGroup>

              <PriorityGroup
                title="Maiores quedas de faturamento"
                description="Inclui anúncios que permaneceram na mesma curva."
                count={view.revenueDrops.length}
                icon={<TrendingDown size={18} />}
                tone="orange"
                empty={attention.abcState === "success" && view.revenueDrops.length === 0}
                unavailable={!attention.abcReport}
              >
                {view.revenueDrops.slice(0, 5).map((item) => (
                  <AbcAttentionItem
                    key={`${item.account}-${item.mlb}`}
                    item={item}
                    href={abcHref(abcQuery, item, "revenue")}
                  />
                ))}
              </PriorityGroup>

              <PriorityGroup
                title="Anúncios sem venda"
                description="90+d, 60–89d e 30–59d, nesta ordem."
                count={attention.noSaleReport?.summary.noSale30d ?? 0}
                icon={<PackageSearch size={18} />}
                tone="amber"
                empty={attention.noSaleState === "success" && attention.noSaleReport?.summary.noSale30d === 0}
                unavailable={!attention.noSaleReport}
              >
                {[
                  ...view.noSale.from90,
                  ...view.noSale.from60To89,
                  ...view.noSale.from30To59,
                ].slice(0, 5).map((item) => (
                  <NoSaleAttentionItem
                    key={`${item.account}-${item.mlb}`}
                    item={item}
                    href={noSaleHref(noSaleAccount, item)}
                  />
                ))}
              </PriorityGroup>
            </div>
          </section>
        </>
      )}
    </section>
  )
}

function SummaryCards({ abc, noSale, abcQuery, noSaleAccount }: {
  abc: ReturnType<typeof useAttentionCenter>["abcReport"]
  noSale: ReturnType<typeof useAttentionCenter>["noSaleReport"]
  abcQuery: URLSearchParams
  noSaleAccount: "ALL" | "C1" | "C2"
}) {
  const summary = noSale?.summary
  const noSale30To59 = summary ? Math.max(0, summary.noSale30d - summary.noSale60d) : null
  const noSale60To89 = summary ? Math.max(0, summary.noSale60d - summary.noSale90d) : null
  const cards = [
    {
      label: "Quedas de curva",
      value: abc ? integer.format(abc.movementSummary.declined) : "—",
      detail: "MLBs que perderam classe",
      href: `/product-intelligence/curva-abc?${withQuery(abcQuery, { curveMovement: "DECLINED" })}`,
      tone: "rose",
      icon: ArrowDownRight,
    },
    {
      label: "A→B / A→C / B→C",
      value: abc ? `${integer.format(abc.movementSummary.aToB)} / ${integer.format(abc.movementSummary.aToC)} / ${integer.format(abc.movementSummary.bToC)}` : "—",
      detail: "transições de queda",
      href: `/product-intelligence/curva-abc?${withQuery(abcQuery, { curveMovement: "DECLINED" })}`,
      tone: "rose",
      icon: BarChart3,
    },
    {
      label: "MLBs com queda",
      value: abc ? integer.format(abc.movementSummary.revenueDecreased) : "—",
      detail: "de faturamento",
      href: `/product-intelligence/curva-abc?${withQuery(abcQuery, { revenueMovement: "DECREASED" })}`,
      tone: "rose",
      icon: TrendingDown,
    },
    {
      label: "Perda bruta agregada",
      value: abc ? formatAbcCurrency(abc.movementSummary.grossRevenueLoss) : "—",
      detail: "sem compensar ganhos",
      href: `/product-intelligence/curva-abc?${withQuery(abcQuery, { revenueMovement: "DECREASED" })}`,
      tone: "rose",
      icon: TrendingDown,
    },
    {
      label: "MLBs com aumento",
      value: abc ? integer.format(abc.movementSummary.revenueIncreased) : "—",
      detail: "de faturamento",
      href: `/product-intelligence/curva-abc?${withQuery(abcQuery, { revenueMovement: "INCREASED" })}`,
      tone: "emerald",
      icon: ArrowUpRight,
    },
    {
      label: "Ganho bruto agregado",
      value: abc ? formatAbcCurrency(abc.movementSummary.grossRevenueGain) : "—",
      detail: "sem compensar perdas",
      href: `/product-intelligence/curva-abc?${withQuery(abcQuery, { revenueMovement: "INCREASED" })}`,
      tone: "emerald",
      icon: ArrowUpRight,
    },
    {
      label: "Sem venda 30–59d",
      value: noSale30To59 === null ? "—" : integer.format(noSale30To59),
      detail: "anúncios ativos",
      href: noSaleSummaryHref(noSaleAccount, 30),
      tone: "amber",
      icon: Clock3,
    },
    {
      label: "Sem venda 60–89d",
      value: noSale60To89 === null ? "—" : integer.format(noSale60To89),
      detail: "anúncios ativos",
      href: noSaleSummaryHref(noSaleAccount, 60),
      tone: "orange",
      icon: AlertTriangle,
    },
    {
      label: "Sem venda 90+d",
      value: summary ? integer.format(summary.noSale90d) : "—",
      detail: "anúncios ativos",
      href: noSaleSummaryHref(noSaleAccount, 90),
      tone: "rose",
      icon: ShieldAlert,
    },
  ] as const

  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Resumo dos alertas">
      {cards.map(({ label, value, detail, href, tone, icon: Icon }) => (
        <Link key={label} href={href} className={`group rounded-2xl border bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${toneClass(tone)}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold">{label}</p>
              <p className="mt-2 truncate text-2xl font-extrabold tracking-tight" title={value}>{value}</p>
              <p className="mt-1 text-[10px] font-semibold opacity-70">{detail}</p>
            </div>
            <Icon className="shrink-0 opacity-70" size={18} />
          </div>
        </Link>
      ))}
    </section>
  )
}

function PriorityGroup({ title, description, count, icon, tone, empty, unavailable, children }: {
  title: string
  description: string
  count: number
  icon: ReactNode
  tone: "rose" | "orange" | "amber"
  empty: boolean
  unavailable: boolean
  children: ReactNode
}) {
  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/30">
      <div className={`h-1.5 ${toneBar(tone)}`} />
      <div className="flex items-start gap-3 border-b border-slate-100 p-4 sm:p-5">
        <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${toneIcon(tone)}`}>{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-sm font-bold text-slate-900">{title}</h4>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-extrabold text-slate-600">{integer.format(count)}</span>
          </div>
          <p className="mt-1 text-[11px] leading-4 text-slate-400">{description}</p>
        </div>
      </div>
      <div className="divide-y divide-slate-100">
        {unavailable ? (
          <div className="p-5 text-center text-xs font-semibold text-slate-400">Fonte indisponível nesta atualização.</div>
        ) : empty ? (
          <div className="p-5 text-center">
            <CheckCircle2 className="mx-auto text-emerald-500" size={20} />
            <p className="mt-2 text-xs font-bold text-slate-600">Nenhum alerta neste grupo</p>
          </div>
        ) : children}
      </div>
    </article>
  )
}

function AbcAttentionItem({ item, href }: { item: MlbSalesAbcItem; href: string }) {
  const delta = Number(item.grossRevenueDelta)
  return (
    <Link href={href} className="group block p-4 transition hover:bg-slate-50">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[.08em] text-slate-400">{formatAccount(item.account)}</p>
          <p className="mt-1 text-xs font-extrabold text-slate-900">{item.mlb}</p>
          <p className="mt-0.5 truncate text-[11px] text-slate-500" title={item.title ?? "Título indisponível"}>{item.title ?? "Título indisponível"}</p>
        </div>
        <ArrowRight className="mt-1 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-[#6254d9]" size={15} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
        <Detail label="Curva" value={item.previousClass ? `${item.previousClass} → ${item.currentClass}` : `Novo → ${item.currentClass}`} />
        <Detail label="Rank" value={item.previousRank === null ? `Novo → #${item.currentRank}` : `#${item.previousRank} → #${item.currentRank}`} />
      </div>
      <p className="mt-2 text-[11px] font-semibold text-slate-600">
        {formatAbcCurrency(item.previousGrossRevenue)} → {formatAbcCurrency(item.currentGrossRevenue)}
      </p>
      <p className={`mt-1 text-xs font-extrabold ${delta < 0 ? "text-rose-700" : "text-emerald-700"}`}>
        {formatAbcCurrency(item.grossRevenueDelta)} · {formatSignedAbcPercentage(item.grossRevenueDeltaPercent)}
      </p>
    </Link>
  )
}

function NoSaleAttentionItem({ item, href }: { item: NoSaleListingItem; href: string }) {
  const days = noSaleDays(item)
  return (
    <Link href={href} className="group block p-4 transition hover:bg-slate-50">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[.08em] text-slate-400">{item.account}</p>
          <p className="mt-1 text-xs font-extrabold text-slate-900">{item.mlb}</p>
          <p className="mt-0.5 truncate text-[11px] text-slate-500" title={item.title ?? "Título indisponível"}>{item.title ?? "Título indisponível"}</p>
        </div>
        <ArrowRight className="mt-1 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-[#6254d9]" size={15} />
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className={`rounded-lg border px-2 py-1 text-[10px] font-extrabold ${days >= 90 ? "border-rose-200 bg-rose-50 text-rose-700" : days >= 60 ? "border-orange-200 bg-orange-50 text-orange-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
          {item.daysSinceLastSale === null ? "≥ " : ""}{integer.format(days)} dias sem venda
        </span>
        <span className="text-[10px] font-semibold text-slate-400">{item.listingStatus}</span>
      </div>
    </Link>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-slate-50 px-2 py-1.5"><span className="block font-semibold text-slate-400">{label}</span><span className="mt-0.5 block font-extrabold text-slate-700">{value}</span></div>
}

function PartialError({ abcError, noSaleError, onRetry }: { abcError: string | null; noSaleError: string | null; onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-900 sm:flex-row sm:items-center sm:justify-between" role="alert">
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 shrink-0" size={18} />
        <div>
          <p className="text-sm font-bold">Parte da Central não pôde ser atualizada</p>
          {abcError && <p className="mt-1 text-xs">Curva ABC: {abcError}</p>}
          {noSaleError && <p className="mt-1 text-xs">Sem venda: {noSaleError}</p>}
        </div>
      </div>
      <Button variant="outline" size="sm" className="border-rose-200 bg-white" onClick={onRetry}><RefreshCw size={14} /> Tentar novamente</Button>
    </div>
  )
}

function Loading() {
  return <div className="space-y-6" aria-label="Carregando Central de Atenção" aria-busy="true"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 9 }, (_, index) => <Skeleton key={index} className="h-28 rounded-2xl" />)}</div><div className="grid gap-5 xl:grid-cols-3">{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-96 rounded-2xl" />)}</div></div>
}

function abcHref(query: URLSearchParams, item: MlbSalesAbcItem, kind: "curve" | "revenue"): string {
  return `/product-intelligence/curva-abc?${withQuery(query, {
    search: item.mlb,
    ...(kind === "curve" ? { curveMovement: "DECLINED" } : { revenueMovement: "DECREASED" }),
  })}`
}

function noSaleHref(account: "ALL" | "C1" | "C2", item: NoSaleListingItem): string {
  const days = noSaleDays(item) >= 90 ? 90 : noSaleDays(item) >= 60 ? 60 : 30
  return `/product-intelligence/anuncios-sem-venda?${new URLSearchParams({ account, days: String(days), listingStatus: "ACTIVE", search: item.mlb })}`
}

function noSaleSummaryHref(account: "ALL" | "C1" | "C2", days: number): string {
  return `/product-intelligence/anuncios-sem-venda?${new URLSearchParams({ account, days: String(days), listingStatus: "ACTIVE" })}`
}

function withQuery(base: URLSearchParams, extra: Record<string, string>): string {
  const query = new URLSearchParams(base)
  Object.entries(extra).forEach(([key, value]) => query.set(key, value))
  return query.toString()
}

function toneClass(tone: string): string {
  if (tone === "rose") return "border-rose-200 text-rose-700"
  if (tone === "emerald") return "border-emerald-200 text-emerald-700"
  if (tone === "orange") return "border-orange-200 text-orange-700"
  return "border-amber-200 text-amber-700"
}

function toneBar(tone: "rose" | "orange" | "amber"): string {
  return tone === "rose" ? "bg-rose-500" : tone === "orange" ? "bg-orange-500" : "bg-amber-500"
}

function toneIcon(tone: "rose" | "orange" | "amber"): string {
  return tone === "rose" ? "bg-rose-50 text-rose-600" : tone === "orange" ? "bg-orange-50 text-orange-600" : "bg-amber-50 text-amber-600"
}

function formatAccount(account: string): string {
  return account.includes(",") ? account.split(",").join(" + ") : account
}

function formatDate(value: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00-03:00`)
    : new Date(value)
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(date)
}

function formatExclusiveEnd(value: string): string {
  const date = new Date(`${value}T12:00:00-03:00`)
  date.setDate(date.getDate() - 1)
  return formatDate(date.toISOString())
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(value))
}
