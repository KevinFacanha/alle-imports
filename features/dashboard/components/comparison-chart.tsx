"use client"

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { ChartContainer, type ChartConfig } from "@/components/ui/chart"
import type {
  ComparisonMetricName,
  SellerMetricsComparisonAccount,
} from "@/types/seller-metrics"

type MetricFormat = "currency" | "percentage" | "integer"

interface ComparisonChartProps {
  title: string
  description: string
  metric: ComparisonMetricName
  format: MetricFormat
  accounts: SellerMetricsComparisonAccount[]
  className?: string
  action?: React.ReactNode
}

interface ChartPoint {
  date: string
  accountA: number | null
  accountB: number | null
}

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
})
const integer = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 })
const percentage = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const compact = new Intl.NumberFormat("pt-BR", {
  notation: "compact",
  maximumFractionDigits: 1,
})

export function ComparisonChart({
  title,
  description,
  metric,
  format,
  accounts,
  className = "",
  action,
}: ComparisonChartProps) {
  const [accountA, accountB] = accounts
  if (!accountA || !accountB) return null

  const accountBDays = new Map(accountB.days.map((day) => [day.date, day]))
  const data: ChartPoint[] = accountA.days.map((dayA) => {
    const dayB = accountBDays.get(dayA.date)
    return {
      date: dayA.date,
      accountA: metricValue(dayA, metric),
      accountB: dayB ? metricValue(dayB, metric) : null,
    }
  })
  const hasMetricData = data.some(
    (point) => point.accountA !== null || point.accountB !== null,
  )
  const config = {
    accountA: { label: accountA.name, color: "#6254d9" },
    accountB: { label: accountB.name, color: "#0f766e" },
  } satisfies ChartConfig

  return (
    <article
      className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/30 sm:p-5 ${className}`}
    >
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-base font-bold tracking-[-.025em] text-slate-900">{title}</h3>
          <p className="mt-1 text-xs text-slate-400">{description}</p>
        </div>
        {action}
      </div>

      {hasMetricData ? (
        <ChartContainer config={config} className="h-72 w-full aspect-auto">
          <LineChart data={data} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              axisLine={false}
              tickLine={false}
              minTickGap={24}
              tickFormatter={formatShortDate}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              width={66}
              tickFormatter={(value: number) => formatAxisValue(value, format)}
            />
            <Tooltip
              filterNull={false}
              cursor={{ stroke: "#cbd5e1", strokeDasharray: "4 4" }}
              content={
                <ComparisonTooltip
                  accountAName={accountA.name}
                  accountBName={accountB.name}
                  format={format}
                />
              }
            />
            <Legend
              iconType="circle"
              iconSize={8}
              formatter={(value) => (
                <span className="text-xs font-medium text-slate-500">{value}</span>
              )}
            />
            <Line
              type="monotone"
              dataKey="accountA"
              name={accountA.name}
              stroke="var(--color-accountA)"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4 }}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="accountB"
              name={accountB.name}
              stroke="var(--color-accountB)"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ChartContainer>
      ) : (
        <div className="grid h-72 place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 text-center">
          <div>
            <p className="text-sm font-semibold text-slate-500">Sem dados para este indicador</p>
            <p className="mt-1 text-xs text-slate-400">Os valores ausentes não são convertidos em zero.</p>
          </div>
        </div>
      )}
    </article>
  )
}

function ComparisonTooltip({
  active,
  label,
  payload,
  accountAName,
  accountBName,
  format,
}: {
  active?: boolean
  label?: string | number
  payload?: {
    dataKey?: string | number
    color?: string
    value?: number | null
    payload?: ChartPoint
  }[]
  accountAName: string
  accountBName: string
  format: MetricFormat
}) {
  if (!active || !label) return null
  const point = payload?.[0]?.payload
  const values = point ?? {
    date: String(label),
    accountA: null,
    accountB: null,
  }

  return (
    <div className="min-w-52 rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-xl">
      <p className="mb-2 font-bold text-slate-800">{formatLongDate(String(label))}</p>
      <TooltipRow
        color="#6254d9"
        label={accountAName}
        value={formatValue(values.accountA, format)}
      />
      <TooltipRow
        color="#0f766e"
        label={accountBName}
        value={formatValue(values.accountB, format)}
      />
    </div>
  )
}

function TooltipRow({
  color,
  label,
  value,
}: {
  color: string
  label: string
  value: string
}) {
  return (
    <div className="mt-1.5 flex items-center justify-between gap-5">
      <span className="flex min-w-0 items-center gap-2 text-slate-500">
        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className="truncate">{label}</span>
      </span>
      <span className="shrink-0 font-bold tabular-nums text-slate-800">{value}</span>
    </div>
  )
}

function metricValue(
  day: SellerMetricsComparisonAccount["days"][number],
  metric: ComparisonMetricName,
): number | null {
  if (!day.snapshotAvailable) return null
  const value = day[metric]
  if (value === null) return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function formatValue(value: number | null, format: MetricFormat): string {
  if (value === null) return "Indisponível"
  if (format === "currency") return currency.format(value)
  if (format === "percentage") return `${percentage.format(value)}%`
  return integer.format(value)
}

function formatAxisValue(value: number, format: MetricFormat): string {
  if (format === "currency") return `R$ ${compact.format(value)}`
  if (format === "percentage") return `${percentage.format(value)}%`
  return compact.format(value)
}

function formatShortDate(value: string): string {
  const [, month, day] = value.split("-")
  return `${day}/${month}`
}

function formatLongDate(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(
    new Date(`${value}T00:00:00Z`),
  )
}
