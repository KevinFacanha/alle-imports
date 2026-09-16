import { CreditCard, Gauge, PackageSearch, TrendingUp } from "lucide-react"

import type { ReputationMetric, SalesDatum, SalesMetric } from "@/types/sales"

export const sales: SalesDatum[] = [
  { day: "Seg", total: 11200 },
  { day: "Ter", total: 14800 },
  { day: "Qua", total: 12500 },
  { day: "Qui", total: 18200 },
  { day: "Sex", total: 22100 },
  { day: "Sáb", total: 19800 },
  { day: "Dom", total: 27400 },
]

export const salesMetrics: SalesMetric[] = [
  { label: "Faturamento ML", value: "R$ 45.230,00", growth: "+12,8%", icon: TrendingUp },
  { label: "Faturamento Shopee", value: "R$ 32.180,00", growth: "+8,4%", icon: TrendingUp },
  { label: "Margem média", value: "28,5%", growth: "+2,1%", icon: Gauge },
  { label: "Total de pedidos", value: "241", growth: "+16,2%", icon: PackageSearch },
  { label: "Ticket médio", value: "R$ 321,20", growth: "+4,7%", icon: CreditCard },
]

export const reputationMetrics: ReputationMetric[] = [
  { name: "Flex", score: "4,8", progress: "96%" },
  { name: "Coleta", score: "4,5", progress: "90%" },
]
