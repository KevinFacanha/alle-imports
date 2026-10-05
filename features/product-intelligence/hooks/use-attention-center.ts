"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { getMlbSalesAbc } from "@/services/mlb-sales-abc"
import { startMlbAbcAutoRefresh } from "@/services/mlb-sales-abc-refresh"
import { getNoSaleListings } from "@/services/no-sale-listings"
import type { MlbAbcScope, MlbSalesAbcReport } from "@/types/mlb-sales-abc"
import type { NoSaleListingsResponse } from "@/types/no-sale-listings"

type RequestState = "loading" | "success" | "error"

export function useAttentionCenter(initialScope: MlbAbcScope = "CONSOLIDATED") {
  const [scope, setScope] = useState<MlbAbcScope>(initialScope)
  const [abcReport, setAbcReport] = useState<MlbSalesAbcReport | null>(null)
  const [noSaleReport, setNoSaleReport] = useState<NoSaleListingsResponse | null>(null)
  const [abcState, setAbcState] = useState<RequestState>("loading")
  const [noSaleState, setNoSaleState] = useState<RequestState>("loading")
  const [abcError, setAbcError] = useState<string | null>(null)
  const [noSaleError, setNoSaleError] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const sequence = useRef(0)
  const controller = useRef<AbortController | null>(null)

  const load = useCallback(async (selectedScope: MlbAbcScope, initial: boolean) => {
    const request = ++sequence.current
    controller.current?.abort()
    const currentController = new AbortController()
    controller.current = currentController

    if (initial) {
      setAbcReport(null)
      setNoSaleReport(null)
      setAbcState("loading")
      setNoSaleState("loading")
      setAbcError(null)
      setNoSaleError(null)
    } else {
      setIsRefreshing(true)
    }

    const abcPromise = getMlbSalesAbc({
      period: 30,
      scope: selectedScope,
      metric: "UNITS",
    }, currentController.signal)
      .then((report) => {
        if (request !== sequence.current) return
        setAbcReport(report)
        setAbcState("success")
        setAbcError(null)
      })
      .catch((error: unknown) => {
        if (isAbort(error) || request !== sequence.current) return
        setAbcState("error")
        setAbcError(messageFrom(error, "Não foi possível carregar a evolução da Curva ABC."))
      })

    const noSalePromise = getNoSaleListings({
      account: selectedScope === "CONSOLIDATED" ? "ALL" : selectedScope,
      days: 30,
      listingStatus: "ACTIVE",
    }, currentController.signal)
      .then((report) => {
        if (request !== sequence.current) return
        setNoSaleReport(report)
        setNoSaleState("success")
        setNoSaleError(null)
      })
      .catch((error: unknown) => {
        if (isAbort(error) || request !== sequence.current) return
        setNoSaleState("error")
        setNoSaleError(messageFrom(error, "Não foi possível carregar os anúncios sem venda."))
      })

    await Promise.allSettled([abcPromise, noSalePromise])
    if (request === sequence.current) setIsRefreshing(false)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(scope, true), 0)
    return () => {
      window.clearTimeout(timer)
      controller.current?.abort()
      sequence.current += 1
    }
  }, [load, retryKey, scope])

  useEffect(() => startMlbAbcAutoRefresh({
    refresh: () => void load(scope, false),
    visibility: document,
  }), [load, scope])

  return {
    scope,
    abcReport,
    noSaleReport,
    abcState,
    noSaleState,
    abcError,
    noSaleError,
    isRefreshing,
    setScope,
    retry: () => setRetryKey((key) => key + 1),
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}
