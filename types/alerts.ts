export type AlertTone = "critical" | "warning" | "info"

export interface AlertItem {
  title: string
  detail: string
  tone: AlertTone
}
