"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, CalendarDays, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { compareAccountDays, formatComparisonDate } from "@/features/dashboard/lib/comparison-metrics"
import { getSellerMetricsComparison } from "@/services/seller-metrics"
import type { SellerMetricsComparison, SellerMetricsComparisonAccount } from "@/types/seller-metrics"

import { TemporalComparisonPanel } from "./temporal-comparison-panel"

type AccountFilter = "account-1" | "account-2" | "both"

interface DayComparisonResult {
  state: "loading" | "success" | "error"
  dateA: SellerMetricsComparison | null
  dateB: SellerMetricsComparison | null
}

export function DayComparison({
  accounts,
  initialDateA,
  initialDateB,
}: {
  accounts: SellerMetricsComparisonAccount[]
  initialDateA: string
  initialDateB: string
}) {
  const [accountFilter, setAccountFilter] = useState<AccountFilter>("both")
  const [dateA, setDateA] = useState(initialDateA)
  const [dateB, setDateB] = useState(initialDateB)
  const [appliedDates, setAppliedDates] = useState({ dateA: initialDateA, dateB: initialDateB })
  const [result, setResult] = useState<DayComparisonResult>({ state: "loading", dateA: null, dateB: null })
  const [validationError, setValidationError] = useState<string | null>(null)

  const accountIds = useMemo(
    () => accounts.slice(0, 2).map((account) => account.marketplaceAccountId),
    [accounts],
  )
  const accountIdsKey = accountIds.join(":")

  useEffect(() => {
    if (accountIds.length < 2) return
    const controller = new AbortController()
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setResult({ state: "loading", dateA: null, dateB: null })

    Promise.all([
      getSellerMetricsComparison(
        accountIds[0], accountIds[1], appliedDates.dateA, appliedDates.dateA, controller.signal,
      ),
      getSellerMetricsComparison(
        accountIds[0], accountIds[1], appliedDates.dateB, appliedDates.dateB, controller.signal,
      ),
    ])
      .then(([responseA, responseB]) => {
        setResult({ state: "success", dateA: responseA, dateB: responseB })
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return
        setResult({ state: "error", dateA: null, dateB: null })
      })

    return () => controller.abort()
    // accountIdsKey expresses the stable identity of the two comparison accounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountIdsKey, appliedDates])

  const applyDates = () => {
    if (!dateA || !dateB) {
      setValidationError("Informe a Data A e a Data B.")
      return
    }
    setValidationError(null)
    setAppliedDates({ dateA, dateB })
  }

  const visibleAccounts = accounts.slice(0, 2).filter((_, index) => {
    if (accountFilter === "both") return true
    return accountFilter === `account-${index + 1}`
  })

  return (
    <section aria-labelledby="day-comparison-title" className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h3 id="day-comparison-title" className="text-sm font-bold uppercase tracking-[.12em] text-slate-800">
              Dia × Dia
            </h3>
            <p className="mt-1 text-xs text-slate-400">
              Compare dois snapshots sem transformar ausência em zero.
            </p>
          </div>

          <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-[auto_150px_150px_auto]">
            <div className="sm:col-span-2 xl:col-span-1">
              <FilterLabel>Contas</FilterLabel>
              <div className="mt-1 flex w-full rounded-xl border border-slate-200 bg-slate-50 p-1">
                <AccountFilterButton active={accountFilter === "account-1"} onClick={() => setAccountFilter("account-1")}>Conta 1</AccountFilterButton>
                <AccountFilterButton active={accountFilter === "account-2"} onClick={() => setAccountFilter("account-2")}>Conta 2</AccountFilterButton>
                <AccountFilterButton active={accountFilter === "both"} onClick={() => setAccountFilter("both")}>Ambas</AccountFilterButton>
              </div>
            </div>
            <DateField label="Data A" value={dateA} onChange={setDateA} />
            <DateField label="Data B" value={dateB} onChange={setDateB} />
            <Button
              type="button"
              onClick={applyDates}
              className="h-10 self-end rounded-xl bg-[#6254d9] px-4 hover:bg-[#5547cd] sm:col-span-2 xl:col-span-1"
            >
              Comparar
            </Button>
          </div>
        </div>
        {validationError && <p className="mt-2 text-right text-[11px] font-medium text-rose-500">{validationError}</p>}
      </div>

      {result.state === "loading" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          Carregando snapshots selecionados…
        </div>
      )}

      {result.state === "error" && (
        <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50/60 p-4 text-sm text-rose-700">
          <RefreshCw size={17} className="mt-0.5 shrink-0" />
          Não foi possível carregar os snapshots dessas datas. Tente novamente.
        </div>
      )}

      {result.state === "success" && result.dateA && result.dateB && (
        <>
          {hasMissingSnapshot(visibleAccounts, result.dateA, result.dateB) && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              Métricas sem snapshot aparecem como Indisponível.
            </div>
          )}
          <div className="grid gap-5">
            {visibleAccounts.map((account) => {
              const accountA = findAccount(result.dateA!, account.marketplaceAccountId)
              const accountB = findAccount(result.dateB!, account.marketplaceAccountId)
              const originalIndex = accounts.findIndex(
                (item) => item.marketplaceAccountId === account.marketplaceAccountId,
              )

              return (
                <TemporalComparisonPanel
                  key={account.marketplaceAccountId}
                  accountLabel={`Conta ${originalIndex + 1}`}
                  accountName={account.name}
                  currentLabel={formatComparisonDate(appliedDates.dateA)}
                  previousLabel={formatComparisonDate(appliedDates.dateB)}
                  results={compareAccountDays(accountA, accountB, appliedDates.dateA, appliedDates.dateB)}
                  accent={originalIndex === 0 ? "violet" : "teal"}
                />
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}

function FilterLabel({ children }: { children: React.ReactNode }) {
  return <span className="flex h-4 items-center gap-1 text-[10px] font-bold text-slate-400">{children}</span>
}

function AccountFilterButton({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={active
        ? "flex-1 whitespace-nowrap rounded-lg bg-white px-3 py-2 text-[11px] font-bold text-[#6254d9] shadow-sm"
        : "flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-[11px] font-semibold text-slate-500"}
    >
      {children}
    </button>
  )
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="min-w-0 space-y-1">
      <FilterLabel><CalendarDays size={12} /> {label}</FilterLabel>
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 outline-none transition focus:border-[#6254d9] focus:ring-2 focus:ring-[#6254d9]/15"
      />
    </label>
  )
}

function findAccount(
  comparison: SellerMetricsComparison,
  marketplaceAccountId: string,
): SellerMetricsComparisonAccount | null {
  return comparison.accounts.find(
    (account) => account.marketplaceAccountId === marketplaceAccountId,
  ) ?? null
}

function hasMissingSnapshot(
  accounts: SellerMetricsComparisonAccount[],
  comparisonA: SellerMetricsComparison,
  comparisonB: SellerMetricsComparison,
): boolean {
  return accounts.some((account) => {
    const snapshotA = findAccount(comparisonA, account.marketplaceAccountId)?.days[0]
    const snapshotB = findAccount(comparisonB, account.marketplaceAccountId)?.days[0]
    return !snapshotA?.snapshotAvailable || !snapshotB?.snapshotAvailable
  })
}
