"use client"

import { useState } from "react"
import { CalendarDays } from "lucide-react"

import { Button } from "@/components/ui/button"
import type {
  ComparisonPeriod,
  ComparisonPeriodPreset,
} from "@/features/dashboard/hooks/use-account-comparison"

interface ComparisonPeriodFilterProps {
  period: ComparisonPeriod | null
  preset: ComparisonPeriodPreset
  latestAvailableDate: string | null
  disabled?: boolean
  onPresetChange: (preset: 7 | 15 | 30) => void
  onShowCustom: () => void
  onCustomPeriodChange: (period: ComparisonPeriod) => string | null
}

const presets = [
  { value: 7, label: "7 dias" },
  { value: 15, label: "15 dias" },
  { value: 30, label: "30 dias" },
] as const

export function ComparisonPeriodFilter({
  period,
  preset,
  latestAvailableDate,
  disabled,
  onPresetChange,
  onShowCustom,
  onCustomPeriodChange,
}: ComparisonPeriodFilterProps) {
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [validationError, setValidationError] = useState<string | null>(null)


  const applyCustomPeriod = () => {
    const error = onCustomPeriodChange({ from, to })
    setValidationError(error)
  }

  return (
    <div className="w-full space-y-3 xl:w-auto">
      <div>
        <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[.12em] text-slate-400">
          <CalendarDays size={13} /> Período
        </span>
        <div className="mt-1.5 flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1">
          {presets.map((item) => (
            <button
              key={item.value}
              type="button"
              disabled={disabled}
              onClick={() => {
                setValidationError(null)
                onPresetChange(item.value)
              }}
              className={
                preset === item.value
                  ? "rounded-lg bg-[#f1efff] px-3 py-2 text-xs font-bold text-[#6254d9]"
                  : "rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 transition hover:bg-slate-50 disabled:opacity-50"
              }
            >
              {item.label}
            </button>
          ))}
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setValidationError(null)
              setFrom(period?.from ?? from)
              setTo(period?.to ?? to)
              onShowCustom()
            }}
            className={
              preset === "custom"
                ? "rounded-lg bg-[#f1efff] px-3 py-2 text-xs font-bold text-[#6254d9]"
                : "rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 transition hover:bg-slate-50 disabled:opacity-50"
            }
          >
            Personalizado
          </button>
        </div>
      </div>

      {preset === "custom" && (
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <DateField label="Data inicial" value={from} onChange={setFrom} disabled={disabled} />
          <DateField label="Data final" value={to} onChange={setTo} disabled={disabled} />
          <Button
            type="button"
            onClick={applyCustomPeriod}
            disabled={disabled}
            className="h-10 self-end rounded-xl bg-[#6254d9] px-4 hover:bg-[#5547cd]"
          >
            Aplicar
          </Button>
        </div>
      )}

      <div className="min-h-4 text-right text-[10px]">
        {validationError ? (
          <span className="font-medium text-rose-500">{validationError}</span>
        ) : latestAvailableDate ? (
          <span className="text-slate-400">
            Último dia comum disponível: {formatDate(latestAvailableDate)}
          </span>
        ) : (
          <span className="text-slate-400">Nenhum dia comum localizado nos últimos 31 dias</span>
        )}
      </div>
    </div>
  )
}

function DateField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string
  value: string
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <label className="space-y-1">
      <span className="block text-[10px] font-bold text-slate-400">{label}</span>
      <input
        type="date"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 outline-none transition focus:border-[#6254d9] focus:ring-2 focus:ring-[#6254d9]/15 disabled:opacity-50"
      />
    </label>
  )
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(
    new Date(`${value}T00:00:00Z`),
  )
}
