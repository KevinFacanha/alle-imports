"use client"

import { useMemo, useState, type ReactNode } from "react"
import {
  AlertTriangle,
  Clock3,
  Eye,
  History,
  PackageSearch,
  RefreshCw,
  Search,
  ShieldAlert,
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
import { useNoSaleListings } from "@/features/product-intelligence/hooks/use-no-sale-listings"
import { noSaleStaleBanner } from "@/features/product-intelligence/lib/no-sale-data-coverage"
import type {
  NoSaleAccount,
  NoSaleListingItem,
  NoSaleListingStatusFilter,
  NoSaleThreshold,
} from "@/types/no-sale-listings"

const integer = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 })
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })

export function NoSaleListingsPage() {
  const intelligence = useNoSaleListings()
  const [search, setSearch] = useState("")
  const normalizedSearch = search.trim().toLocaleLowerCase("pt-BR")
  const listings = useMemo(
    () => (intelligence.report?.listings ?? []).filter((listing) =>
      !normalizedSearch ||
      listing.mlb.toLocaleLowerCase("pt-BR").includes(normalizedSearch) ||
      listing.title?.toLocaleLowerCase("pt-BR").includes(normalizedSearch),
    ),
    [intelligence.report, normalizedSearch],
  )
  const historyIncomplete = intelligence.report?.metadata.history.some(
    (history) => history.availableDays < intelligence.filters.days,
  )
  const staleBanner = intelligence.report
    ? noSaleStaleBanner(intelligence.report.metadata, formatDate)
    : null

  return (
    <section className="space-y-6" aria-labelledby="no-sale-title">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.14em] text-[#6254d9]">
            <PackageSearch size={14} /> Product Intelligence
          </div>
          <h2 id="no-sale-title" className="text-2xl font-bold tracking-[-.035em] text-slate-900 sm:text-3xl">
            Anúncios sem venda
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            Anúncios do Mercado Livre que estão ativos há pelo menos 30 dias e não registraram venda efetiva recente.
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            A idade é conservadora: usa a evidência local mais antiga entre catálogo e pedidos, sem presumir a data original de publicação.
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-left sm:text-right">
          <p className="text-[10px] font-bold uppercase tracking-[.12em] text-slate-400">Atualização</p>
          <p className="mt-1 text-xs font-bold text-slate-700" aria-live="polite">
            {intelligence.isRefreshing
              ? "Atualizando…"
              : intelligence.report
                ? formatDateTime(intelligence.report.metadata.generatedAt)
                : "Aguardando dados"}
          </p>
          <p className="mt-1 text-[10px] font-semibold text-slate-400">Fuso: America/Sao_Paulo</p>
        </div>
      </div>

      <Filters
        account={intelligence.filters.account}
        days={intelligence.filters.days}
        listingStatus={intelligence.filters.listingStatus}
        disabled={intelligence.state === "loading"}
        onAccountChange={intelligence.setAccount}
        onDaysChange={intelligence.setDays}
        onStatusChange={intelligence.setListingStatus}
      />

      {intelligence.state === "loading" && <Loading />}
      {intelligence.state === "error" && (
        <StatePanel
          icon={<RefreshCw size={21} />}
          title="Não foi possível carregar os anúncios"
          description={intelligence.errorMessage ?? "Verifique a API e tente novamente."}
          action={<Button onClick={intelligence.retry}>Tentar novamente</Button>}
        />
      )}
      {intelligence.state === "success" && intelligence.report && (
        <div className="space-y-6">
          <SummaryCards summary={intelligence.report.summary} />
          {staleBanner && (
            <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900" role="status">
              <History className="mt-0.5 shrink-0" size={18} />
              <div>
                <p className="text-sm font-bold">{staleBanner.title}</p>
                {staleBanner.detail && (
                  <p className="mt-1 text-xs leading-5 text-amber-800">{staleBanner.detail}</p>
                )}
              </div>
            </div>
          )}
          {historyIncomplete && (
            <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
              <History className="mt-0.5 shrink-0" size={18} />
              <div>
                <p className="text-sm font-bold">Histórico insuficiente para parte do filtro</p>
                <p className="mt-1 text-xs leading-5 text-amber-800">
                  A lista só inclui alertas comprovados pela cobertura disponível; ausência de registro não é tratada como “nunca vendeu”.
                </p>
              </div>
            </div>
          )}
          <ListingsTable
            listings={listings}
            total={intelligence.report.total}
            search={search}
            onSearchChange={setSearch}
          />
        </div>
      )}
    </section>
  )
}

