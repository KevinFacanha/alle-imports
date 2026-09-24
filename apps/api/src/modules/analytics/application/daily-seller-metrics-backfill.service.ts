import { Inject, Injectable } from '@nestjs/common';

import { summarizeFinancialEvidence } from '../../finance/application/financial-evidence-summary.js';
import { FinancialEvidenceProvider } from '../../finance/domain/financial-evidence.provider.js';
import { GeFinanceReportDayInspection } from '../../integrations/gefinance/gefinance-report.provider.js';
import {
  GEFINANCE_PROVIDER_FACTORY,
  GeFinanceProviderFactory,
  SellerMetricsReconciliationService,
} from './seller-metrics-reconciliation.service.js';
import {
  DailySellerMetricsPersistenceService,
  DailySellerMetricsPersistenceSummary,
  GeFinanceDailyHashBackfillSummary,
} from './daily-seller-metrics-persistence.service.js';
import { SellerBiMetricResolver } from './seller-bi-metric.resolver.js';

export interface DailySellerMetricsBackfillParams {
  marketplaceAccountId: string;
  olistAccountId: string;
  geFinanceReportPath: string;
  geFinanceReportSha256: string;
  from: string;
  to: string;
  geFinanceDays?: readonly GeFinanceReportDayInspection[];
  geFinanceProvider?: FinancialEvidenceProvider;
  onProgress?: (progress: DailySellerMetricsBackfillProgress) => void;
  plan?: DailySellerMetricsBackfillPlan;
  includeToday?: boolean;
  currentDate?: string;
}

export type DailySellerMetricsBackfillAction =
  | 'SKIPPED'
  | 'GEFINANCE_LOCAL_REFRESH'
  | 'FULL_EXTERNAL_PROCESS'
  | 'CURRENT_DAY_IGNORED';

export interface DailySellerMetricsBackfillPlan {
  daysFound: number;
  skipped: number;
  localRefreshDays: number;
  externalProcessingDays: number;
  currentDayIgnored: number;
  days: ReadonlyArray<{
    date: string;
    sha256: string | null;
    action: DailySellerMetricsBackfillAction;
  }>;
}

export type DailySellerMetricsBackfillProgress =
  | {
      index: number;
      total: number;
      date: string;
      state: 'PROCESSING';
      processing: 'LOCAL' | 'EXTERNAL';
    }
  | {
      index: number;
      total: number;
      date: string;
      state: 'COMPLETED';
      action: DailySellerMetricsBackfillDayResult['action'];
    };

export interface DailySellerMetricsBackfillDayResult {
  date: string;
  status: 'SUCCEEDED' | 'FAILED' | 'SKIPPED';
  action:
    | 'CREATED'
    | 'UPDATED'
    | 'FAILED'
    | 'SKIPPED'
    | 'CURRENT_DAY_IGNORED';
  reason: string | null;
}

export interface DailySellerMetricsBackfillSummary {
  from: string;
  to: string;
  daysFound: number;
  daysProcessed: number;
  localRefreshDays: number;
  externalProcessingDays: number;
  currentDayIgnored: number;
  created: number;
  updated: number;
  failed: number;
  elapsedMs: number;
  skipped: number;
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

  async backfillGeFinanceDailyHashes(params: {
    marketplaceAccountId: string;
    from: string;
    to: string;
    days: readonly GeFinanceReportDayInspection[];
  }): Promise<GeFinanceDailyHashBackfillSummary> {
    return this.persistence.backfillGeFinanceDailyHashes({
      marketplaceAccountId: params.marketplaceAccountId,
      from: params.from,
      to: params.to,
      days: params.days.map(({ businessDate, sha256 }) => ({
        businessDate,
        sha256,
      })),
    });
  }

