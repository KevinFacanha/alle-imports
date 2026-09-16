"use client"

import { createContext, useContext, useState, type ReactNode } from "react"

import type { ApprovalsProps } from "@/features/approvals/types"

const ApprovalsContext = createContext<ApprovalsProps | null>(null)

export function ApprovalsProvider({ children }: { children: ReactNode }) {
  const [approved, setApproved] = useState<string[]>([])

  return (
    <ApprovalsContext.Provider value={{ approved, setApproved }}>
      {children}
    </ApprovalsContext.Provider>
  )
}

export function useApprovals() {
  const context = useContext(ApprovalsContext)

  if (!context) {
    throw new Error("useApprovals must be used within an ApprovalsProvider")
  }

  return context
}
