import type {
  ComparisonMetricName,
  SellerMetricsComparisonAccount,
  SellerMetricsComparisonDay,
} from "@/types/seller-metrics"

export type ComparisonMetricFormat = "currency" | "percentage" | "integer" | "decimal"

export interface DailyMetricPeak {
  date: string
  value: number
}

export interface AccountPeriodPerformance {
  availableDays: number
  averageGrossSales: number | null
  averageSalesCount: number | null
  bestGrossSalesDay: DailyMetricPeak | null
  highestSalesCountDay: DailyMetricPeak | null
  highestMarginRateDay: DailyMetricPeak | null
  highestFullGrossSalesDay: DailyMetricPeak | null
}

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
})
const integer = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 })
const decimal = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const date = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "UTC",
})

export function getAbsoluteDifference(
  valueA: string | null,
  valueB: string | null,
): number | null {
  const accountA = toFiniteNumber(valueA)
  const accountB = toFiniteNumber(valueB)
  if (accountA === null || accountB === null) return null
  return Math.abs(accountA - accountB)
}

export function calculatePeriodPerformance(
  account: SellerMetricsComparisonAccount,
): AccountPeriodPerformance {
  const availableDays = account.days.filter((day) => day.snapshotAvailable)

  return {
    availableDays: availableDays.length,
    averageGrossSales: averageForAvailableDays(availableDays, "grossSales"),
    averageSalesCount: averageForAvailableDays(availableDays, "salesCount"),
    bestGrossSalesDay: findPeak(availableDays, "grossSales"),
    highestSalesCountDay: findPeak(availableDays, "salesCount"),
    highestMarginRateDay: findPeak(availableDays, "marginRate"),
    highestFullGrossSalesDay: findPeak(availableDays, "fullGrossSales"),
  }
}

export function formatComparisonMetric(
  value: string | number | null,
  format: ComparisonMetricFormat,
): string {
  const numeric = toFiniteNumber(value)
  if (numeric === null) return "Indisponível"
  if (format === "currency") return currency.format(numeric)
  if (format === "percentage") return `${decimal.format(numeric)}%`
  if (format === "decimal") return decimal.format(numeric)
  return integer.format(numeric)
}

export function formatDifference(
  valueA: string | null,
  valueB: string | null,
  format: ComparisonMetricFormat,
): string {
  const difference = getAbsoluteDifference(valueA, valueB)
  if (difference === null) return "Indisponível"
  if (format === "percentage") return `${decimal.format(difference)} p.p.`
  return formatComparisonMetric(difference, format)
}

export function formatComparisonDate(value: string): string {
  return date.format(new Date(`${value}T00:00:00Z`))
}

function averageForAvailableDays(
  days: SellerMetricsComparisonDay[],
  metric: ComparisonMetricName,
): number | null {
  if (days.length === 0) return null
  let total = 0
  for (const day of days) {
    const value = metricValue(day, metric)
    if (value === null) return null
    total += value
  }

  return total / days.length
}

function findPeak(
  days: SellerMetricsComparisonDay[],
  metric: ComparisonMetricName,
): DailyMetricPeak | null {
  return days.reduce<DailyMetricPeak | null>((peak, day) => {
    const value = metricValue(day, metric)
    if (value === null || (peak && peak.value >= value)) return peak
    return { date: day.date, value }
  }, null)
}

function metricValue(
  day: SellerMetricsComparisonDay,
  metric: ComparisonMetricName,
): number | null {
  if (!day.snapshotAvailable) return null
  return toFiniteNumber(day[metric])
}

function toFiniteNumber(value: string | number | null): number | null {
  if (value === null) return null
  const numeric = typeof value === "number" ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}
