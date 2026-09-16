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

export interface NavigationItem {
  id: View
  label: string
  icon: LucideIcon
  badge?: {
    label: string
    className: string
  }
}
