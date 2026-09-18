/**
 * Referência manual da planilha de BI da Gabi.
 *
 * Estes valores seguem a semântica do painel Métricas (Seller Metrics). Eles
 * não são metas para agregados calculados a partir de MarketplaceOrder ou de
 * shipments e, portanto, não devem ser comparados diretamente com eles.
 */
export interface MercadoLivreMetricsManualReference {
  source: 'MANUAL_GABI_BI';
  semantics: 'SELLER_METRICS';
  date: string;
  marketplace: 'MERCADO LIVRE';
  grossRevenueDay: string;
  salesQuantity: number;
  unitsSold: number;
  fullGrossSales: string;
  fullUnitsSold: number;
  fullSalesQuantity: number;
  averageTicket: string;
  contributionMarginPercent: string;
  definitions: {
    fullGrossSales: 'Vendas brutas com filtro Mercado Envios Full';
    fullUnitsSold: 'Unidades vendidas com filtro Mercado Envios Full';
    fullSalesQuantity: 'Quantidade de vendas com filtro Mercado Envios Full';
  };
}

const REFERENCES: Readonly<
  Record<string, MercadoLivreMetricsManualReference>
> = {
  '2026-09-16': {
    source: 'MANUAL_GABI_BI',
    semantics: 'SELLER_METRICS',
    date: '2026-09-16',
    marketplace: 'MERCADO LIVRE',
    grossRevenueDay: '10882.00',
    salesQuantity: 118,
    unitsSold: 130,
    fullGrossSales: '590.00',
    fullUnitsSold: 14,
    fullSalesQuantity: 9,
    averageTicket: '92.22',
    contributionMarginPercent: '25.68',
    definitions: {
      fullGrossSales: 'Vendas brutas com filtro Mercado Envios Full',
      fullUnitsSold: 'Unidades vendidas com filtro Mercado Envios Full',
      fullSalesQuantity: 'Quantidade de vendas com filtro Mercado Envios Full',
    },
  },
};

export function getMercadoLivreMetricsManualReference(
  date: string,
): MercadoLivreMetricsManualReference | null {
  return REFERENCES[date] ?? null;
}
