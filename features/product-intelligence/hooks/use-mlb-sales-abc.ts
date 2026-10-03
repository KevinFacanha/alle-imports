"use client"

import { useCallback, useEffect, useState } from "react"

import { getMlbSalesAbc } from "@/services/mlb-sales-abc"
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
  setPeriod: (period: MlbAbcPeriod) => void
  setScope: (scope: MlbAbcScope) => void
  setMetric: (metric: MlbAbcMetric) => void
  retry: () => void
}

const initialFilters: MlbSalesAbcFilters = {
  period: 30,
  scope: "CONSOLIDATED",
  metric: "UNITS",
}

export function useMlbSalesAbc(): MlbSalesAbcViewModel {
  const [filters, setFilters] = useState<MlbSalesAbcFilters>(initialFilters)
  const [report, setReport] = useState<MlbSalesAbcReport | null>(null)
  const [requestState, setRequestState] = useState<"loading" | "success" | "error">("loading")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setRequestState("loading")
    setReport(null)
    setErrorMessage(null)

    getMlbSalesAbc(filters, controller.signal)
      .then((response) => {
        setReport(response)
        setRequestState("success")
      })
      .catch((error: unknown) => {
        if (isAbort(error)) return
        setRequestState("error")
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Não foi possível carregar a Curva ABC por MLB.",
        )
      })

    return () => controller.abort()
  }, [filters, retryKey])

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
    setPeriod: (period) => updateFilters({ period }),
    setScope: (scope) => updateFilters({ scope }),
    setMetric: (metric) => updateFilters({ metric }),
    retry: () => setRetryKey((key) => key + 1),
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}
