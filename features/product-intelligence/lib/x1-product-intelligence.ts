import type {
  X1MlbPair,
  X1ProductIntelligenceResponse,
  X1Summary,
} from "../../../types/x1-product-intelligence.js"

export const X1_STALE_AFTER_MS = 10 * 60 * 1_000

export function summarizeX1(report: X1ProductIntelligenceResponse): X1Summary {
  return report.pairs.reduce<X1Summary>((summary, pair) => {
    summary.pairCount += 1
    summary.c1GrossRevenue += numberValue(pair.c1.grossRevenue)
    summary.c2GrossRevenue += numberValue(pair.c2.grossRevenue)
    summary.c1OfferUnits += pair.c1.soldOfferUnits
    summary.c2OfferUnits += pair.c2.soldOfferUnits
    summary.grossRevenueDelta = summary.c1GrossRevenue - summary.c2GrossRevenue
    return summary
  }, {
    pairCount: 0,
    c1GrossRevenue: 0,
    c2GrossRevenue: 0,
    grossRevenueDelta: 0,
    c1OfferUnits: 0,
    c2OfferUnits: 0,
  })
}

export function x1PrimaryTitle(pair: X1MlbPair): string {
  const names = [...new Set(pair.components
    .map(({ baseProduct }) => baseProduct.name.trim())
    .filter(Boolean))]
  if (names.length === 0) return "Produto sem nome"
  if (names.length === 1) return names[0]!
  return `${names[0]} (+${names.length - 1} componentes)`
}

export function isX1DataStale(
  generatedAt: string,
  nowMs = Date.now(),
  staleAfterMs = X1_STALE_AFTER_MS,
): boolean {
  const generatedAtMs = Date.parse(generatedAt)
  return Number.isNaN(generatedAtMs) || nowMs - generatedAtMs > staleAfterMs
}

function numberValue(value: string): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}
