import {
  SellerBiMetricConfidence,
  SellerBiMetricName,
  SellerBiMetricSource,
  SellerBiMetricStatus,
} from './seller-bi-metric.types.js';

export interface SellerBiMetricEvidencePolicy {
  source: Exclude<SellerBiMetricSource, 'DERIVED'>;
  semantic: string;
  incompatibleSemantics?: true;
}

export interface SellerBiMetricPolicyDefinition {
  primarySource: SellerBiMetricSource;
  primarySemantic: string;
  resolvedStatus: Extract<SellerBiMetricStatus, 'AVAILABLE' | 'PROVISIONAL'>;
  confidence: SellerBiMetricConfidence;
  evidence: readonly SellerBiMetricEvidencePolicy[];
  formula?: string;
  notes: readonly string[];
}

const POLICY: Readonly<
  Record<SellerBiMetricName, SellerBiMetricPolicyDefinition>
> = {
  salesCount: {
    primarySource: 'MERCADO_LIVRE',
    primarySemantic: 'COUNT(official ML orders created in the local day)',
    resolvedStatus: 'AVAILABLE',
    confidence: 'HIGH',
    evidence: [
      {
        source: 'MERCADO_LIVRE',
        semantic: 'COUNT(official ML orders created in the local day)',
      },
      {
        source: 'OLIST',
        semantic: 'COUNT(Olist orders in the Account 2 channel allowlist)',
      },
    ],
    notes: ['Olist valida a contagem e nunca substitui a fonte primária.'],
  },
  unitsSold: {
    primarySource: 'MERCADO_LIVRE',
    primarySemantic: 'SUM(ML order_items.quantity)',
    resolvedStatus: 'AVAILABLE',
    confidence: 'HIGH',
    evidence: [
      {
        source: 'MERCADO_LIVRE',
        semantic: 'SUM(ML order_items.quantity)',
      },
      {
        source: 'OLIST',
        semantic: 'Olist item.quantidade (excluded from commercial units)',
        incompatibleSemantics: true,
      },
    ],
    notes: ['Olist possui semântica incompatível e não é convertido em unidades.'],
  },
  grossSales: {
    primarySource: 'MERCADO_LIVRE',
    primarySemantic: 'SUM(ML order.total_amount), BRL',
    resolvedStatus: 'PROVISIONAL',
    confidence: 'MEDIUM',
    evidence: [
      {
        source: 'MERCADO_LIVRE',
        semantic: 'SUM(ML order.total_amount), BRL',
      },
      {
        source: 'OLIST',
        semantic: 'SUM(Olist valorTotalProdutos / totalProdutos)',
      },
    ],
    notes: [
      'Fonte primária provisória: Mercado Livre order.total_amount.',
      'Gross de itens não é usado como vendas brutas.',
    ],
  },
  marginRate: {
    primarySource: 'GEFINANCE',
    primarySemantic: 'SUM(Margem) / SUM(Total prod. vendidos)',
    resolvedStatus: 'AVAILABLE',
    confidence: 'HIGH',
    evidence: [
      {
        source: 'GEFINANCE',
        semantic: 'SUM(Margem) / SUM(Total prod. vendidos)',
      },
    ],
    formula: 'SUM(Margem) / SUM(Total prod. vendidos)',
    notes: ['Calculada por razão de somas; percentuais de linha não são promediados.'],
  },
  fullClassification: {
    primarySource: 'MERCADO_LIVRE',
    primarySemantic: 'shipment.logistic_type = fulfillment',
    resolvedStatus: 'AVAILABLE',
    confidence: 'HIGH',
    evidence: [],
    notes: ['A classificação Full é determinada exclusivamente pelo shipment oficial.'],
  },
  fullSalesCount: {
    primarySource: 'MERCADO_LIVRE',
    primarySemantic: 'COUNT(ML orders with shipment.logistic_type=fulfillment)',
    resolvedStatus: 'AVAILABLE',
    confidence: 'HIGH',
    evidence: [
      {
        source: 'MERCADO_LIVRE',
        semantic: 'COUNT(ML orders with shipment.logistic_type=fulfillment)',
      },
      {
        source: 'OLIST',
        semantic: 'COUNT(Olist channel Mercado Livre Fulfillment)',
      },
    ],
    notes: ['O canal Fulfillment da Olist é somente evidência de validação.'],
  },
  fullUnitsSold: {
    primarySource: 'MERCADO_LIVRE',
    primarySemantic: 'SUM(ML order_items.quantity) for fulfillment shipments',
    resolvedStatus: 'AVAILABLE',
    confidence: 'HIGH',
    evidence: [
      {
        source: 'MERCADO_LIVRE',
        semantic: 'SUM(ML order_items.quantity) for fulfillment shipments',
      },
      {
        source: 'OLIST',
        semantic: 'Olist item.quantidade (excluded from commercial units)',
        incompatibleSemantics: true,
      },
    ],
    notes: ['Olist possui semântica incompatível e não é convertido em unidades Full.'],
  },
  fullGrossSales: {
    primarySource: 'OLIST',
    primarySemantic: 'SUM(Olist totalProdutos), channel Mercado Livre Fulfillment',
    resolvedStatus: 'PROVISIONAL',
    confidence: 'MEDIUM',
    evidence: [
      {
        source: 'OLIST',
        semantic: 'SUM(Olist totalProdutos), channel Mercado Livre Fulfillment',
      },
      {
        source: 'MERCADO_LIVRE',
        semantic: 'SUM(ML order.total_amount) for fulfillment shipments, BRL',
      },
      {
        source: 'GEFINANCE',
        semantic:
          'SUM(GeFinance Total prod. vendidos), channel Mercado Livre Fulfillment C2',
      },
    ],
    notes: [
      'Fonte primária provisória: Olist totalProdutos do canal Fulfillment.',
      'Mercado Livre e GeFinance são somente fontes de validação.',
    ],
  },
  visits: {
    primarySource: 'MERCADO_LIVRE',
    primarySemantic: 'ML official user visits for the requested day',
    resolvedStatus: 'AVAILABLE',
    confidence: 'HIGH',
    evidence: [
      {
        source: 'MERCADO_LIVRE',
        semantic: 'ML official user visits for the requested day',
      },
    ],
    notes: ['HTTP 401/403 permanece indisponível como ACCESS_DENIED.'],
  },
  averageTicket: {
    primarySource: 'DERIVED',
    primarySemantic: 'grossSales / salesCount',
    resolvedStatus: 'PROVISIONAL',
    confidence: 'MEDIUM',
    evidence: [],
    formula: 'grossSales / salesCount',
    notes: ['Derivada somente das métricas resolvidas; nenhuma fonte é promediada.'],
  },
  conversionRate: {
    primarySource: 'DERIVED',
    primarySemantic: 'salesCount / visits',
    resolvedStatus: 'AVAILABLE',
    confidence: 'HIGH',
    evidence: [],
    formula: 'salesCount / visits',
    notes: ['Sem visitas disponíveis, a conversão permanece indisponível.'],
  },
};

export class SellerBiMetricSourcePolicy {
  get(metric: SellerBiMetricName): SellerBiMetricPolicyDefinition {
    return POLICY[metric];
  }

  entries(): ReadonlyArray<
    readonly [SellerBiMetricName, SellerBiMetricPolicyDefinition]
  > {
    return Object.entries(POLICY) as Array<
      [SellerBiMetricName, SellerBiMetricPolicyDefinition]
    >;
  }
}
