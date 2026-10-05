"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { getMlbSalesAbc } from "@/services/mlb-sales-abc"
import { startMlbAbcAutoRefresh } from "@/services/mlb-sales-abc-refresh"
import type {
  MlbAbcMetric,
  MlbAbcPeriod,
  MlbAbcScope,
  MlbSalesAbcFilters,
  MlbSalesAbcReport,
} from "@/types/mlb-sales-abc"

export interface MlbSalesAbcViewModel {
  filters: MlbSalesAbcFilters
  report: MlbSalesAbcReport | null
  state: "loading" | "error" | "empty" | "success"
  errorMessage: string | null
  isRefreshing: boolean
  setPeriod: (period: MlbAbcPeriod) => void
  setScope: (scope: MlbAbcScope) => void
  setMetric: (metric: MlbAbcMetric) => void
  retry: () => void
}

const defaultFilters: MlbSalesAbcFilters = {
  period: 30,
  scope: "CONSOLIDATED",
  metric: "UNITS",
}

export function useMlbSalesAbc(initialFilters: MlbSalesAbcFilters = defaultFilters): MlbSalesAbcViewModel {
  const [filters, setFilters] = useState<MlbSalesAbcFilters>(initialFilters)
  const [report, setReport] = useState<MlbSalesAbcReport | null>(null)
  const [requestState, setRequestState] = useState<"loading" | "success" | "error">("loading")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const requestSequence = useRef(0)
  const requestController = useRef<AbortController | null>(null)

  const fetchReport = useCallback(async (
    currentFilters: MlbSalesAbcFilters,
    options: { initial: boolean },
  ) => {
    const sequence = ++requestSequence.current
    requestController.current?.abort()
    const controller = new AbortController()
    requestController.current = controller
    if (options.initial) {
      setRequestState("loading")
      setReport(null)
      setErrorMessage(null)
    } else {
      setIsRefreshing(true)
    }

    try {
      const response = await getMlbSalesAbc(currentFilters, controller.signal)
      if (sequence !== requestSequence.current) return
      setReport(response)
      setRequestState("success")
      setErrorMessage(null)
    } catch (error: unknown) {
      if (isAbort(error) || sequence !== requestSequence.current) return
      if (options.initial) {
        setRequestState("error")
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Não foi possível carregar a Curva ABC por MLB.",
        )
      }
    } finally {
      if (sequence === requestSequence.current) setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    const initialRequest = window.setTimeout(() => {
      void fetchReport(filters, { initial: true })
    }, 0)
    return () => {
      window.clearTimeout(initialRequest)
      requestController.current?.abort()
      requestSequence.current += 1
    }
  }, [fetchReport, filters, retryKey])

  useEffect(() => startMlbAbcAutoRefresh({
    refresh: () => void fetchReport(filters, { initial: false }),
    visibility: document,
  }), [fetchReport, filters])

  const updateFilters = useCallback((update: Partial<MlbSalesAbcFilters>) => {
    setFilters((current) => ({ ...current, ...update }))
  }, [])

  return {
    filters,
    report,
    state:
      requestState === "loading"
        ? "loading"
        : requestState === "error"
          ? "error"
          : report && report.mlbs.length > 0
            ? "success"
            : "empty",
    errorMessage,
    isRefreshing,
    setPeriod: (period) => updateFilters({ period }),
    setScope: (scope) => updateFilters({ scope }),
    setMetric: (metric) => updateFilters({ metric }),
    retry: () => setRetryKey((key) => key + 1),
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}
