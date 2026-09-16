import type { LucideIcon } from "lucide-react"

export interface SalesDatum {
  day: string
  total: number
}

export interface SalesMetric {
  label: string
  value: string
  growth: string
  icon: LucideIcon
}

export interface ReputationMetric {
  name: string
  score: string
  progress: string
}
