import { AlertTriangle, CalendarRange, CheckCircle2, Sparkles } from "lucide-react"

import {
  buildAccountComparisonFacts,
  compareAccountPeriods,
  compareFullParticipation,
  formatComparisonDate,
  getPrimaryTemporalSignals,
  isComparisonPeriodPartial,
  type AccountComparisonFact,
  type ComparisonPeriod,
  type TemporalSignal,
} from "@/features/dashboard/lib/comparison-metrics"
import type {
  SellerMetricsComparison,
  SellerMetricsComparisonAccount,
} from "@/types/seller-metrics"

import { FullParticipationTemporalSection } from "./full-participation"
import { TemporalComparisonPanel } from "./temporal-comparison-panel"

export function PeriodComparison({
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
  const accountViews = current.accounts.slice(0, 2).map((account, index) => {
    const previousAccount = previous?.accounts.find(
      (item) => item.marketplaceAccountId === account.marketplaceAccountId,
    ) ?? null
    const results = compareAccountPeriods(account, previousAccount)

    return {
      account,
      accountLabel: `Conta ${index + 1}`,
      results,
      fullParticipation: compareFullParticipation(account.summary, previousAccount?.summary ?? null),
      signals: getPrimaryTemporalSignals(results),
      accent: index === 0 ? "violet" as const : "teal" as const,
    }
  })
  const accountFacts = buildAccountComparisonFacts(
    current.accounts.slice(0, 2),
    accountViews.map(({ results }) => results),
  )

  return (
    <section className="space-y-6" aria-labelledby="period-comparison-title">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/30">
        <div className="border-b border-slate-100 px-4 py-5 sm:px-6">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#f1efff] text-[#6254d9]">
              <CalendarRange size={19} />
            </span>
            <div className="min-w-0">
              <h3
                id="period-comparison-title"
                className="text-sm font-bold uppercase tracking-[.12em] text-slate-800"
              >
                Evolução do período
              </h3>
              <p className="mt-1 text-xs text-slate-400">
                Leitura executiva do período atual contra o anterior de mesma duração
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 px-4 py-5 sm:grid-cols-2 sm:px-6">
          <PeriodValue label="Atual" value={formatPeriod(current)} prominent />
          <PeriodValue
            label="Anterior"
            value={previousPeriod ? formatPeriod(previousPeriod) : "Indisponível"}
          />
        </div>

        <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-4 sm:px-6">
          <p className="text-[10px] font-bold uppercase tracking-[.12em] text-slate-400">
            Completude do período atual
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {current.accounts.slice(0, 2).map((account, index) => (
              <CompletenessValue key={account.marketplaceAccountId} account={account} index={index} />
            ))}
          </div>
        </div>
      </div>

      {(state === "error" || (!previous && state !== "loading")) && (
        <ComparisonNotice className="-mt-2">
          O período atual permanece disponível, mas o período anterior está indisponível.
        </ComparisonNotice>
      )}
      {state === "loading" && !previous && (
        <p className="-mt-2 text-xs text-slate-400">Carregando período anterior…</p>
      )}
      {previousIsPartial && previous && (
        <ComparisonNotice className="-mt-2">
          Período anterior parcial:{" "}
          {previous.accounts.map((account, index) => (
            <span key={account.marketplaceAccountId} className="whitespace-nowrap">
              Conta {index + 1}: {account.availableDays}/{account.expectedDays} dias
              {index < previous.accounts.length - 1 ? "; " : "."}
            </span>
          ))}
        </ComparisonNotice>
      )}

      <FullParticipationTemporalSection
        currentLabel="Atual"
        previousLabel="Anterior"
        accounts={accountViews.map(({ account, accountLabel, accent, fullParticipation }) => ({
          id: account.marketplaceAccountId,
          label: accountLabel,
          name: account.name,
          accent,
          comparison: fullParticipation,
        }))}
      />

      <section
        aria-labelledby="period-insights-title"
        className="rounded-2xl border border-[#dcd7ff] bg-[#f8f7ff] p-4 sm:p-6"
      >
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#6254d9] text-white">
            <Sparkles size={17} />
          </span>
          <div>
            <h4
              id="period-insights-title"
              className="text-sm font-bold uppercase tracking-[.12em] text-slate-800"
            >
              Insights rápidos
            </h4>
            <p className="mt-1 text-xs text-slate-500">
              Até três sinais de maior variação em cada conta
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {accountViews.map(({ account, accountLabel, signals, accent }) => (
            <AccountInsights
              key={account.marketplaceAccountId}
              accountLabel={accountLabel}
              accountName={account.name}
              signals={signals}
              accent={accent}
            />
          ))}
        </div>
      </section>

      {accountFacts.length > 0 && <AccountFacts facts={accountFacts} />}

      <div className="grid gap-5">
        {accountViews.map(({ account, accountLabel, results, accent }) => (
          <TemporalComparisonPanel
            key={account.marketplaceAccountId}
            accountLabel={accountLabel}
            accountName={account.name}
            currentLabel="Atual"
            previousLabel="Anterior"
            results={results}
            accent={accent}
          />
        ))}
      </div>
    </section>
  )
}

function PeriodValue({
  label,
  value,
  prominent = false,
}: {
  label: string
  value: string
  prominent?: boolean
}) {
  return (
    <div
      className={prominent
        ? "rounded-xl bg-[#f1efff] px-4 py-3"
        : "rounded-xl bg-slate-50 px-4 py-3"}
    >
      <p className="text-[10px] font-bold uppercase tracking-[.12em] text-slate-400">{label}</p>
      <p
        className={prominent
          ? "mt-1 text-lg font-bold tabular-nums text-[#6254d9]"
          : "mt-1 text-lg font-bold tabular-nums text-slate-800"}
      >
        {value}
      </p>
    </div>
  )
}

function CompletenessValue({
  account,
  index,
}: {
  account: SellerMetricsComparisonAccount
  index: number
}) {
  const complete = account.availableDays === account.expectedDays

  return (
    <div className="flex min-w-0 items-center gap-2 text-xs">
      {complete ? (
        <CheckCircle2 size={15} className="shrink-0 text-emerald-600" />
      ) : (
        <AlertTriangle size={15} className="shrink-0 text-amber-600" />
      )}
      <p className="min-w-0 truncate text-slate-500" title={account.name}>
        <strong className="text-slate-700">Conta {index + 1}:</strong>{" "}
        <span className="font-semibold tabular-nums">
          {account.availableDays}/{account.expectedDays} dias
        </span>
      </p>
    </div>
  )
}

function AccountInsights({
  accountLabel,
  accountName,
  signals,
  accent,
}: {
  accountLabel: string
  accountName: string
  signals: TemporalSignal[]
  accent: "violet" | "teal"
}) {
  const accentClass = accent === "violet" ? "bg-[#6254d9]" : "bg-[#0f766e]"

  return (
    <article className="min-w-0 rounded-xl border border-white bg-white p-4 shadow-sm shadow-slate-200/40">
      <div className="flex items-center gap-2">
        <span className={`size-2 rounded-full ${accentClass}`} />
        <h5 className="text-xs font-bold uppercase tracking-[.08em] text-slate-800">
          {accountLabel} — sinais principais
        </h5>
      </div>
      <p className="mt-1 truncate text-[11px] text-slate-400" title={accountName}>
        {accountName}
      </p>
      {signals.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {signals.map((signal) => (
            <li
              key={signal.metricName}
              className="flex min-w-0 items-center justify-between gap-3 text-sm"
            >
              <span className="min-w-0 truncate font-semibold text-slate-700">{signal.label}</span>
              <span className={`shrink-0 font-bold tabular-nums ${signalColor(signal.tone)}`}>
                {signal.value}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-xs text-slate-500">Sinais indisponíveis para esta comparação.</p>
      )}
    </article>
  )
}

function AccountFacts({ facts }: { facts: AccountComparisonFact[] }) {
  return (
    <section aria-labelledby="account-facts-title">
      <div className="mb-3">
        <h4
          id="account-facts-title"
          className="text-xs font-bold uppercase tracking-[.12em] text-slate-700"
        >
          Resumo entre contas
        </h4>
        <p className="mt-1 text-xs text-slate-400">
          Leituras matemáticas do período, sem atribuição de causa
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {facts.map((fact) => (
          <article
            key={fact.label}
            className="min-w-0 rounded-xl border border-slate-200 bg-white p-3"
          >
            <p className="text-[10px] font-semibold leading-4 text-slate-400">{fact.label}</p>
            <p className="mt-2 break-words text-xs font-bold tabular-nums text-slate-700">
              {fact.value}
            </p>
          </article>
        ))}
      </div>
    </section>
  )
}

function ComparisonNotice({
  children,
  className = "",
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={`flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-800 ${className}`}
    >
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <p>{children}</p>
    </div>
  )
}

function formatPeriod(period: ComparisonPeriod): string {
  return `${formatComparisonDate(period.from)}–${formatComparisonDate(period.to)}`
}

function signalColor(tone: TemporalSignal["tone"]): string {
  if (tone === "positive") return "text-emerald-600"
  if (tone === "attention") return "text-rose-500"
  return "text-slate-500"
}
