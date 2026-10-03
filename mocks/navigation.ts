import {
  Activity,
  BarChart3,
  Bell,
  Check,
  History,
  LayoutDashboard,
  MessageSquare,
  PackageSearch,
  PlugZap,
} from "lucide-react"

import type { NavigationItem } from "@/types/navigation"

export const navigationItems: NavigationItem[] = [
  { id: "assistente", label: "Assistente", icon: MessageSquare },
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "product-intelligence", label: "Product Intelligence", icon: PackageSearch },
  { id: "operacao", label: "Operação", icon: Activity },
  {
    id: "alertas",
    label: "Alertas",
    icon: Bell,
    badge: {
      label: "4",
      className: "bg-rose-100 text-rose-600",
    },
  },
  {
    id: "aprovacoes",
    label: "Aprovações",
    icon: Check,
    badge: {
      label: "3",
      className: "bg-amber-100 text-amber-700",
    },
  },
  { id: "historico", label: "Histórico", icon: History },
  { id: "integracoes", label: "Integrações", icon: PlugZap },
  { id: "inteligencia", label: "Inteligência de Mercado", icon: BarChart3 },
]
