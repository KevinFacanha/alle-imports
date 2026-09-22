import { CalendarDays, Store } from "lucide-react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { MarketplaceAccountSummary } from "@/types/seller-metrics"

interface SellerMetricsFiltersProps {
  accounts: MarketplaceAccountSummary[]
  selectedAccountId: string
  selectedDate: string
  availableDates: string[]
  disabled: boolean
  onAccountChange: (accountId: string) => void
  onDateChange: (date: string) => void
}

export function SellerMetricsFilters({
  accounts,
  selectedAccountId,
  selectedDate,
  availableDates,
  disabled,
  onAccountChange,
  onDateChange,
}: SellerMetricsFiltersProps) {
  return (
    <div className="grid w-full gap-3 sm:w-auto sm:grid-cols-2">
      <label className="space-y-1.5">
        <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[.12em] text-slate-400">
          <Store size={13} /> Conta
        </span>
        <Select value={selectedAccountId} onValueChange={onAccountChange} disabled={disabled || accounts.length === 0}>
          <SelectTrigger className="h-11 w-full min-w-56 rounded-xl border-slate-200 bg-white px-3 shadow-none">
            <SelectValue placeholder="Selecione uma conta" />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                {account.name} · {marketplaceLabel(account.marketplace)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="space-y-1.5">
        <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[.12em] text-slate-400">
          <CalendarDays size={13} /> Data
        </span>
        <input
          type="date"
          value={selectedDate}
          onChange={(event) => onDateChange(event.target.value)}
          disabled={disabled || !selectedAccountId}
          aria-describedby="available-dates"
          className="h-11 w-full min-w-44 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-[#6254d9] focus:ring-2 focus:ring-[#6254d9]/15 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <span id="available-dates" className="block text-[10px] text-slate-400">
          {availableDates.length === 1
            ? "1 data processada no mês"
            : `${availableDates.length} datas processadas no mês`}
        </span>
      </label>
    </div>
  )
}

function marketplaceLabel(marketplace: MarketplaceAccountSummary["marketplace"]): string {
  return marketplace === "MERCADO_LIVRE" ? "Mercado Livre" : "Shopee"
}
