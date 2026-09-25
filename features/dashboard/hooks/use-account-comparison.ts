"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import {
  getPreviousPeriod,
  isComparisonPeriodPartial,
  type ComparisonPeriod,
} from "@/features/dashboard/lib/comparison-metrics"
import {
  getSellerMetricAccounts,
  getSellerMetricsComparison,
} from "@/services/seller-metrics"
import type {
  MarketplaceAccountSummary,
  SellerMetricsComparison,
} from "@/types/seller-metrics"

export type ComparisonPeriodPreset = 7 | 15 | 30 | "custom"

export type { ComparisonPeriod } from "@/features/dashboard/lib/comparison-metrics"

export interface AccountComparisonViewModel {
  accounts: MarketplaceAccountSummary[]
  comparison: SellerMetricsComparison | null
  previousComparison: SellerMetricsComparison | null
  period: ComparisonPeriod | null
  previousPeriod: ComparisonPeriod | null
  preset: ComparisonPeriodPreset
  latestAvailableDate: string | null
  state: "loading" | "error" | "empty" | "partial" | "success"
  temporalState: "idle" | "loading" | "success" | "error"
  errorMessage: string | null
  setPreset: (preset: Exclude<ComparisonPeriodPreset, "custom">) => void
  showCustom: () => void
  setCustomPeriod: (period: ComparisonPeriod) => string | null
  retry: () => void
}

const ACCOUNT_A_NAME = "ALE_IMPORTS1"
const ACCOUNT_B_NAME = "ALE_IMPORTS 2"
const MAX_PERIOD_DAYS = 31

export function useAccountComparison(): AccountComparisonViewModel {
  const [accounts, setAccounts] = useState<MarketplaceAccountSummary[]>([])
  const [comparison, setComparison] = useState<SellerMetricsComparison | null>(null)
  const [previousComparison, setPreviousComparison] = useState<SellerMetricsComparison | null>(null)
  const [period, setPeriod] = useState<ComparisonPeriod | null>(null)
  const [preset, setPresetState] = useState<ComparisonPeriodPreset>(7)
  const [latestAvailableDate, setLatestAvailableDate] = useState<string | null>(null)
  const [accountsState, setAccountsState] = useState<"loading" | "success" | "error">("loading")
  const [discoveryState, setDiscoveryState] = useState<"idle" | "loading" | "success" | "error">("idle")
  const [comparisonState, setComparisonState] = useState<"idle" | "loading" | "success" | "error">("idle")
  const [temporalState, setTemporalState] = useState<"idle" | "loading" | "success" | "error">("idle")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)

  const comparisonAccounts = useMemo(() => resolveComparisonAccounts(accounts), [accounts])

  useEffect(() => {
    const controller = new AbortController()
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAccountsState("loading")
    setDiscoveryState("idle")
    setComparisonState("idle")
    setComparison(null)
    setPreviousComparison(null)
    setTemporalState("idle")
    setPeriod(null)
    setLatestAvailableDate(null)
    setErrorMessage(null)

    getSellerMetricAccounts(controller.signal)
      .then((items) => {
        setAccounts(items)
        setAccountsState("success")
      })
      .catch((error: unknown) => {
        if (isAbort(error)) return
        setAccountsState("error")
        setErrorMessage("Não foi possível carregar as contas ativas.")
      })

    return () => controller.abort()
  }, [retryKey])

  useEffect(() => {
    if (accountsState !== "success") return
    if (!comparisonAccounts) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDiscoveryState("error")
      setErrorMessage(
        `As contas ${ACCOUNT_A_NAME} e ${ACCOUNT_B_NAME} precisam estar ativas para realizar a comparação.`,
      )
      return
    }

    const controller = new AbortController()
    const to = todayInSaoPaulo()
    const from = addDays(to, -(MAX_PERIOD_DAYS - 1))
    setDiscoveryState("loading")
    setErrorMessage(null)

    getSellerMetricsComparison(
      comparisonAccounts[0].id,
      comparisonAccounts[1].id,
      from,
      to,
      controller.signal,
    )
      .then((response) => {
        const anchor = findLatestAvailableDate(response) ?? to
        setLatestAvailableDate(findLatestAvailableDate(response))
        setPeriod(periodEndingAt(anchor, 7))
        setDiscoveryState("success")
      })
      .catch((error: unknown) => {
        if (isAbort(error)) return
        setDiscoveryState("error")
        setErrorMessage("Não foi possível localizar o período mais recente com dados.")
      })

    return () => controller.abort()
  }, [accountsState, comparisonAccounts, retryKey])

  useEffect(() => {
    if (!comparisonAccounts || !period || discoveryState !== "success") return

    const controller = new AbortController()
    const previousPeriod = getPreviousPeriod(period)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setComparisonState("loading")
    setComparison(null)
    setPreviousComparison(null)
    setTemporalState("loading")
    setErrorMessage(null)

    const currentRequest = getSellerMetricsComparison(
      comparisonAccounts[0].id,
      comparisonAccounts[1].id,
      period.from,
      period.to,
      controller.signal,
    )
    const previousRequest = getSellerMetricsComparison(
      comparisonAccounts[0].id,
      comparisonAccounts[1].id,
      previousPeriod.from,
      previousPeriod.to,
      controller.signal,
    )

    currentRequest
      .then((response) => {
        setComparison(response)
        setComparisonState("success")
      })
      .catch((error: unknown) => {
        if (isAbort(error)) return
        setComparisonState("error")
        setErrorMessage("Não foi possível carregar a comparação deste período.")
      })

    previousRequest
      .then((response) => {
        setPreviousComparison(response)
        setTemporalState("success")
      })
      .catch((error: unknown) => {
        if (isAbort(error)) return
        setPreviousComparison(null)
        setTemporalState("error")
      })

    return () => controller.abort()
  }, [comparisonAccounts, discoveryState, period, retryKey])

  const setPreset = useCallback(
    (nextPreset: Exclude<ComparisonPeriodPreset, "custom">) => {
      const anchor = latestAvailableDate ?? todayInSaoPaulo()
      setPresetState(nextPreset)
      setPeriod(periodEndingAt(anchor, nextPreset))
    },
    [latestAvailableDate],
  )

  const showCustom = useCallback(() => setPresetState("custom"), [])

  const setCustomPeriod = useCallback((nextPeriod: ComparisonPeriod): string | null => {
    const validationError = validatePeriod(nextPeriod)
    if (validationError) return validationError
    setPresetState("custom")
    setPeriod(nextPeriod)
    return null
  }, [])

  const state = resolveState({
    accountsState,
    discoveryState,
    comparisonState,
    comparison,
  })

  return {
    accounts,
    comparison,
    previousComparison,
    period,
    previousPeriod: period ? getPreviousPeriod(period) : null,
    preset,
    latestAvailableDate,
    state,
    temporalState,
    errorMessage,
    setPreset,
    showCustom,
    setCustomPeriod,
    retry: () => setRetryKey((key) => key + 1),
  }
}

