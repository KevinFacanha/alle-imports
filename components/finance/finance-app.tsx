"use client"

import { useState, type ReactNode } from "react"

import { ApplicationShell } from "@/components/layout/application-shell"
import { Alerts } from "@/features/alerts/components/alerts"
import { Approvals } from "@/features/approvals/components/approvals"
import { Assistant } from "@/features/assistant/components/assistant"
import { Dashboard } from "@/features/dashboard/components/dashboard"
import { History } from "@/features/history/components/history"
import { Integrations } from "@/features/integrations/components/integrations"
import { MarketIntelligence } from "@/features/market-intelligence/components/market-intelligence"
import { Operation } from "@/features/operation/components/operation"
import {
  ProductIntelligencePage,
  type ProductIntelligenceInitialState,
  type ProductIntelligenceSection,
} from "@/features/product-intelligence/components/product-intelligence-page"
import { initialChatMessages, mockAssistantResponse } from "@/mocks/chat-messages"
import type { ChatMessage } from "@/types/chat-messages"
import type { View } from "@/types/navigation"

export function FinanceApp({
  initialView = "assistente",
  initialProductIntelligenceSection = "attention",
  initialProductIntelligenceState,
}: {
  initialView?: View
  initialProductIntelligenceSection?: ProductIntelligenceSection
  initialProductIntelligenceState?: ProductIntelligenceInitialState
}) {
  const [view, setView] = useState<View>(initialView)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [input, setInput] = useState("")
  const [messages, setMessages] = useState<ChatMessage[]>(initialChatMessages)
  const [approved, setApproved] = useState<string[]>([])
  const [selectedMarketProduct, setSelectedMarketProduct] = useState("Kit Organizador Multiuso")

  const ask = (question = input) => {
    if (!question.trim()) return

    setMessages((items) => [
      ...items,
      { role: "user", text: question },
      { role: "ai", text: mockAssistantResponse },
    ])
    setInput("")
  }

  const navigate = (nextView: View) => {
    setView(nextView)
    setSidebarOpen(false)
  }

  const activeFeature = {
    assistente: <Assistant input={input} setInput={setInput} messages={messages} ask={ask} />,
    dashboard: <Dashboard />,
    "product-intelligence": <ProductIntelligencePage initialSection={initialProductIntelligenceSection} initialState={initialProductIntelligenceState} />,
    operacao: <Operation />,
    alertas: <Alerts />,
    aprovacoes: <Approvals approved={approved} setApproved={setApproved} />,
    historico: <History />,
    integracoes: <Integrations />,
    inteligencia: (
      <MarketIntelligence product={selectedMarketProduct} setProduct={setSelectedMarketProduct} />
    ),
  } satisfies Record<View, ReactNode>

  return (
    <ApplicationShell
      activeView={view}
      isSidebarOpen={sidebarOpen}
      onNavigate={navigate}
      onOpenSidebar={() => setSidebarOpen(true)}
    >
      {activeFeature[view]}
    </ApplicationShell>
  )
}
