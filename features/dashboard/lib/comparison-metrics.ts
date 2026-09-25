import type {
  ComparisonMetricName,
  SellerMetricsComparisonAccount,
  SellerMetricsComparisonDay,
} from "@/types/seller-metrics"

export type ComparisonMetricFormat = "currency" | "percentage" | "integer" | "decimal"

export interface ComparisonPeriod {
  from: string
  to: string
}

export type TemporalDirection = "increase" | "decrease" | "stable"

export interface TemporalMetricComparison {
  current: number | null
  previous: number | null
  absoluteDifference: number | null
  variation: number | null
  direction: TemporalDirection | null
}

export interface ComparisonMetricDefinition {
  name: ComparisonMetricName
  label: string
  format: ComparisonMetricFormat
  usePercentagePoints?: boolean
}

export interface ComparisonMetricResult {
  metric: ComparisonMetricDefinition
  comparison: TemporalMetricComparison
}

export type TemporalSignalTone = "positive" | "attention" | "stable"

export interface TemporalSignal {
  metricName: ComparisonMetricName
  label: string
  value: string
  tone: TemporalSignalTone
}

export interface AccountComparisonFact {
  label: string
  value: string
}

export type FullParticipationMetric = "revenue" | "sales"

export interface FullParticipationValue {
  fullValue: number | null
  totalValue: number | null
  percentage: number | null
}

export type FullParticipation = Record<FullParticipationMetric, FullParticipationValue>

export interface FullParticipationTemporalComparison {
  current: FullParticipationValue
  previous: FullParticipationValue
  percentagePointVariation: number | null
}

export type FullParticipationTemporal = Record<
  FullParticipationMetric,
  FullParticipationTemporalComparison
>

type FullParticipationSource = Pick<
  SellerMetricsComparisonDay,
  "grossSales" | "fullGrossSales" | "salesCount" | "fullSalesCount"
>

export const comparisonMetricDefinitions: ComparisonMetricDefinition[] = [
  { name: "grossSales", label: "Faturamento", format: "currency" },
  { name: "marginRate", label: "Margem", format: "percentage", usePercentagePoints: true },
  { name: "fullGrossSales", label: "Faturamento Full", format: "currency" },
  { name: "averageTicket", label: "Ticket médio", format: "currency" },
  { name: "salesCount", label: "Vendas", format: "integer" },
  { name: "fullSalesCount", label: "Vendas Full", format: "integer" },
]

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
const variation = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

export function calculateFullParticipation(
  source: FullParticipationSource | null,
): FullParticipation {
  return {
    revenue: calculateParticipationValue(source?.fullGrossSales ?? null, source?.grossSales ?? null),
    sales: calculateParticipationValue(source?.fullSalesCount ?? null, source?.salesCount ?? null),
  }
}

export function compareFullParticipation(
  currentSource: FullParticipationSource | null,
  previousSource: FullParticipationSource | null,
): FullParticipationTemporal {
  const current = calculateFullParticipation(currentSource)
  const previous = calculateFullParticipation(previousSource)

  return {
    revenue: buildParticipationTemporalComparison(current.revenue, previous.revenue),
    sales: buildParticipationTemporalComparison(current.sales, previous.sales),
  }
}

export function getAccountDayParticipation(
  account: SellerMetricsComparisonAccount | null,
  dayValue: string,
): FullParticipationSource | null {
  return account?.days.find((day) => day.date === dayValue && day.snapshotAvailable) ?? null
}

export function getFullParticipationDifference(
  accountA: FullParticipation,
  accountB: FullParticipation,
  metric: FullParticipationMetric,
): number | null {
  const percentageA = accountA[metric].percentage
  const percentageB = accountB[metric].percentage
  if (percentageA === null || percentageB === null) return null
  return Math.abs(percentageA - percentageB)
}

export function formatFullParticipationPercentage(value: number | null): string {
  return value === null ? "Indisponível" : `${decimal.format(value)}%`
}

export function formatFullParticipationDetail(
  value: FullParticipationValue,
  metric: FullParticipationMetric,
): string {
  if (value.percentage === null || value.fullValue === null || value.totalValue === null) {
    return "Indisponível"
  }

  return metric === "revenue"
    ? `${currency.format(value.fullValue)} de ${currency.format(value.totalValue)}`
    : `${integer.format(value.fullValue)} de ${integer.format(value.totalValue)} vendas`
}

export function formatPercentagePointDifference(value: number | null): string {
  return value === null ? "Indisponível" : `${decimal.format(Math.abs(value))} p.p.`
}

export function formatPercentagePointVariation(value: number | null): string {
  if (value === null) return "Indisponível"
  if (value === 0) return `${decimal.format(0)} p.p.`
  return `${value > 0 ? "+" : "−"}${decimal.format(Math.abs(value))} p.p.`
}

