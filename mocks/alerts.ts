import type { AlertItem } from "@/types/alerts"

export const alerts: AlertItem[] = [
  { title: "8 produtos estão sem giro há mais de 60 dias.", detail: "Recomendação comercial", tone: "warning" },
  { title: "Reputação Flex caiu esta semana.", detail: "Acompanhamento de canal", tone: "critical" },
  { title: "4 devoluções precisam de análise.", detail: "Operação", tone: "warning" },
  { title: "17 produtos são candidatos a promoção.", detail: "Oportunidade", tone: "info" },
]
