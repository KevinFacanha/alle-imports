import { AlertTriangle, Database, Truck, X } from "lucide-react"

import type { HumanIntervention, OperationMetric } from "@/types/operation"

export const operationMetrics: OperationMetric[] = [
  {
    name: "Pedidos atrasados",
    value: "12",
    detail: "Requer ação",
    icon: AlertTriangle,
    colorClassName: "text-rose-500",
    backgroundClassName: "bg-rose-50",
  },
  {
    name: "Devoluções a caminho",
    value: "7",
    detail: "Em trânsito",
    icon: Truck,
    colorClassName: "text-amber-500",
    backgroundClassName: "bg-amber-50",
  },
  {
    name: "Vendas canceladas",
    value: "4",
    detail: "Últimos 7 dias",
    icon: X,
    colorClassName: "text-slate-500",
    backgroundClassName: "bg-slate-100",
  },
  {
    name: "Notas fiscais pendentes",
    value: "9",
    detail: "Emitir agora",
    icon: Database,
    colorClassName: "text-[#6254d9]",
    backgroundClassName: "bg-[#eeecff]",
  },
]

export const humanInterventions: HumanIntervention[] = [
  { description: "Pedido #MLB-48291 está atrasado há 2 dias" },
  { description: "Cliente solicitou troca fora do prazo" },
  { description: "NF #004821 aguardando correção de endereço" },
]
