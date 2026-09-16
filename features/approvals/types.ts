import type { Dispatch, SetStateAction } from "react"

export interface ApprovalsProps {
  approved: string[]
  setApproved: Dispatch<SetStateAction<string[]>>
}

export type { Approval, ApprovalTone } from "@/types/approvals"
