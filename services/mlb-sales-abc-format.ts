const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
})

const percentage = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatAbcCurrency(value: string | number): string {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? currency.format(numericValue) : "—"
}

export function formatAbcPercentage(value: number): string {
  return `${percentage.format(value)}%`
}

export function formatSignedAbcPercentage(value: number | null): string {
  if (value === null) return "—"
  const sign = value > 0 ? "+" : ""
  return `${sign}${formatAbcPercentage(value)}`
}
