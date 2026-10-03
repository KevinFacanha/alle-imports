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
  { label: string; shortLabel: string; start: string; end: string }
> = {
  30: { label: "30 dias", shortLabel: "30D", start: "2026-09-01", end: "2026-10-01" },
  60: { label: "60 dias", shortLabel: "60D", start: "2026-08-02", end: "2026-10-01" },
  90: { label: "90 dias", shortLabel: "90D", start: "2026-07-03", end: "2026-10-01" },
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
  const period = MLB_ABC_PERIODS[filters.period]
  const query = new URLSearchParams({
    start: period.start,
    end: period.end,
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