export function getPreviousPeriod(period: ComparisonPeriod): ComparisonPeriod {
  const inclusiveDays = differenceInDays(period.from, period.to) + 1
  const to = addUtcDays(period.from, -1)
  return { from: addUtcDays(to, -(inclusiveDays - 1)), to }
}

export function calculateTemporalMetric(
  currentValue: string | number | null,
  previousValue: string | number | null,
  usePercentagePoints = false,
): TemporalMetricComparison {
  const current = toFiniteNumber(currentValue)
  const previous = toFiniteNumber(previousValue)

  if (current === null || previous === null) {
    return {
      current,
      previous,
      absoluteDifference: null,
      variation: null,
      direction: null,
    }
  }

  const difference = current - previous
  return {
    current,
    previous,
    absoluteDifference: Math.abs(difference),
    variation: usePercentagePoints
      ? Math.abs(difference)
      : previous === 0
        ? null
        : Math.abs((difference / previous) * 100),
    direction: difference > 0 ? "increase" : difference < 0 ? "decrease" : "stable",
  }
}

export function compareAccountPeriods(
  current: SellerMetricsComparisonAccount,
  previous: SellerMetricsComparisonAccount | null,
): ComparisonMetricResult[] {
  const hasCurrentData = current.availableDays > 0
  const hasPreviousData = Boolean(previous && previous.availableDays > 0)

  return comparisonMetricDefinitions.map((metric) => ({
    metric,
    comparison: calculateTemporalMetric(
      hasCurrentData ? current.summary[metric.name] : null,
      hasPreviousData && previous ? previous.summary[metric.name] : null,
      metric.usePercentagePoints,
    ),
  }))
}

export function getPrimaryTemporalSignals(
  results: ComparisonMetricResult[],
  limit = 3,
): TemporalSignal[] {
  return results
    .filter(({ comparison }) => comparison.variation !== null && comparison.direction !== null)
    .map(({ metric, comparison }) => ({
      metricName: metric.name,
      label: metric.label,
      value: formatTemporalVariation(comparison, metric.usePercentagePoints),
      tone: signalTone(comparison.direction ?? "stable"),
      magnitude: comparison.variation ?? 0,
    }))
    .sort((a, b) => b.magnitude - a.magnitude)
    .slice(0, limit)
    .map(({ metricName, label, value, tone }) => ({ metricName, label, value, tone }))
}

export function buildAccountComparisonFacts(
  accounts: SellerMetricsComparisonAccount[],
  periodResults: ComparisonMetricResult[][],
): AccountComparisonFact[] {
  const [accountA, accountB] = accounts
  if (!accountA || !accountB) return []

  const facts: AccountComparisonFact[] = []
  const accountLabels = ["Conta 1", "Conta 2"]

  for (const metricName of ["grossSales", "marginRate", "averageTicket"] as const) {
    const metric = comparisonMetricDefinitions.find((item) => item.name === metricName)
    const winner = higherAccountIndex(accountA.summary[metricName], accountB.summary[metricName])
    if (!metric || winner === null) continue
    const formattedValue = formatComparisonMetric(accountA.summary[metricName], metric.format)
    facts.push({
      label: metricName === "grossSales"
        ? "Maior faturamento no período"
        : metricName === "marginRate"
          ? "Maior margem"
          : "Maior ticket médio",
      value: winner === "tie"
        ? `Contas empatadas · ${formattedValue}`
        : `${accountLabels[winner]} · ${formatComparisonMetric(
          accounts[winner].summary[metricName],
          metric.format,
        )}`,
    })
  }

  const grossSalesGrowth = periodResults
    .map((results, accountIndex) => ({
      accountIndex,
      result: results.find(({ metric }) => metric.name === "grossSales"),
    }))
    .filter((item) => item.result?.comparison.variation !== null)
    .sort((a, b) => signedVariation(b.result!.comparison) - signedVariation(a.result!.comparison))[0]

  if (grossSalesGrowth?.result?.comparison.direction === "increase") {
    facts.push({
      label: "Maior crescimento relativo",
      value: `${accountLabels[grossSalesGrowth.accountIndex]} · Faturamento ${formatTemporalVariation(
        grossSalesGrowth.result.comparison,
      )}`,
    })
  }

  const principalDrop = periodResults
    .flatMap((results, accountIndex) =>
      results.map((result) => ({ accountIndex, result })),
    )
    .filter(({ result }) =>
      result.comparison.direction === "decrease" &&
      result.comparison.variation !== null &&
      !result.metric.usePercentagePoints,
    )
    .sort((a, b) => (b.result.comparison.variation ?? 0) - (a.result.comparison.variation ?? 0))[0]

  if (principalDrop) {
    facts.push({
      label: "Principal queda observada",
      value: `${accountLabels[principalDrop.accountIndex]} · ${principalDrop.result.metric.label} ${formatTemporalVariation(
        principalDrop.result.comparison,
        principalDrop.result.metric.usePercentagePoints,
      )}`,
    })
  }

  return facts
}

