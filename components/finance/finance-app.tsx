import type { ReactNode } from "react"

import { ApplicationShell } from "@/components/layout/application-shell"

interface FinanceAppProps {
  children: ReactNode
}

export function FinanceApp({ children }: FinanceAppProps) {
  return <ApplicationShell>{children}</ApplicationShell>
}
