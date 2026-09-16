import type { LucideIcon } from "lucide-react"

export interface OperationMetric {
  name: string
  value: string
  detail: string
  icon: LucideIcon
  colorClassName: string
  backgroundClassName: string
}

export interface HumanIntervention {
  description: string
}
