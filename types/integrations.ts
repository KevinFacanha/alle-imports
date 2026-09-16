export type IntegrationStatus = "Conectado" | "Desconectado"

export interface Integration {
  name: string
  status: IntegrationStatus
  backgroundClassName: string
  initials: string
}