export function compareAccountDays(
  accountA: SellerMetricsComparisonAccount | null,
  accountB: SellerMetricsComparisonAccount | null,
  dateA: string,
  dateB: string,
): ComparisonMetricResult[] {
  const dayA = accountA?.days.find((day) => day.date === dateA && day.snapshotAvailable) ?? null
  const dayB = accountB?.days.find((day) => day.date === dateB && day.snapshotAvailable) ?? null

  return comparisonMetricDefinitions.map((metric) => ({
    metric,
    comparison: calculateTemporalMetric(
      dayA?.[metric.name] ?? null,
      dayB?.[metric.name] ?? null,
      metric.usePercentagePoints,
    ),
  }))
}

export function formatTemporalDifference(
  comparison: TemporalMetricComparison,
  format: ComparisonMetricFormat,
): string {
  if (comparison.absoluteDifference === null) return "Indisponível"
  const formatted = format === "percentage"
    ? decimal.format(comparison.absoluteDifference) + " p.p."
    : formatComparisonMetric(comparison.absoluteDifference, format)
  if (comparison.direction === "stable") return formatted
  return (comparison.direction === "increase" ? "+" : "−") + formatted
}

export function formatTemporalVariation(
  comparison: TemporalMetricComparison,
  usePercentagePoints = false,
): string {
  if (comparison.variation === null || comparison.direction === null) return "Indisponível"
  const arrow = comparison.direction === "increase" ? "↑" : comparison.direction === "decrease" ? "↓" : "→"
  return arrow + " " + variation.format(comparison.variation) + (usePercentagePoints ? " p.p." : "%")
}

export function describeTemporalVariation(
  label: string,
  comparison: TemporalMetricComparison,
  usePercentagePoints = false,
): string {
  if (comparison.variation === null || comparison.direction === null) {
    return label + ": Indisponível."
  }
  if (comparison.direction === "stable") return label + " permaneceu estável."
  const verb = comparison.direction === "increase" ? "aumentou" : "reduziu"
  return label + " " + verb + " " + variation.format(comparison.variation) + (usePercentagePoints ? " p.p." : "%") + "."
}

export function isComparisonPeriodPartial(accounts: SellerMetricsComparisonAccount[]): boolean {
  return accounts.some(
    (account) =>
      account.availableDays < account.expectedDays ||
      account.days.some((day) => day.snapshotAvailable && day.status === "PARTIAL"),
  )
}

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
  return date.format(new Date(value + "T00:00:00Z"))
}

function differenceInDays(from: string, to: string): number {
  return Math.floor((parseUtcDate(to).getTime() - parseUtcDate(from).getTime()) / 86_400_000)
}

function addUtcDays(value: string, amount: number): string {
  const result = parseUtcDate(value)
  result.setUTCDate(result.getUTCDate() + amount)
  return result.toISOString().slice(0, 10)
}

function parseUtcDate(value: string): Date {
  return new Date(value + "T00:00:00Z")
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

function calculateParticipationValue(
  fullValue: string | number | null,
  totalValue: string | number | null,
): FullParticipationValue {
  const full = toFiniteNumber(fullValue)
  const total = toFiniteNumber(totalValue)

  return {
    fullValue: full,
    totalValue: total,
    percentage: full === null || total === null || total === 0 ? null : (full / total) * 100,
  }
}

function buildParticipationTemporalComparison(
  current: FullParticipationValue,
  previous: FullParticipationValue,
): FullParticipationTemporalComparison {
  return {
    current,
    previous,
    percentagePointVariation:
      current.percentage === null || previous.percentage === null
        ? null
        : current.percentage - previous.percentage,
  }
}

function signalTone(direction: TemporalDirection): TemporalSignalTone {
  if (direction === "increase") return "positive"
  if (direction === "decrease") return "attention"
  return "stable"
}

function higherAccountIndex(
  valueA: string | null,
  valueB: string | null,
): 0 | 1 | "tie" | null {
  const numericA = toFiniteNumber(valueA)
  const numericB = toFiniteNumber(valueB)
  if (numericA === null || numericB === null) return null
  if (numericA === numericB) return "tie"
  return numericA > numericB ? 0 : 1
}

function signedVariation(comparison: TemporalMetricComparison): number {
  if (comparison.variation === null) return Number.NEGATIVE_INFINITY
  return comparison.direction === "decrease" ? -comparison.variation : comparison.variation
}
