import type { Dispatch, SetStateAction } from "react"

import type { ChatMessage } from "@/types/chat-messages"

export interface AssistantProps {
  input: string
  setInput: Dispatch<SetStateAction<string>>
  messages: ChatMessage[]
  ask: (question?: string) => void
}

export type { ChatMessage } from "@/types/chat-messages"
