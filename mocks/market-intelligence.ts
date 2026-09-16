import { BarChart3, CreditCard, Sparkles, TrendingUp } from "lucide-react"

import type {
  ListingHealthMetric,
  MarketAdvantage,
  MarketCompetitor,
  MarketSummaryMetric,
} from "@/types/market-intelligence"

export const marketProducts = [
  "Kit Organizador Multiuso",
  "Luminária LED de Mesa",
  "Garrafa Térmica 1L",
]

export const marketSummaryMetrics: MarketSummaryMetric[] = [
  { label: "Posição no ranking", value: "4º de 28", detail: "↑ 2 posições", icon: BarChart3 },
  { label: "Preço médio", value: "R$ 88,70", detail: "Você: R$ 89,90", icon: CreditCard },
  { label: "Vendas estimadas", value: "142 / mês", detail: "+18,4% potencial", icon: TrendingUp },
  { label: "Oportunidade", value: "R$ 2.840", detail: "Receita incremental", icon: Sparkles },
]

export const marketCompetitors: MarketCompetitor[] = [
  { name: "Nossa loja", price: "R$ 89,90", sales: "142", position: "4º", tone: "bg-[#eeecff] text-[#6254d9]" },
  { name: "Casa & Cia", price: "R$ 84,90", sales: "318", position: "1º", tone: "bg-emerald-50 text-emerald-700" },
  { name: "UtiliMais", price: "R$ 87,50", sales: "241", position: "2º", tone: "bg-blue-50 text-blue-700" },
  { name: "Oferta Lar", price: "R$ 92,90", sales: "189", position: "3º", tone: "bg-amber-50 text-amber-700" },
]

export const listingHealthMetrics: ListingHealthMetric[] = [
  { label: "Catálogo", value: "Compatível", colorClassName: "text-emerald-600" },
  { label: "Entrega FULL", value: "Ativo", colorClassName: "text-emerald-600" },
  { label: "Reputação", value: "4,5 / 5,0", colorClassName: "text-emerald-600" },
  { label: "Especificações", value: "3 campos faltando", colorClassName: "text-amber-600" },
]

export const marketAdvantages: MarketAdvantage[] = [
  {
    title: "Preço mais competitivo",
    detail: "Casa & Cia está 5,6% abaixo do seu preço e captura mais cliques.",
    tone: "text-rose-500",
    backgroundClassName: "bg-rose-50",
  },
  {
    title: "Full e frete grátis",
    detail: "Os dois primeiros colocados entregam no mesmo dia para 82% da base.",
    tone: "text-emerald-600",
    backgroundClassName: "bg-emerald-50",
  },
  {
    title: "Reputação superior",
    detail: "UtiliMais tem 4,8 estrelas contra 4,5 no seu anúncio atual.",
    tone: "text-[#6254d9]",
    backgroundClassName: "bg-[#eeecff]",
  },
]