function Filters({
  account,
  days,
  listingStatus,
  disabled,
  onAccountChange,
  onDaysChange,
  onStatusChange,
}: {
  account: NoSaleAccount
  days: NoSaleThreshold
  listingStatus: NoSaleListingStatusFilter
  disabled: boolean
  onAccountChange: (value: NoSaleAccount) => void
  onDaysChange: (value: NoSaleThreshold) => void
  onStatusChange: (value: NoSaleListingStatusFilter) => void
}) {
  return (
    <div className="grid gap-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/30 lg:grid-cols-3 lg:p-5">
      <FilterGroup label="Conta">
        {(["ALL", "C1", "C2"] as const).map((value) => (
          <FilterButton key={value} active={account === value} disabled={disabled} onClick={() => onAccountChange(value)}>
            {value === "ALL" ? "Todas" : value}
          </FilterButton>
        ))}
      </FilterGroup>
      <FilterGroup label="Sem venda há">
        {([30, 60, 90] as const).map((value) => (
          <FilterButton key={value} active={days === value} disabled={disabled} onClick={() => onDaysChange(value)}>
            {value}D
          </FilterButton>
        ))}
      </FilterGroup>
      <label className="min-w-0">
        <span className="mb-2 block text-[10px] font-bold uppercase tracking-[.16em] text-slate-400">Status do anúncio</span>
        <select
          value={listingStatus}
          disabled={disabled}
          onChange={(event) => onStatusChange(event.target.value as NoSaleListingStatusFilter)}
          className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-[#6254d9]/30"
        >
          <option value="ACTIVE">Ativos</option>
          <option value="PAUSED">Pausados</option>
          <option value="INACTIVE">Inativos/fechados</option>
          <option value="ALL">Todos os status</option>
        </select>
      </label>
    </div>
  )
}

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-2 text-[10px] font-bold uppercase tracking-[.16em] text-slate-400">{label}</legend>
      <div className="flex rounded-xl bg-slate-100 p-1">{children}</div>
    </fieldset>
  )
}

function FilterButton({ active, ...props }: React.ComponentProps<"button"> & { active: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={`min-w-0 flex-1 rounded-lg px-2.5 py-2 text-xs font-bold transition disabled:cursor-wait disabled:opacity-60 ${active ? "bg-white text-[#6254d9] shadow-sm" : "text-slate-500 hover:bg-white/60"}`}
      {...props}
    />
  )
}

function SummaryCards({ summary }: { summary: { noSale30d: number; noSale60d: number; noSale90d: number } }) {
  const cards = [
    { label: "Sem venda 30D", value: summary.noSale30d, icon: Clock3, className: "border-amber-200 bg-amber-50/60 text-amber-800" },
    { label: "Sem venda 60D", value: summary.noSale60d, icon: AlertTriangle, className: "border-orange-200 bg-orange-50/60 text-orange-800" },
    { label: "Sem venda 90D", value: summary.noSale90d, icon: ShieldAlert, className: "border-rose-200 bg-rose-50/60 text-rose-800" },
  ]
  return (
    <section className="grid gap-3 sm:grid-cols-3" aria-label="Resumo de anúncios sem venda">
      {cards.map(({ label, value, icon: Icon, className }) => (
        <article key={label} className={`rounded-2xl border p-5 shadow-sm ${className}`}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-bold">{label}</p>
              <p className="mt-3 text-3xl font-extrabold tracking-tight">{integer.format(value)}</p>
              <p className="mt-1 text-[10px] font-semibold opacity-70">Contagem acumulada</p>
            </div>
            <Icon size={20} />
          </div>
        </article>
      ))}
    </section>
  )
}

