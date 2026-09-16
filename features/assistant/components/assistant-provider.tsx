"use client"

import { createContext, useContext, useState, type ReactNode } from "react"

import type { AssistantProps } from "@/features/assistant/types"
import { initialChatMessages, mockAssistantResponse } from "@/mocks/chat-messages"
import type { ChatMessage } from "@/types/chat-messages"

const AssistantContext = createContext<AssistantProps | null>(null)

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [input, setInput] = useState("")
  const [messages, setMessages] = useState<ChatMessage[]>(initialChatMessages)

  const ask = (question = input) => {
    if (!question.trim()) return

    setMessages((items) => [
      ...items,
      { role: "user", text: question },
      { role: "ai", text: mockAssistantResponse },
    ])
    setInput("")
  }

  return (
    <AssistantContext.Provider value={{ input, setInput, messages, ask }}>
      {children}
    </AssistantContext.Provider>
  )
}

export function useAssistant() {
  const context = useContext(AssistantContext)

  if (!context) {
    throw new Error("useAssistant must be used within an AssistantProvider")
  }

  return context
}
