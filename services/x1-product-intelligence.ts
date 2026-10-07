import type {
  X1Period,
  X1ProductIntelligenceResponse,
} from "@/types/x1-product-intelligence"

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001/api/v1").replace(
  /\/$/,
  "",
)

export class X1ProductIntelligenceApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = "X1ProductIntelligenceApiError"
  }
}

export async function getX1ProductIntelligence(
  days: X1Period,
  signal?: AbortSignal,
): Promise<X1ProductIntelligenceResponse> {
  const query = new URLSearchParams({ days: String(days) })
  const response = await fetch(
    `${API_BASE_URL}/analytics/product-intelligence/x1?${query}`,
    {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal,
    },
  )

  if (!response.ok) {
    throw new X1ProductIntelligenceApiError(
      response.status,
      `A API do X1 C1×C2 respondeu com ${response.status}.`,
    )
  }

  return response.json() as Promise<X1ProductIntelligenceResponse>
}
