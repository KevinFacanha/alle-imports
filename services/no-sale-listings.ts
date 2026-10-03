import type {
  NoSaleListingsFilters,
  NoSaleListingsResponse,
} from "@/types/no-sale-listings"

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001/api/v1").replace(
  /\/$/,
  "",
)

export class NoSaleListingsApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = "NoSaleListingsApiError"
  }
}

export async function getNoSaleListings(
  filters: NoSaleListingsFilters,
  signal?: AbortSignal,
): Promise<NoSaleListingsResponse> {
  const query = new URLSearchParams({
    account: filters.account,
    days: String(filters.days),
    listingStatus: filters.listingStatus,
  })
  const response = await fetch(
    `${API_BASE_URL}/analytics/product-intelligence/alerts/no-sale?${query}`,
    {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal,
    },
  )

  if (!response.ok) {
    throw new NoSaleListingsApiError(
      response.status,
      `A API de anúncios sem venda respondeu com ${response.status}.`,
    )
  }
  return response.json() as Promise<NoSaleListingsResponse>
}
