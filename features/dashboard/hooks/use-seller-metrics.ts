"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import {
  getDailySellerMetrics,
  getDailySellerMetricsRange,
  getSellerMetricAccounts,
  SellerMetricsApiError,
} from "@/services/seller-metrics"
import type { DailySellerMetrics, MarketplaceAccountSummary } from "@/types/seller-metrics"

type RequestState = "idle" | "loading" | "success" | "error"

export interface SellerMetricsViewModel {
  accounts: MarketplaceAccountSummary[]
  selectedAccountId: string
  selectedDate: string
  availableDates: string[]
  snapshot: DailySellerMetrics | null
  state: "loading" | "error" | "empty" | "success"
  errorMessage: string | null
  setAccount: (accountId: string) => void
  setDate: (date: string) => void
  retry: () => void
}

export function useSellerMetrics(): SellerMetricsViewModel {
  const [accounts, setAccounts] = useState<MarketplaceAccountSummary[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState("")
  const [selectedDate, setSelectedDate] = useState(todayInSaoPaulo)
  const [availableDates, setAvailableDates] = useState<string[]>([])
  const [snapshot, setSnapshot] = useState<DailySellerMetrics | null>(null)
  const [accountsState, setAccountsState] = useState<RequestState>("loading")
  const [rangeState, setRangeState] = useState<RequestState>("idle")
  const [snapshotState, setSnapshotState] = useState<RequestState>("idle")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [dateWasChosen, setDateWasChosen] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const period = useMemo(() => monthPeriod(selectedDate), [selectedDate])

  useEffect(() => {
    const controller = new AbortController()
    setAccountsState("loading")
    setErrorMessage(null)

    getSellerMetricAccounts(controller.signal)
      .then((items) => {
        setAccounts(items)
        setAccountsState("success")
        setSelectedAccountId((current) => current || items[0]?.id || "")
      })
      .catch((error: unknown) => {
        if (isAbort(error)) return
        setAccountsState("error")
        setErrorMessage("Não foi possível carregar as contas ativas.")
      })

    return () => controller.abort()
  }, [retryKey])

  useEffect(() => {
    if (!selectedAccountId) return

    const controller = new AbortController()
    setRangeState("loading")
    setSnapshotState("idle")
    setSnapshot(null)
    setAvailableDates([])
    setErrorMessage(null)

    getDailySellerMetricsRange(selectedAccountId, period.from, period.to, controller.signal)
      .then((response) => {
        const dates = response.days.map((day) => day.businessDate)
        setAvailableDates(dates)
        setRangeState("success")

        if (!dateWasChosen && dates.length > 0) {
          setSelectedDate(dates.at(-1)!)
        }
      })
      .catch((error: unknown) => {
        if (isAbort(error)) return
        if (error instanceof SellerMetricsApiError && error.status === 404) {
          setAvailableDates([])
          setRangeState("success")
          return
        }
        setRangeState("error")
        setErrorMessage("Não foi possível consultar as datas processadas.")
      })

    return () => controller.abort()
  }, [dateWasChosen, period.from, period.to, retryKey, selectedAccountId])

  useEffect(() => {
    if (!selectedAccountId || rangeState !== "success") return
    if (!availableDates.includes(selectedDate)) {
      setSnapshot(null)
      setSnapshotState("success")
      return
    }

    const controller = new AbortController()
    setSnapshotState("loading")
    setSnapshot(null)
    setErrorMessage(null)

    getDailySellerMetrics(selectedAccountId, selectedDate, controller.signal)
      .then((response) => {
        setSnapshot(response)
        setSnapshotState("success")
      })
      .catch((error: unknown) => {
        if (isAbort(error)) return
        if (error instanceof SellerMetricsApiError && error.status === 404) {
          setSnapshot(null)
          setSnapshotState("success")
          return
        }
        setSnapshotState("error")
        setErrorMessage("Não foi possível carregar as métricas desta data.")
      })

    return () => controller.abort()
  }, [availableDates, rangeState, retryKey, selectedAccountId, selectedDate])

  const setAccount = useCallback((accountId: string) => {
    setDateWasChosen(false)
    setSelectedAccountId(accountId)
  }, [])

  const setDate = useCallback((date: string) => {
    setDateWasChosen(true)
    setSelectedDate(date)
  }, [])

  const state = resolveState({
    accounts,
    accountsState,
    rangeState,
    snapshotState,
    snapshot,
  })

  return {
    accounts,
    selectedAccountId,
    selectedDate,
    availableDates,
    snapshot,
    state,
    errorMessage,
    setAccount,
    setDate,
    retry: () => setRetryKey((key) => key + 1),
  }
}

function resolveState({
  accounts,
  accountsState,
  rangeState,
  snapshotState,
  snapshot,
}: {
  accounts: MarketplaceAccountSummary[]
  accountsState: RequestState
  rangeState: RequestState
  snapshotState: RequestState
  snapshot: DailySellerMetrics | null
}): SellerMetricsViewModel["state"] {
  if (accountsState === "error" || rangeState === "error" || snapshotState === "error") return "error"
  if (accountsState === "loading" || rangeState === "loading" || snapshotState === "loading") return "loading"
  if (accountsState === "success" && accounts.length === 0) return "empty"
  if (snapshot) return "success"
  return "empty"
}

function todayInSaoPaulo(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date())
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value
  return `${part("year")}-${part("month")}-${part("day")}`
}

function monthPeriod(date: string): { from: string; to: string } {
  const [year, month] = date.split("-").map(Number)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const monthText = String(month).padStart(2, "0")
  return {
    from: `${year}-${monthText}-01`,
    to: `${year}-${monthText}-${String(lastDay).padStart(2, "0")}`,
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}