  async execute(
    params: DailySellerMetricsBackfillParams,
  ): Promise<DailySellerMetricsBackfillSummary> {
    validateParams(params);
    const startedAt = Date.now();
    const days: DailySellerMetricsBackfillDayResult[] = [];
    const snapshots: DailySellerMetricsPersistenceSummary[] = [];
    const executionPlan = params.plan ?? (await this.preflight(params));
    const plannedDays = executionPlan.days;
    const geFinanceProcessingDays =
      executionPlan.localRefreshDays + executionPlan.externalProcessingDays;
    const geFinanceProvider =
      geFinanceProcessingDays === 0
        ? undefined
        : params.geFinanceProvider ??
          (this.geFinanceProviderFactory(
            params.geFinanceReportPath,
          ) as FinancialEvidenceProvider);

    // External days remain sequential. Local days use only the already loaded
    // XLSX and one short atomic persistence transaction per snapshot.
    for (const [offset, plannedDay] of plannedDays.entries()) {
      const { date, sha256, action } = plannedDay;
      const index = offset + 1;
      if (action === 'SKIPPED' || action === 'CURRENT_DAY_IGNORED') {
        const resultAction =
          action === 'SKIPPED' ? 'SKIPPED' : 'CURRENT_DAY_IGNORED';
        days.push({
          date,
          status: 'SKIPPED',
          action: resultAction,
          reason: null,
        });
        params.onProgress?.({
          index,
          total: plannedDays.length,
          date,
          state: 'COMPLETED',
          action: resultAction,
        });
        continue;
      }

      params.onProgress?.({
        index,
        total: plannedDays.length,
        date,
        state: 'PROCESSING',
        processing:
          action === 'GEFINANCE_LOCAL_REFRESH' ? 'LOCAL' : 'EXTERNAL',
      });
      try {
        let snapshot: DailySellerMetricsPersistenceSummary;
        if (action === 'GEFINANCE_LOCAL_REFRESH') {
          const unfiltered = await geFinanceProvider!.getFinancialEvidence({
            date,
          });
          const financial = {
            ...unfiltered,
            records: unfiltered.records.filter((record) =>
              SUPPORTED_ACCOUNT_CHANNELS.has(record.channel.normalized),
            ),
          };
          const fullFinancial = {
            ...financial,
            records: financial.records.filter((record) =>
              FULL_CHANNELS.has(record.channel.normalized),
            ),
          };
          const summary = summarizeFinancialEvidence(financial);
          const fullSummary = summarizeFinancialEvidence(fullFinancial);
          snapshot = await this.persistence.refreshGeFinanceMetrics({
            marketplaceAccountId: params.marketplaceAccountId,
            businessDate: date,
            geFinanceReportSha256: params.geFinanceReportSha256,
            geFinanceDailySha256: sha256!,
            marginRate: summary.aggregateMargin.rate,
            marginAmount: summary.aggregateMargin.amount,
            marginBaseAmount: summary.aggregateMargin.baseAmount,
            fullGrossSalesEvidenceAmount:
              fullSummary.totals.totalProductsSoldAmount,
          });
        } else {
          const reconciliation = await this.reconciliation.reconcile({
            marketplaceAccountId: params.marketplaceAccountId,
            olistAccountId: params.olistAccountId,
            geFinanceReportPath: params.geFinanceReportPath,
            geFinanceProvider: geFinanceProvider!,
            date,
          });
          const resolved = this.resolver.resolve(reconciliation);
          snapshot = await this.persistence.persist(resolved, {
            marketplaceAccountId: params.marketplaceAccountId,
            geFinanceReportSha256: params.geFinanceReportSha256,
            geFinanceDailySha256: sha256,
            geFinanceMarginAmount:
              reconciliation.geFinanceMargin.generalAmount,
            geFinanceMarginBaseAmount:
              reconciliation.geFinanceMargin.generalBaseAmount,
          });
        }
        snapshots.push(snapshot);
        days.push({
          date,
          status: 'SUCCEEDED',
          action: snapshot.action,
          reason: null,
        });
        params.onProgress?.({
          index,
          total: plannedDays.length,
          date,
          state: 'COMPLETED',
          action: snapshot.action,
        });
      } catch (error: unknown) {
        days.push({
          date,
          status: 'FAILED',
          action: 'FAILED',
          reason: safeFailureReason(error),
        });
        params.onProgress?.({
          index,
          total: plannedDays.length,
          date,
          state: 'COMPLETED',
          action: 'FAILED',
        });
      }
    }

    return {
      from: params.from,
      to: params.to,
      daysFound: plannedDays.length,
      daysProcessed: geFinanceProcessingDays,
      localRefreshDays: executionPlan.localRefreshDays,
      externalProcessingDays: executionPlan.externalProcessingDays,
      currentDayIgnored: executionPlan.currentDayIgnored,
      created: days.filter(({ action }) => action === 'CREATED').length,
      updated: days.filter(({ action }) => action === 'UPDATED').length,
      failed: days.filter(({ action }) => action === 'FAILED').length,
      elapsedMs: Date.now() - startedAt,
      skipped: days.filter(({ action }) => action === 'SKIPPED').length,
      days,
      snapshots,
    };
  }

