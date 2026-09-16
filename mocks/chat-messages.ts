import type { ChatMessage } from "@/types/chat-messages"

export const initialChatMessages: ChatMessage[] = [
  { role: "ai", text: "Bom dia, o que deseja analisar hoje?" },
]

export const assistantSuggestions = [
  "Como foram as vendas ontem?",
  "Gere a Curva ABC da semana.",
  "Quais produtos estão sem giro?",
  "Melhores candidatos para Oferta Relâmpago?",
  "Como está a reputação Flex e Coleta?",
  "Quais pedidos precisam de atenção?",
]

export const mockAssistantResponse =
  "Analisei seus dados dos últimos 30 dias. As vendas cresceram 18,4% na semana, puxadas pelo Mercado Livre. Encontrei 8 produtos sem giro e 3 oportunidades de Oferta Relâmpago. Quer que eu aprofunde algum desses pontos?"
