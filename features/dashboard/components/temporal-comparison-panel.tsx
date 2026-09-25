import {
  formatComparisonMetric,
  formatTemporalDifference,
  formatTemporalVariation,
  type ComparisonMetricResult,
} from "@/features/dashboard/lib/comparison-metrics"

export function TemporalComparisonPanel({
  accountLabel,
  accountName,
  currentLabel,
  previousLabel,
  results,
  accent = "violet",
}: {
  accountLabel: string
  accountName: string
  currentLabel: string
  previousLabel: string
  results: ComparisonMetricResult[]
  accent?: "violet" | "teal"
}) {
  const accentClass = accent === "violet" ? "bg-[#6254d9]" : "bg-[#0f766e]"

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/30">
      <header className="flex flex-col gap-2 border-b border-slate-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <span className={`size-2 rounded-full ${accentClass}`} />
            {accountLabel}
          </p>
          <p className="mt-1 truncate text-xs text-slate-400" title={accountName}>
            {accountName}
          </p>
        </div>
        <p className="text-[11px] font-semibold text-slate-500">
          {currentLabel} <span className="px-1 text-slate-300">×</span> {previousLabel}
        </p>
      </header>

      <div className="p-4 sm:p-5">
        <p className="text-[10px] font-bold uppercase tracking-[.12em] text-slate-400">
          Indicadores executivos
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {results.slice(0, 3).map(({ metric, comparison }) => (
            <article
              key={metric.name}
              className="rounded-xl border border-slate-100 bg-slate-50/70 p-4"
            >
              <p className="text-xs font-semibold text-slate-500">{metric.label}</p>
              <p className="mt-2 break-words text-lg font-bold tracking-[-.035em] text-slate-900">
                {formatComparisonMetric(comparison.current, metric.format)}
              </p>
              <p
                className={`mt-2 text-sm font-bold tabular-nums ${variationColor(comparison.direction)}`}
              >
                {formatTemporalVariation(comparison, metric.usePercentagePoints)}
              </p>
              <p className="mt-3 text-[11px] text-slate-400">
                {previousLabel}{" "}
                <span className="font-semibold tabular-nums text-slate-600">
                  {formatComparisonMetric(comparison.previous, metric.format)}
                </span>
              </p>
              <p className="mt-1 text-[11px] text-slate-400">
                Diferença{" "}
                <span className="font-semibold tabular-nums text-slate-600">
                  {formatTemporalDifference(comparison, metric.format)}
                </span>
              </p>
            </article>
          ))}
        </div>
      </div>

      <div className="border-t border-slate-100 bg-slate-50/40 px-4 py-5 sm:px-5">
        <p className="text-[10px] font-bold uppercase tracking-[.12em] text-slate-400">
          Comparação detalhada
        </p>

        <div className="mt-3 hidden sm:block">
          <table className="w-full table-fixed text-left">
            <thead>
              <tr className="border-b border-slate-100 text-[10px] font-bold uppercase tracking-[.08em] text-slate-400">
                <th className="w-[24%] pb-3 pr-2">Métrica</th>
                <th className="w-[19%] px-2 pb-3">{currentLabel}</th>
                <th className="w-[19%] px-2 pb-3">{previousLabel}</th>
                <th className="w-[19%] px-2 pb-3">Diferença</th>
                <th className="w-[19%] pl-2 pb-3">Variação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {results.map(({ metric, comparison }) => (
                <tr key={metric.name} className="text-xs">
                  <th className="py-3 pr-2 font-semibold text-slate-700">{metric.label}</th>
                  <td className="px-2 py-3 font-semibold tabular-nums text-slate-700">
                    {formatComparisonMetric(comparison.current, metric.format)}
                  </td>
                  <td className="px-2 py-3 tabular-nums text-slate-500">
                    {formatComparisonMetric(comparison.previous, metric.format)}
                  </td>
                  <td className="px-2 py-3 tabular-nums text-slate-500">
                    {formatTemporalDifference(comparison, metric.format)}
                  </td>
                  <td
                    className={`py-3 pl-2 font-bold tabular-nums ${variationColor(comparison.direction)}`}
                  >
                    {formatTemporalVariation(comparison, metric.usePercentagePoints)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-3 divide-y divide-slate-100 sm:hidden">
          {results.map(({ metric, comparison }) => (
            <div key={metric.name} className="py-4 first:pt-1">
              <p className="text-sm font-bold text-slate-800">{metric.label}</p>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
                <CompactValue
                  label={currentLabel}
                  value={formatComparisonMetric(comparison.current, metric.format)}
                />
                <CompactValue
                  label={previousLabel}
                  value={formatComparisonMetric(comparison.previous, metric.format)}
                />
                <CompactValue
                  label="Diferença"
                  value={formatTemporalDifference(comparison, metric.format)}
                />
                <CompactValue
                  label="Variação"
                  value={formatTemporalVariation(comparison, metric.usePercentagePoints)}
                />
              </dl>
            </div>
          ))}
        </div>
      </div>
    </article>
  )
}

function CompactValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[9px] font-bold uppercase tracking-[.08em] text-slate-400">{label}</dt>
      <dd className="mt-1 break-words text-xs font-semibold tabular-nums text-slate-700">{value}</dd>
    </div>
  )
}

function variationColor(direction: ComparisonMetricResult["comparison"]["direction"]): string {
  if (direction === "increase") return "text-emerald-600"
  if (direction === "decrease") return "text-rose-500"
  return "text-slate-500"
}
