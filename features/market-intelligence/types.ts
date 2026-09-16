export interface MarketIntelligenceProps {
  product: string
  setProduct: (value: string) => void
}

export type {
  ListingHealthMetric,
  MarketAdvantage,
  MarketCompetitor,
  MarketSummaryMetric,
} from "@/types/market-intelligence"
