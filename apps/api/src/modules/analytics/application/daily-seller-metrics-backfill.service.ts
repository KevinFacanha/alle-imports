import { Inject, Injectable } from '@nestjs/common';

import { FinancialEvidenceProvider } from '../../finance/domain/financial-evidence.provider.js';
import {
  GEFINANCE_PROVIDER_FACTORY,
  GeFinanceProviderFactory,
  SellerMetricsReconciliationService,
} from './seller-metrics-reconciliation.service.js';
import {
  DailySellerMetricsPersistenceService,
  DailySellerMetricsPersistenceSummary,
} from './daily-seller-metrics-persistence.service.js';
import { SellerBiMetricResolver } from './seller-bi-metric.resolver.js';

export interface DailySellerMetricsBackfillParams {
  marketplaceAccountId: string;
  olistAccountId: string;
  geFinanceReportPath: string;
  geFinanceReportSha256: string;
  from: string;
  to: string;
  geFinanceProvider?: FinancialEvidenceProvider;
}

export interface DailySellerMetricsBackfillDayResult {
  date: string;
  status: 'SUCCEEDED' | 'FAILED';
  action: 'CREATED' | 'UPDATED' | 'FAILED';
  reason: string | null;
}

export interface DailySellerMetricsBackfillSummary {
  from: string;
  to: string;
  daysProcessed: number;
  created: number;
  updated: number;
  failed: number;
  elapsedMs: number;
  days: DailySellerMetricsBackfillDayResult[];
  snapshots: DailySellerMetricsPersistenceSummary[];
}

export class DailySellerMetricsBackfillError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DailySellerMetricsBackfillError';
  }
}

@Injectable()
export class DailySellerMetricsBackfillService {
  constructor(
    private readonly reconciliation: SellerMetricsReconciliationService,
    private readonly resolver: SellerBiMetricResolver,
    private readonly persistence: DailySellerMetricsPersistenceService,
    @Inject(GEFINANCE_PROVIDER_FACTORY)
    private readonly geFinanceProviderFactory: GeFinanceProviderFactory,
  ) {}

  async execute(
    params: DailySellerMetricsBackfillParams,
  ): Promise<DailySellerMetricsBackfillSummary> {
    validateParams(params);
    const dates = calendarDateRange(params.from, params.to);
    const startedAt = Date.now();
    const days: DailySellerMetricsBackfillDayResult[] = [];
    const snapshots: DailySellerMetricsPersistenceSummary[] = [];
    const geFinanceProvider =
      params.geFinanceProvider ??
      (this.geFinanceProviderFactory(
        params.geFinanceReportPath,
      ) as FinancialEvidenceProvider);

    // Deliberately sequential: each local business day is an isolated unit of
    // work and completes before the next day starts.
    for (const date of dates) {
      try {
        const reconciliation = await this.reconciliation.reconcile({
          marketplaceAccountId: params.marketplaceAccountId,
          olistAccountId: params.olistAccountId,
          geFinanceReportPath: params.geFinanceReportPath,
          geFinanceProvider,
          date,
        });
        const resolved = this.resolver.resolve(reconciliation);
        const snapshot = await this.persistence.persist(resolved, {
          marketplaceAccountId: params.marketplaceAccountId,
          geFinanceReportSha256: params.geFinanceReportSha256,
        });
        snapshots.push(snapshot);
        days.push({
          date,
          status: 'SUCCEEDED',
          action: snapshot.action,
          reason: null,
        });
      } catch (error: unknown) {
        days.push({
          date,
          status: 'FAILED',
          action: 'FAILED',
          reason: safeFailureReason(error),
        });
      }
    }

    return {
      from: params.from,
      to: params.to,
      daysProcessed: days.length,
      created: days.filter(({ action }) => action === 'CREATED').length,
      updated: days.filter(({ action }) => action === 'UPDATED').length,
      failed: days.filter(({ action }) => action === 'FAILED').length,
      elapsedMs: Date.now() - startedAt,
      days,
      snapshots,
    };
  }
}

export function calendarDateRange(from: string, to: string): string[] {
  const start = parseCalendarDate(from, 'from');
  const end = parseCalendarDate(to, 'to');
  if (start.getTime() > end.getTime()) {
    throw new DailySellerMetricsBackfillError(
      'The backfill period is invalid: from must be on or before to.',
    );
  }

  const dates: string[] = [];
  for (
    let instant = start.getTime();
    instant <= end.getTime();
    instant += 24 * 60 * 60 * 1000
  ) {
    dates.push(new Date(instant).toISOString().slice(0, 10));
  }
  return dates;
}

function validateParams(params: DailySellerMetricsBackfillParams): void {
  if (!params.marketplaceAccountId || !params.olistAccountId) {
    throw new DailySellerMetricsBackfillError(
      'Marketplace and Olist account ids are required.',
    );
  }
  if (!params.geFinanceReportPath) {
    throw new DailySellerMetricsBackfillError(
      'The GeFinance XLSX path is required.',
    );
  }
  if (!/^[a-f0-9]{64}$/i.test(params.geFinanceReportSha256)) {
    throw new DailySellerMetricsBackfillError(
      'The GeFinance report SHA-256 must contain 64 hexadecimal characters.',
    );
  }
  calendarDateRange(params.from, params.to);
}

function parseCalendarDate(value: string, field: 'from' | 'to'): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw invalidDate(field);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw invalidDate(field);
  }
  return date;
}

function invalidDate(field: 'from' | 'to'): DailySellerMetricsBackfillError {
  return new DailySellerMetricsBackfillError(
    `${field} must be a valid calendar date in YYYY-MM-DD format.`,
  );
}

function safeFailureReason(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Processing failed (UnknownError).';
  }
  const name = /^[A-Za-z][A-Za-z0-9]*$/.test(error.name)
    ? error.name
    : 'UnknownError';
  const code = errorCode(error);
  const safeMessageNames = new Set([
    'DailySellerMetricsBackfillError',
    'DailySellerMetricsPersistenceError',
    'GeFinanceReportError',
    'MarketplaceAuthorizationNotFoundError',
    'MercadoLivreClientError',
    'MercadoLivreOAuthError',
    'OlistOAuthError',
    'OlistOrdersClientError',
    'OlistOrdersInspectionError',
    'TokenEncryptionError',
  ]);
  if (!safeMessageNames.has(name)) {
    return `Processing failed (${name}${code}).`;
  }
  const message = error.message.replace(/\s+/g, ' ').trim().slice(0, 300);
  return `${name}${code}: ${message}`;
}

function errorCode(error: Error): string {
  const value = (error as Error & { code?: unknown }).code;
  return typeof value === 'string' && /^[A-Z0-9_]+$/.test(value)
    ? `/${value}`
    : '';
}