  async preflight(
    params: Pick<
      DailySellerMetricsBackfillParams,
      | 'marketplaceAccountId'
      | 'from'
      | 'to'
      | 'geFinanceDays'
      | 'includeToday'
      | 'currentDate'
    >,
  ): Promise<DailySellerMetricsBackfillPlan> {
    const reportDays = reportDaysFor(params);
    const today = params.currentDate ?? saoPauloBusinessDate();
    parseCalendarDate(today, 'businessDate');

    // One local range query supplies every daily decision before any external
    // provider is created or called.
    const existingSnapshots = await this.persistence.findExistingSnapshots({
      marketplaceAccountId: params.marketplaceAccountId,
      from: params.from,
      to: params.to,
    });
    const plannedDays = reportDays.map(({ businessDate: date, sha256 }) => {
      const existing = existingSnapshots.get(date);
      let action: DailySellerMetricsBackfillAction;
      if (!params.includeToday && date >= today) {
        action = 'CURRENT_DAY_IGNORED';
      } else if (existing === undefined) {
        action = 'FULL_EXTERNAL_PROCESS';
      } else if (existing.geFinanceDailySha256 === null) {
        action = 'GEFINANCE_LOCAL_REFRESH';
      } else if (sha256 !== null && existing.geFinanceDailySha256 === sha256) {
        action = 'SKIPPED';
      } else {
        action = 'GEFINANCE_LOCAL_REFRESH';
      }
      return { date, sha256, action, legacy: existing !== undefined && existing.geFinanceDailySha256 === null };
    });
    const legacyDates = plannedDays
      .filter(
        ({ legacy, action }) =>
          legacy && action !== 'CURRENT_DAY_IGNORED',
      )
      .map(({ date }) => date);
    if (legacyDates.length > 0) {
      throw new DailySellerMetricsBackfillError(
        `Found ${legacyDates.length} legacy snapshot(s) without a daily hash. Run backfill:gefinance:daily-hashes before import:gefinance.`,
      );
    }

    const days = plannedDays.map(({ date, sha256, action }) => ({
      date,
      sha256,
      action,
    }));
    return {
      daysFound: days.length,
      skipped: days.filter(({ action }) => action === 'SKIPPED').length,
      localRefreshDays: days.filter(
        ({ action }) => action === 'GEFINANCE_LOCAL_REFRESH',
      ).length,
      externalProcessingDays: days.filter(
        ({ action }) => action === 'FULL_EXTERNAL_PROCESS',
      ).length,
      currentDayIgnored: days.filter(
        ({ action }) => action === 'CURRENT_DAY_IGNORED',
      ).length,
      days,
    };
  }

}

const SUPPORTED_ACCOUNT_CHANNELS = new Set([
  'MERCADO_LIVRE_ACCOUNT_1',
  'MERCADO_LIVRE_ACCOUNT_2',
  'MERCADO_LIVRE_FULFILLMENT_C1',
  'MERCADO_LIVRE_FULFILLMENT_C2',
]);
const FULL_CHANNELS = new Set([
  'MERCADO_LIVRE_FULFILLMENT_C1',
  'MERCADO_LIVRE_FULFILLMENT_C2',
]);

export function saoPauloBusinessDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
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

function reportDaysFor(
  params: Pick<
    DailySellerMetricsBackfillParams,
    'from' | 'to' | 'geFinanceDays'
  >,
): Array<{ businessDate: string; sha256: string | null }> {
  if (!params.geFinanceDays) {
    return calendarDateRange(params.from, params.to).map((businessDate) => ({
      businessDate,
      sha256: null,
    }));
  }
  if (params.geFinanceDays.length === 0) {
    throw new DailySellerMetricsBackfillError(
      'The GeFinance report must contain at least one business date.',
    );
  }

  const days = [...params.geFinanceDays].sort((left, right) =>
    left.businessDate.localeCompare(right.businessDate),
  );
  const seen = new Set<string>();
  for (const day of days) {
    parseCalendarDate(day.businessDate, 'businessDate');
    if (!/^[a-f0-9]{64}$/i.test(day.sha256)) {
      throw new DailySellerMetricsBackfillError(
        'Every GeFinance daily SHA-256 must contain 64 hexadecimal characters.',
      );
    }
    if (seen.has(day.businessDate)) {
      throw new DailySellerMetricsBackfillError(
        `Duplicate GeFinance business date: ${day.businessDate}.`,
      );
    }
    seen.add(day.businessDate);
  }
  if (
    days[0]!.businessDate !== params.from ||
    days.at(-1)!.businessDate !== params.to
  ) {
    throw new DailySellerMetricsBackfillError(
      'The GeFinance daily hashes must match the inspected report period.',
    );
  }
  return days;
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

function parseCalendarDate(
  value: string,
  field: 'from' | 'to' | 'businessDate',
): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw invalidDate(field);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw invalidDate(field);
  }
  return date;
}

function invalidDate(
  field: 'from' | 'to' | 'businessDate',
): DailySellerMetricsBackfillError {
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
