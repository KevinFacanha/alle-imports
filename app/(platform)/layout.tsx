import type { ReactNode } from "react"

import { ApplicationShell } from "@/components/layout/application-shell"
import { ApprovalsProvider } from "@/features/approvals/components/approvals-provider"
import { AssistantProvider } from "@/features/assistant/components/assistant-provider"
import { MarketIntelligenceProvider } from "@/features/market-intelligence/components/market-intelligence-provider"

export default function PlatformLayout({ children }: { children: ReactNode }) {
  return (
    <AssistantProvider>
      <ApprovalsProvider>
        <MarketIntelligenceProvider>
          <ApplicationShell>{children}</ApplicationShell>
        </MarketIntelligenceProvider>
      </ApprovalsProvider>
    </AssistantProvider>
  )
}
