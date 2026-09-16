import type { LucideIcon } from "lucide-react"

export interface MarketSummaryMetric {
  label: string
  value: string
  detail: string
  icon: LucideIcon
}

export interface MarketCompetitor {
  name: string
  price: string
  sales: string
  position: string
  tone: string
}

export interface MarketAdvantage {
  title: string
  detail: string
  tone: string
  backgroundClassName: string
}

export interface ListingHealthMetric {
  label: string
  value: string
  colorClassName: string
}
