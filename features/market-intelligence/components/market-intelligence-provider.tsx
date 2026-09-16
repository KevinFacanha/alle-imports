"use client"

import { createContext, useContext, useState, type ReactNode } from "react"

import type { MarketIntelligenceProps } from "@/features/market-intelligence/types"

const MarketIntelligenceContext = createContext<MarketIntelligenceProps | null>(null)

export function MarketIntelligenceProvider({ children }: { children: ReactNode }) {
  const [product, setProduct] = useState("Kit Organizador Multiuso")

  return (
    <MarketIntelligenceContext.Provider value={{ product, setProduct }}>
      {children}
    </MarketIntelligenceContext.Provider>
  )
}

export function useMarketIntelligence() {
  const context = useContext(MarketIntelligenceContext)

  if (!context) {
    throw new Error("useMarketIntelligence must be used within a MarketIntelligenceProvider")
  }

  return context
}
