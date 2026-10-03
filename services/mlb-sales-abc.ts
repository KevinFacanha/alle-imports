import type {
  MlbAbcPeriod,
  MlbSalesAbcFilters,
  MlbSalesAbcReport,
} from "@/types/mlb-sales-abc"

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001/api/v1").replace(
  /\/$/,
  "",
)

export const MLB_ABC_PERIODS: Record<
  MlbAbcPeriod,
  { label: string; shortLabel: string }
> = {
  30: { label: "30 dias", shortLabel: "30D" },
  60: { label: "60 dias", shortLabel: "60D" },
  90: { label: "90 dias", shortLabel: "90D" },
}

export class MlbSalesAbcApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = "MlbSalesAbcApiError"
  }
}

export async function getMlbSalesAbc(
  filters: MlbSalesAbcFilters,
  signal?: AbortSignal,
): Promise<MlbSalesAbcReport> {
  const query = new URLSearchParams({
    days: String(filters.period),
    scope: filters.scope,
    metric: filters.metric,
  })
  const response = await fetch(`${API_BASE_URL}/analytics/mlb-abc?${query}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  })

  if (!response.ok) {
    throw new MlbSalesAbcApiError(
      response.status,
      `A API da Curva ABC respondeu com ${response.status}.`,
    )
  }

  return response.json() as Promise<MlbSalesAbcReport>
}
