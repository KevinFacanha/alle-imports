export type ApprovalTone = "violet" | "blue" | "amber"

export interface Approval {
  title: string
  detail: string
  impact: string
  tone: ApprovalTone
}
