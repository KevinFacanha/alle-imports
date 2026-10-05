export interface NoSaleDataCoverage {
  dataThrough: string | null
  isDataCurrent: boolean
  staleDays: number | null
}

export interface NoSaleStaleBanner {
  title: string
  detail: string | null
}

export function noSaleStaleBanner(
  coverage: NoSaleDataCoverage,
  formatDate: (value: string) => string,
): NoSaleStaleBanner | null {
  if (coverage.isDataCurrent || coverage.dataThrough === null) return null

  return {
    title: `Dados de pedidos até ${formatDate(coverage.dataThrough)}`,
    detail:
      coverage.staleDays === null
        ? null
        : `${coverage.staleDays} ${coverage.staleDays === 1 ? "dia" : "dias"} de defasagem`,
  }
}
