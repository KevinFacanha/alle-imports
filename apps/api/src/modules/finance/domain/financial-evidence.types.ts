import { Prisma } from '@prisma/client';

export type FinancialChannelCode =
  | 'MERCADO_LIVRE_ACCOUNT_1'
  | 'MERCADO_LIVRE_ACCOUNT_2'
  | 'MERCADO_LIVRE_FULFILLMENT_C2'
  | 'OTHER';

export interface FinancialChannelEvidence {
  /** Exact value supplied by the financial source. */
  original: string;
  /** Stable domain-facing identifier. Unknown channels remain OTHER. */
  normalized: FinancialChannelCode;
}

export interface FinancialEvidenceRecord {
  soldOn: string;
  orderReference: string;
  channel: FinancialChannelEvidence;
  status: string;
  sku?: string;
  productName?: string;
  quantity?: number;
  productSoldAmount: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  totalProductsSoldAmount: Prisma.Decimal;
  customerShippingAmount: Prisma.Decimal;
  totalSaleAmount: Prisma.Decimal;
  productCostAmount: Prisma.Decimal;
  feesAndCommissionsAmount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  netAmount: Prisma.Decimal;
  marginAmount: Prisma.Decimal;
  reportedMarginRate: Prisma.Decimal;
  /** Amount used as denominator for the source's reported margin rate. */
  marginBaseAmount: Prisma.Decimal;
  /** Financial evidence only; never replaces marketplace logistic_type. */
  isFinancialFulfillmentEvidence: boolean;
}

export interface FinancialEvidenceReport {
  source: 'GEFINANCE_REPORT' | 'GEFINANCE_API';
  date: string;
  records: FinancialEvidenceRecord[];
  marginDefinition: {
    amountColumn: string;
    baseColumn: string;
    reportedRateColumn: string;
  };
}
