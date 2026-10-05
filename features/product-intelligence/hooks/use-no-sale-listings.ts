"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { getNoSaleListings } from "@/services/no-sale-listings"
import { startMlbAbcAutoRefresh } from "@/services/mlb-sales-abc-refresh"
import type {
  NoSaleAccount,
  NoSaleListingStatusFilter,
  NoSaleListingsFilters,
  NoSaleListingsResponse,
  NoSaleThreshold,
} from "@/types/no-sale-listings"

const defaultFilters: NoSaleListingsFilters = {
  account: "ALL",
  days: 30,
  listingStatus: "ACTIVE",
}

export function useNoSaleListings(initialFilters: NoSaleListingsFilters = defaultFilters) {
  const [filters, setFilters] = useState(initialFilters)
  const [report, setReport] = useState<NoSaleListingsResponse | null>(null)
  const [state, setState] = useState<"loading" | "success" | "error">("loading")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const sequence = useRef(0)
  const controller = useRef<AbortController | null>(null)

  const fetchReport = useCallback(async (
    currentFilters: NoSaleListingsFilters,
    initial: boolean,
  ) => {
    const request = ++sequence.current
    controller.current?.abort()
    controller.current = new AbortController()
    if (initial) {
      setState("loading")
      setErrorMessage(null)
    } else {
      setIsRefreshing(true)
    }
    try {
      const response = await getNoSaleListings(currentFilters, controller.current.signal)
      if (request !== sequence.current) return
      setReport(response)
      setState("success")
      setErrorMessage(null)
    } catch (error: unknown) {
      if (isAbort(error) || request !== sequence.current) return
      if (initial) {
        setState("error")
        setErrorMessage(error instanceof Error ? error.message : "Não foi possível carregar os anúncios.")
      }
    } finally {
      if (request === sequence.current) setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void fetchReport(filters, true), 0)
    return () => {
      window.clearTimeout(timer)
      controller.current?.abort()
      sequence.current += 1
    }
  }, [fetchReport, filters, retryKey])

  useEffect(() => startMlbAbcAutoRefresh({
    refresh: () => void fetchReport(filters, false),
    visibility: document,
  }), [fetchReport, filters])

  const update = useCallback((next: Partial<NoSaleListingsFilters>) => {
    setFilters((current) => ({ ...current, ...next }))
  }, [])

  return {
    filters,
    report,
    state,
    errorMessage,
    isRefreshing,
    setAccount: (account: NoSaleAccount) => update({ account }),
    setDays: (days: NoSaleThreshold) => update({ days }),
    setListingStatus: (listingStatus: NoSaleListingStatusFilter) => update({ listingStatus }),
    retry: () => setRetryKey((value) => value + 1),
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}
