import type { ReactNode } from "react"

import { cn } from "@/lib/utils"
import { MLB_ABC_PERIODS } from "@/services/mlb-sales-abc"
import type {
  MlbAbcMetric,
  MlbAbcPeriod,
  MlbAbcScope,
  MlbSalesAbcFilters,
} from "@/types/mlb-sales-abc"

interface MlbAbcFiltersProps {
  filters: MlbSalesAbcFilters
  disabled: boolean
  onPeriodChange: (period: MlbAbcPeriod) => void
  onScopeChange: (scope: MlbAbcScope) => void
  onMetricChange: (metric: MlbAbcMetric) => void
}

const periods = [30, 60, 90] as const
const scopes = [
  { value: "C1", label: "C1" },
  { value: "C2", label: "C2" },
  { value: "CONSOLIDATED", label: "Consolidado" },
] as const
const metrics = [
  { value: "UNITS", label: "Unidades" },
  { value: "GROSS_REVENUE", label: "Faturamento" },
] as const

export function MlbAbcFilters({
  filters,
  disabled,
  onPeriodChange,
  onScopeChange,
  onMetricChange,
}: MlbAbcFiltersProps) {
  return (
    <div className="grid gap-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/30 lg:grid-cols-[1fr_1fr_1fr] lg:p-5">
      <FilterGroup label="Período">
        {periods.map((period) => (
          <FilterButton
            key={period}
            active={filters.period === period}
            disabled={disabled}
            onClick={() => onPeriodChange(period)}
          >
            {MLB_ABC_PERIODS[period].label}
          </FilterButton>
        ))}
      </FilterGroup>

      <FilterGroup label="Conta">
        {scopes.map((scope) => (
          <FilterButton
            key={scope.value}
            active={filters.scope === scope.value}
            disabled={disabled}
            onClick={() => onScopeChange(scope.value)}
          >
            {scope.label}
          </FilterButton>
        ))}
      </FilterGroup>

      <FilterGroup label="Métrica da curva">
        {metrics.map((metric) => (
          <FilterButton
            key={metric.value}
            active={filters.metric === metric.value}
            disabled={disabled}
            onClick={() => onMetricChange(metric.value)}
          >
            {metric.label}
          </FilterButton>
        ))}
      </FilterGroup>
    </div>
  )
}

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-[10px] font-bold uppercase tracking-[.16em] text-slate-400">
        {label}
      </legend>
      <div className="flex w-full rounded-xl bg-slate-100 p-1">{children}</div>
    </fieldset>
  )
}

function FilterButton({
  active,
  className,
  type = "button",
  ...props
}: React.ComponentProps<"button"> & { active: boolean }) {
  return (
    <button
      type={type}
      aria-pressed={active}
      className={cn(
        "min-w-0 flex-1 rounded-lg px-2.5 py-2 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6254d9]/40 disabled:cursor-wait disabled:opacity-60",
        active
          ? "bg-white text-[#6254d9] shadow-sm"
          : "text-slate-500 hover:bg-white/60 hover:text-slate-800",
        className,
      )}
      {...props}
    />
  )
}