function ListingsTable({ listings, total, search, onSearchChange }: {
  listings: NoSaleListingItem[]
  total: number
  search: string
  onSearchChange: (value: string) => void
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/30">
      <div className="flex flex-col gap-4 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Anúncios que merecem atenção</h3>
          <p className="mt-1 text-xs text-slate-400">Maior período sem venda primeiro · {integer.format(total)} anúncios</p>
        </div>
        <label className="relative block w-full sm:max-w-xs">
          <span className="sr-only">Buscar MLB ou título</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <Input type="search" value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Buscar MLB ou título" className="h-10 rounded-xl border-slate-200 bg-slate-50 pl-9" />
        </label>
      </div>
      {listings.length === 0 ? (
        <div className="grid min-h-56 place-items-center p-8 text-center">
          <div>
            <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-600"><PackageSearch size={21} /></div>
            <p className="mt-4 text-sm font-bold text-slate-800">Nenhum anúncio corresponde aos filtros</p>
            <p className="mt-1 text-xs text-slate-400">Isso também pode significar que não há alertas comprovados pela cobertura disponível.</p>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-50/80">
              <TableRow className="hover:bg-transparent">
                {['Conta', 'MLB / Título', 'Idade anúncio', 'Última venda', 'Dias sem venda', 'Unidades 30D', 'Faturamento 30D', 'Curva atual', 'Movimento ABC', ''].map((label) => (
                  <TableHead key={label} className="whitespace-nowrap text-[10px] font-bold uppercase tracking-[.08em] text-slate-400">{label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {listings.map((listing) => (
                <TableRow key={`${listing.account}-${listing.mlb}`} className={rowClass(listing)}>
                  <TableCell className="font-bold text-slate-600">{listing.account}</TableCell>
                  <TableCell className="min-w-64 py-3.5">
                    <span className="block font-bold text-slate-900">{listing.mlb}</span>
                    <span className="mt-0.5 block max-w-80 truncate text-xs text-slate-400" title={listing.title ?? undefined}>{listing.title ?? "Título indisponível"}</span>
                    <span className="mt-1 inline-flex rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-500">{listing.listingStatus}</span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs font-semibold text-slate-600" title={`Primeira evidência local: ${formatDate(listing.listingFirstSeenAt)}`}>{integer.format(listing.listingAgeDays)} dias</TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-slate-600">{listing.lastSaleAt ? formatDate(listing.lastSaleAt) : "Sem venda no histórico disponível"}</TableCell>
                  <TableCell><SeverityBadge listing={listing} /></TableCell>
                  <TableCell className="text-right font-semibold text-slate-600">{integer.format(listing.unitsSold30d)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-semibold text-slate-600">{formatCurrency(listing.grossRevenue30d)}</TableCell>
                  <TableCell className="text-center font-extrabold text-slate-600">{listing.abcClass30d ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs font-semibold text-slate-500">{movementLabel(listing.abcMovement30d)}</TableCell>
                  <TableCell>
                    <Button variant="outline" size="sm" disabled title="Ação futura — nenhuma alteração será feita no Mercado Livre" className="whitespace-nowrap rounded-lg">
                      <Eye size={14} /> Revisar anúncio
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  )
}

function SeverityBadge({ listing }: { listing: NoSaleListingItem }) {
  const days = listing.daysSinceLastSale ?? listing.observedNoSaleDays
  const prefix = listing.daysSinceLastSale === null ? "≥ " : ""
  const label = listing.operationalStatus === "NO_SALE_IN_AVAILABLE_HISTORY"
    ? `${prefix}${integer.format(days)} dias observados`
    : `${integer.format(days)} dias`
  const className = days >= 90
    ? "border-rose-200 bg-rose-100 text-rose-800"
    : days >= 60
      ? "border-orange-200 bg-orange-100 text-orange-800"
      : "border-amber-200 bg-amber-100 text-amber-800"
  return <span className={`inline-flex whitespace-nowrap rounded-lg border px-2 py-1 text-[10px] font-extrabold ${className}`}>{label}</span>
}

function rowClass(listing: NoSaleListingItem): string {
  const days = listing.daysSinceLastSale ?? listing.observedNoSaleDays
  if (days >= 90) return "bg-rose-50/50 hover:bg-rose-50"
  if (days >= 60) return "bg-orange-50/40 hover:bg-orange-50"
  return "bg-amber-50/30 hover:bg-amber-50/60"
}

function movementLabel(value: NoSaleListingItem["abcMovement30d"]): string {
  if (value === "DECLINED") return "Caiu"
  if (value === "IMPROVED") return "Subiu"
  if (value === "STABLE") return "Estável"
  if (value === "NEW") return "Novo"
  return "—"
}

function Loading() {
  return <div className="space-y-6" aria-busy="true" aria-label="Carregando anúncios sem venda"><div className="grid gap-3 sm:grid-cols-3">{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-32 rounded-2xl" />)}</div><Skeleton className="h-96 rounded-2xl" /></div>
}

function StatePanel({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action: ReactNode }) {
  return <div className="grid min-h-72 place-items-center rounded-2xl border border-rose-200 bg-white p-8 text-center"><div><div className="mx-auto grid size-12 place-items-center rounded-2xl bg-rose-50 text-rose-500">{icon}</div><h3 className="mt-4 font-bold">{title}</h3><p className="mb-5 mt-2 text-sm text-slate-500">{description}</p>{action}</div></div>
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date(value))
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(value))
}

function formatCurrency(value: string): string {
  const number = Number(value)
  return Number.isFinite(number) ? currency.format(number) : "—"
}
