import { FinancialEvidenceReport } from './financial-evidence.types.js';

export interface GetFinancialEvidenceParams {
  date: string;
}

/**
 * Neutral financial evidence boundary. A future GeFinanceApiProvider can
 * implement this contract without changing consumers in the finance domain.
 */
export interface FinancialEvidenceProvider {
  getFinancialEvidence(
    params: GetFinancialEvidenceParams,
  ): Promise<FinancialEvidenceReport>;
}
