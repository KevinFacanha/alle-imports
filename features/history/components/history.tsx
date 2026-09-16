import { PageList } from "@/components/shared/page-list"
import { historyItems } from "@/mocks/history"

export function History() {
  return (
    <PageList
      title="Histórico"
      eyebrow="Atividade"
      description="Tudo que aconteceu na sua operação recentemente."
      items={historyItems}
    />
  )
}