function resolveComparisonAccounts(
  accounts: MarketplaceAccountSummary[],
): [MarketplaceAccountSummary, MarketplaceAccountSummary] | null {
  const byName = (expected: string) =>
    accounts.find((account) => normalizeAccountName(account.name) === normalizeAccountName(expected))
  const accountA = byName(ACCOUNT_A_NAME)
  const accountB = byName(ACCOUNT_B_NAME)
  return accountA && accountB ? [accountA, accountB] : null
}

function normalizeAccountName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleUpperCase("pt-BR")
}

function findLatestAvailableDate(response: SellerMetricsComparison): string | null {
  const [accountA, accountB] = response.accounts
  if (!accountA || !accountB) return null

  const accountBDays = new Map(accountB.days.map((day) => [day.date, day.snapshotAvailable]))
  const commonDates = accountA.days
    .filter((day) => day.snapshotAvailable && accountBDays.get(day.date))
    .map((day) => day.date)

  if (commonDates.length > 0) return commonDates.at(-1) ?? null

  return [...accountA.days, ...accountB.days]
    .filter((day) => day.snapshotAvailable)
    .map((day) => day.date)
    .sort()
    .at(-1) ?? null
}

function resolveState({
  accountsState,
  discoveryState,
  comparisonState,
  comparison,
}: {
  accountsState: "loading" | "success" | "error"
  discoveryState: "idle" | "loading" | "success" | "error"
  comparisonState: "idle" | "loading" | "success" | "error"
  comparison: SellerMetricsComparison | null
}): AccountComparisonViewModel["state"] {
  if (accountsState === "error" || discoveryState === "error" || comparisonState === "error") {
    return "error"
  }
  if (
    accountsState === "loading" ||
    discoveryState === "idle" ||
    discoveryState === "loading" ||
    comparisonState === "idle" ||
    comparisonState === "loading"
  ) {
    return "loading"
  }
  if (!comparison || comparison.accounts.every((account) => account.availableDays === 0)) {
    return "empty"
  }
  const isPartial = isComparisonPeriodPartial(comparison.accounts)
  return isPartial ? "partial" : "success"
}

function validatePeriod(period: ComparisonPeriod): string | null {
  if (!period.from || !period.to) return "Informe as datas inicial e final."
  const from = new Date(`${period.from}T00:00:00Z`)
  const to = new Date(`${period.to}T00:00:00Z`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return "Informe datas válidas."
  const days = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1
  if (days < 1) return "A data inicial deve ser anterior ou igual à data final."
  if (days > MAX_PERIOD_DAYS) return "O período personalizado deve ter no máximo 31 dias."
  return null
}

function periodEndingAt(to: string, days: number): ComparisonPeriod {
  return { from: addDays(to, -(days - 1)), to }
}

function addDays(date: string, amount: number): string {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + amount)
  return value.toISOString().slice(0, 10)
}

function todayInSaoPaulo(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date())
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value
  return `${part("year")}-${part("month")}-${part("day")}`
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}
