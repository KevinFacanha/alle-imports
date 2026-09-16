export type ChatRole = "ai" | "user"

export interface ChatMessage {
  role: ChatRole
  text: string
}
