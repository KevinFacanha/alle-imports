import type {
  DailySellerMetrics,
  DailySellerMetricsRange,
  MarketplaceAccountSummary,
} from "@/types/seller-metrics"

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001/api/v1").replace(
  /\/$/,
  "",
)

export class SellerMetricsApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = "SellerMetricsApiError"
  }
}

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  })

  if (!response.ok) {
    throw new SellerMetricsApiError(response.status, `Seller Metrics API respondeu com ${response.status}.`)
  }

  return response.json() as Promise<T>
}

export function getSellerMetricAccounts(signal?: AbortSignal) {
  return request<MarketplaceAccountSummary[]>("/analytics/seller-metrics/accounts", signal)
}

export function getDailySellerMetrics(
  marketplaceAccountId: string,
  date: string,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ marketplaceAccountId, date })
  return request<DailySellerMetrics>(`/analytics/seller-metrics/daily?${query}`, signal)
}

export function getDailySellerMetricsRange(
  marketplaceAccountId: string,
  from: string,
  to: string,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ marketplaceAccountId, from, to })
  return request<DailySellerMetricsRange>(`/analytics/seller-metrics/daily/range?${query}`, signal)
}
