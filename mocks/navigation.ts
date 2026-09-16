import {
  Activity,
  BarChart3,
  Bell,
  Check,
  History,
  LayoutDashboard,
  MessageSquare,
  PlugZap,
} from "lucide-react"

import type { NavigationItem } from "@/types/navigation"

export const navigationItems: NavigationItem[] = [
  { id: "assistente", href: "/assistant", label: "Assistente", icon: MessageSquare },
  { id: "dashboard", href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "operacao", href: "/operation", label: "Operação", icon: Activity },
  {
    id: "alertas",
    href: "/alerts",
    label: "Alertas",
    icon: Bell,
    badge: {
      label: "4",
      className: "bg-rose-100 text-rose-600",
    },
  },
  {
    id: "aprovacoes",
    href: "/approvals",
    label: "Aprovações",
    icon: Check,
    badge: {
      label: "3",
      className: "bg-amber-100 text-amber-700",
    },
  },
  { id: "historico", href: "/history", label: "Histórico", icon: History },
  { id: "integracoes", href: "/integrations", label: "Integrações", icon: PlugZap },
  {
    id: "inteligencia",
    href: "/market-intelligence",
    label: "Inteligência de Mercado",
    icon: BarChart3,
  },
]
