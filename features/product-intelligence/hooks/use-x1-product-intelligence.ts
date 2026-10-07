"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { startMlbAbcAutoRefresh } from "@/services/mlb-sales-abc-refresh"
import { getX1ProductIntelligence } from "@/services/x1-product-intelligence"
import type {
  X1Period,
  X1ProductIntelligenceResponse,
} from "@/types/x1-product-intelligence"

export function useX1ProductIntelligence(initialPeriod: X1Period = 30) {
  const [period, setPeriod] = useState<X1Period>(initialPeriod)
  const [report, setReport] = useState<X1ProductIntelligenceResponse | null>(null)
  const [state, setState] = useState<"loading" | "success" | "error">("loading")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const sequence = useRef(0)
  const controller = useRef<AbortController | null>(null)

  const fetchReport = useCallback(async (days: X1Period, initial: boolean) => {
    const request = ++sequence.current
    controller.current?.abort()
    controller.current = new AbortController()
    if (initial) {
      setState("loading")
      setReport(null)
      setErrorMessage(null)
    } else {
      setIsRefreshing(true)
    }

    try {
      const response = await getX1ProductIntelligence(days, controller.current.signal)
      if (request !== sequence.current) return
      setReport(response)
      setState("success")
      setErrorMessage(null)
    } catch (error: unknown) {
      if (isAbort(error) || request !== sequence.current) return
      if (initial) {
        setState("error")
        setErrorMessage(error instanceof Error
          ? error.message
          : "Não foi possível carregar o comparativo X1 C1×C2.")
      }
    } finally {
      if (request === sequence.current) setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void fetchReport(period, true), 0)
    return () => {
      window.clearTimeout(timer)
      controller.current?.abort()
      sequence.current += 1
    }
  }, [fetchReport, period, retryKey])

  useEffect(() => startMlbAbcAutoRefresh({
    refresh: () => void fetchReport(period, false),
    visibility: document,
  }), [fetchReport, period])

  return {
    period,
    report,
    state: state === "success" && report?.pairs.length === 0 ? "empty" as const : state,
    errorMessage,
    isRefreshing,
    setPeriod,
    refresh: () => void fetchReport(period, false),
    retry: () => setRetryKey((value) => value + 1),
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}
