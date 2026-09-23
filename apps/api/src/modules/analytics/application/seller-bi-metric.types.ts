export type SellerBiMetricSource =
  | 'MERCADO_LIVRE'
  | 'OLIST'
  | 'GEFINANCE'
  | 'DERIVED';

export type SellerBiMetricStatus =
  | 'AVAILABLE'
  | 'UNAVAILABLE'
  | 'INCOMPATIBLE_SEMANTICS'
  | 'PROVISIONAL';

export type SellerBiMetricConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export type SellerBiMetricName =
  | 'salesCount'
  | 'unitsSold'
  | 'grossSales'
  | 'marginRate'
  | 'fullClassification'
  | 'fullSalesCount'
  | 'fullUnitsSold'
  | 'fullGrossSales'
  | 'visits'
  | 'averageTicket'
  | 'conversionRate';

export type SellerBiMetricValue = string | number | null;

export type SellerBiMetricValidationComparison =
  | 'MATCH'
  | 'DIVERGENT'
  | 'NOT_COMPARABLE'
  | 'UNAVAILABLE'
  | 'PRIMARY';

export interface SellerBiMetricValidationEvidence {
  metric: SellerBiMetricName;
  source: Exclude<SellerBiMetricSource, 'DERIVED'>;
  value: SellerBiMetricValue;
  status: SellerBiMetricStatus;
  comparison: SellerBiMetricValidationComparison;
  semantic: string;
  absoluteDifference: string | null;
  percentageDifference: string | null;
  notes: string;
}

export interface ResolvedSellerBiMetric {
  value: SellerBiMetricValue;
  source: SellerBiMetricSource;
  status: SellerBiMetricStatus;
  confidence: SellerBiMetricConfidence;
  validationEvidence: SellerBiMetricValidationEvidence[];
  notes: string[];
}

export interface ResolvedSellerBiMetrics {
  date: string;
  timeZone: string;
  accountIsolation: {
    marketplace: 'EXACT_ID';
    olist: 'EXACT_ID';
    geFinance: 'ACCOUNT_CHANNEL_ALLOWLIST';
    excludedGeFinanceRecords: number;
  };
  metrics: Record<SellerBiMetricName, ResolvedSellerBiMetric>;
}
