import { PackageCheck } from "lucide-react"

import {
  calculateFullParticipation,
  formatFullParticipationDetail,
  formatFullParticipationPercentage,
  formatPercentagePointDifference,
  formatPercentagePointVariation,
  getFullParticipationDifference,
  type FullParticipation,
  type FullParticipationMetric,
  type FullParticipationTemporal,
} from "@/features/dashboard/lib/comparison-metrics"
import type { SellerMetricsComparisonAccount } from "@/types/seller-metrics"

const participationMetrics: Array<{
  key: FullParticipationMetric
  label: string
}> = [
  { key: "revenue", label: "FULL no faturamento" },
  { key: "sales", label: "FULL nas vendas" },
]

export interface FullParticipationTemporalAccount {
  id: string
  label: string
  name: string
  accent: "violet" | "teal"
  comparison: FullParticipationTemporal
}

export function FullParticipationAccountSection({
  accounts,
}: {
  accounts: SellerMetricsComparisonAccount[]
}) {
  const accountViews = accounts.slice(0, 2).map((account, index) => ({
    account,
    label: `Conta ${index + 1}`,
    accent: index === 0 ? "violet" as const : "teal" as const,
    participation: calculateFullParticipation(account.summary),
  }))
  const [accountA, accountB] = accountViews
  if (!accountA || !accountB) return null

  return (
    <FullParticipationShell description="Participação do FULL nos resultados consolidados do período">
      <div className="grid gap-4 sm:grid-cols-2">
        {accountViews.map(({ account, label, accent, participation }) => (
          <AccountParticipationCard
            key={account.marketplaceAccountId}
            label={label}
            name={account.name}
            accent={accent}
            participation={participation}
          />
        ))}
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {participationMetrics.map((metric) => (
          <div
            key={metric.key}
            className="min-w-0 rounded-xl border border-slate-100 bg-slate-50/70 px-4 py-3"
          >
            <p className="text-[10px] font-bold uppercase tracking-[.08em] text-slate-400">
              Diferença entre contas · {metric.label.replace("FULL ", "")}
            </p>
            <p className="mt-1 text-sm font-bold tabular-nums text-slate-700">
              {formatPercentagePointDifference(
                getFullParticipationDifference(
                  accountA.participation,
                  accountB.participation,
                  metric.key,
                ),
              )}
            </p>
          </div>
        ))}
      </div>
    </FullParticipationShell>
  )
}

export function FullParticipationTemporalSection({
  accounts,
  currentLabel,
  previousLabel,
}: {
  accounts: FullParticipationTemporalAccount[]
  currentLabel: string
  previousLabel: string
}) {
  if (accounts.length === 0) return null

  return (
    <FullParticipationShell description={`${currentLabel} contra ${previousLabel}, em pontos percentuais`}>
      <div className="grid gap-4 sm:grid-cols-2">
        {accounts.map((account) => (
          <article
            key={account.id}
            className="min-w-0 rounded-xl border border-slate-200 bg-white p-4"
          >
            <AccountHeading
              label={account.label}
              name={account.name}
              accent={account.accent}
            />
            <div className="mt-4 space-y-4">
              {participationMetrics.map((metric) => {
                const result = account.comparison[metric.key]
                return (
                  <div key={metric.key} className="min-w-0 border-t border-slate-100 pt-3 first:border-0 first:pt-0">
                    <p className="text-xs font-semibold text-slate-600">{metric.label}</p>
                    <dl className="mt-2 grid grid-cols-3 gap-2">
                      <TemporalValue
                        label={currentLabel}
                        value={formatFullParticipationPercentage(result.current.percentage)}
                      />
                      <TemporalValue
                        label={previousLabel}
                        value={formatFullParticipationPercentage(result.previous.percentage)}
                      />
                      <TemporalValue
                        label="Variação"
                        value={formatPercentagePointVariation(result.percentagePointVariation)}
                        strong
                      />
                    </dl>
                  </div>
                )
              })}
            </div>
          </article>
        ))}
      </div>
    </FullParticipationShell>
  )
}

function FullParticipationShell({
  description,
  children,
}: {
  description: string
  children: React.ReactNode
}) {
  return (
    <section aria-labelledby="full-participation-title">
      <div className="mb-4 flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#f1efff] text-[#6254d9]">
          <PackageCheck size={17} />
        </span>
        <div className="min-w-0">
          <h3
            id="full-participation-title"
            className="text-sm font-bold uppercase tracking-[.12em] text-slate-800"
          >
            Participação do FULL
          </h3>
          <p className="mt-1 text-xs text-slate-400">{description}</p>
        </div>
      </div>
      {children}
    </section>
  )
}

function AccountParticipationCard({
  label,
  name,
  accent,
  participation,
}: {
  label: string
  name: string
  accent: "violet" | "teal"
  participation: FullParticipation
}) {
  return (
    <article className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/30 sm:p-5">
      <AccountHeading label={label} name={name} accent={accent} />
      <div className="mt-4 space-y-4">
        {participationMetrics.map((metric) => {
          const value = participation[metric.key]
          return (
            <div key={metric.key} className="min-w-0 border-t border-slate-100 pt-4 first:border-0 first:pt-0">
              <p className="text-xs font-semibold text-slate-500">{metric.label}</p>
              <p className="mt-1 text-2xl font-bold tracking-[-.04em] tabular-nums text-slate-900">
                {formatFullParticipationPercentage(value.percentage)}
              </p>
              <p className="mt-1 break-words text-[11px] tabular-nums text-slate-400">
                {formatFullParticipationDetail(value, metric.key)}
              </p>
            </div>
          )
        })}
      </div>
    </article>
  )
}

function AccountHeading({
  label,
  name,
  accent,
}: {
  label: string
  name: string
  accent: "violet" | "teal"
}) {
  const accentClass = accent === "violet" ? "bg-[#6254d9]" : "bg-[#0f766e]"

  return (
    <div className="min-w-0">
      <p className="flex items-center gap-2 text-sm font-bold text-slate-900">
        <span className={`size-2 shrink-0 rounded-full ${accentClass}`} />
        {label}
      </p>
      <p className="mt-1 truncate text-[11px] text-slate-400" title={name}>{name}</p>
    </div>
  )
}

function TemporalValue({
  label,
  value,
  strong = false,
}: {
  label: string
  value: string
  strong?: boolean
}) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[9px] font-bold uppercase tracking-[.06em] text-slate-400" title={label}>
        {label}
      </dt>
      <dd className={`mt-1 break-words text-xs tabular-nums ${strong ? "font-bold text-slate-800" : "font-semibold text-slate-600"}`}>
        {value}
      </dd>
    </div>
  )
}
