import { PageList } from "@/components/shared/page-list"
import { alerts } from "@/mocks/alerts"

export function Alerts() {
  return (
    <PageList
      title="Alertas"
      eyebrow="Monitoramento"
      description="Sinais importantes detectados pelos seus agentes."
      items={alerts}
    />
  )
}
