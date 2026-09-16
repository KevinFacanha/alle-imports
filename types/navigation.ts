import type { LucideIcon } from "lucide-react"

export type View =
  | "assistente"
  | "dashboard"
  | "operacao"
  | "alertas"
  | "aprovacoes"
  | "historico"
  | "integracoes"
  | "inteligencia"

export type PlatformPath =
  | "/assistant"
  | "/dashboard"
  | "/operation"
  | "/alerts"
  | "/approvals"
  | "/history"
  | "/integrations"
  | "/market-intelligence"

export interface NavigationItem {
  id: View
  href: PlatformPath
  label: string
  icon: LucideIcon
  badge?: {
    label: string
    className: string
  }
}
