import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MarketplaceOrderStatus,
  Prisma,
} from '@prisma/client';

import { EnvironmentVariables } from '../../../config/environment.validation.js';
import { DatabaseService } from '../../../database/database.service.js';
import {
  NoSaleListingStatusFilter,
  NoSaleListingsAccount,
  NoSaleListingsQueryDto,
} from '../http/no-sale-listings-query.dto.js';
import { businessDateDifference } from './product-sales-abc.service.js';

const ACCOUNTS = ['C1', 'C2'] as const;
/**
 * An effective sale has progressed beyond payment/purchase confirmation and has
 * not been fully cancelled or refunded. This intentionally differs from the MLB
 * ABC read model, whose historical contract includes every persisted status.
 */
export const EFFECTIVE_SALE_STATUSES = Object.freeze([
  MarketplaceOrderStatus.PAID,
  MarketplaceOrderStatus.PROCESSING,
  MarketplaceOrderStatus.SHIPPED,
  MarketplaceOrderStatus.DELIVERED,
  MarketplaceOrderStatus.PARTIALLY_REFUNDED,
]);

export type NoSaleOperationalStatus =
  | 'NO_SALE_30D'
  | 'NO_SALE_60D'
  | 'NO_SALE_90D'
  | 'NO_SALE_IN_AVAILABLE_HISTORY';

export interface NoSaleListingSource {
  externalListingId: string;
  title: string | null;
  status: string | null;
  createdAt: Date;
  marketplaceAccount: {
    businessAccount: { code: string } | null;
  };
}

export interface NoSaleOrderItemSource {
  externalListingId: string;
  quantity: number;
  grossAmount: { toString(): string };
  marketplaceOrder: {
    id: string;
    normalizedStatus: MarketplaceOrderStatus;
    soldAt: Date;
    marketplaceAccount: {
      businessAccount: { code: string } | null;
    };
  };
}

export interface AccountHistoryCoverage {
  account: string;
  from: Date;
  through: Date;
}

export interface NoSaleListingItem {
  mlb: string;
  title: string | null;
  account: string;
  listingStatus: string;
  listingCreatedAt: null;
  listingFirstSeenAt: string;
  listingAgeDays: number;
  lastSaleAt: string | null;
  daysSinceLastSale: number | null;
  observedNoSaleDays: number;
  salesCount30d: number;
  unitsSold30d: number;
  grossRevenue30d: string;
  abcClass30d: null;
  abcMovement30d: null;
  operationalStatus: NoSaleOperationalStatus;
}

export interface NoSaleListingsResponse {
  metadata: {
    generatedAt: string;
    timezone: string;
    dataThrough: string | null;
    historyThrough: string | null;
    isDataCurrent: boolean;
    staleDays: number | null;
    thresholdDays: 30 | 60 | 90;
    account: NoSaleListingsAccount;
    listingStatus: NoSaleListingStatusFilter;
    activeOnlyByDefault: true;
    identity: 'BUSINESS_ACCOUNT_AND_EXTERNAL_LISTING_ID';
    listingAgeSource: 'EARLIEST_LOCAL_EVIDENCE';
    saleDefinition: {
      includedStatuses: MarketplaceOrderStatus[];
      excludedStatuses: MarketplaceOrderStatus[];
      description: string;
    };
    history: Array<{
      account: string;
      availableFrom: string | null;
      availableThrough: string | null;
      availableDays: number;
      currentThroughBusinessDay: boolean;
    }>;
  };
  summary: {
    noSale30d: number;
    noSale60d: number;
    noSale90d: number;
    potentialRevenueAtRisk: null;
    potentialRevenueAtRiskReason: string;
  };
  total: number;
  listings: NoSaleListingItem[];
}

interface BuildNoSaleListingsInput {
  now: Date;
  timezone: string;
  thresholdDays: 30 | 60 | 90;
  account: NoSaleListingsAccount;
  listingStatus: NoSaleListingStatusFilter;
  listings: NoSaleListingSource[];
  orderItems: NoSaleOrderItemSource[];
  coverage: AccountHistoryCoverage[];
}

interface NoSaleListingDatabaseRow {
  account: string;
  historyFrom: Date;
  historyThrough: Date;
  externalListingId: string | null;
  title: string | null;
  listingStatus: string | null;
  localCreatedAt: Date | null;
  earliestOrderAt: Date | null;
  lastEffectiveSaleAt: Date | null;
}

@Injectable()
export class NoSaleListingsService {
  private readonly timezone: string;

  constructor(
    private readonly database: DatabaseService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.timezone = config.get('BUSINESS_TIMEZONE', { infer: true });
  }

  async find(query: NoSaleListingsQueryDto): Promise<NoSaleListingsResponse> {
    const now = new Date();
    const accountCodes =
      query.account === NoSaleListingsAccount.All
        ? [...ACCOUNTS]
        : [query.account];
    const search = query.search?.trim();
    const rows = await this.database.$queryRaw<NoSaleListingDatabaseRow[]>(
      Prisma.sql`
        WITH coverage AS (
          SELECT
            ba.code AS account,
            MIN(run.date_from) AS history_from,
            MAX(run.date_to) AS history_through
          FROM marketplace_order_backfill_runs run
          INNER JOIN marketplace_accounts ma
            ON ma.id = run.marketplace_account_id
          INNER JOIN business_accounts ba
            ON ba.id = ma.business_account_id
          WHERE run.status = 'COMPLETED'
            AND ma.marketplace = 'MERCADO_LIVRE'
            AND ba.code IN (${Prisma.join(accountCodes)})
          GROUP BY ba.code
        )
        SELECT
          coverage.account,
          coverage.history_from AS "historyFrom",
          coverage.history_through AS "historyThrough",
          candidate.external_listing_id AS "externalListingId",
          candidate.title,
          candidate.listing_status AS "listingStatus",
          candidate.local_created_at AS "localCreatedAt",
          candidate.earliest_order_at AS "earliestOrderAt",
          candidate.last_effective_sale_at AS "lastEffectiveSaleAt"
        FROM coverage
        LEFT JOIN LATERAL (
          SELECT
            listing.external_listing_id,
            listing.title,
            listing.status AS listing_status,
            listing.created_at AS local_created_at,
            MIN(marketplace_order.sold_at) AS earliest_order_at,
            MAX(marketplace_order.sold_at) FILTER (
              WHERE marketplace_order.normalized_status::text IN (
                ${Prisma.join(EFFECTIVE_SALE_STATUSES)}
              )
            ) AS last_effective_sale_at
          FROM marketplace_listings listing
          INNER JOIN marketplace_accounts listing_account
            ON listing_account.id = listing.marketplace_account_id
          INNER JOIN business_accounts listing_business
            ON listing_business.id = listing_account.business_account_id
          LEFT JOIN marketplace_order_items order_item
            ON order_item.external_listing_id = listing.external_listing_id
          LEFT JOIN marketplace_orders marketplace_order
            ON marketplace_order.id = order_item.marketplace_order_id
            AND marketplace_order.marketplace_account_id = listing_account.id
            AND marketplace_order.sold_at >= coverage.history_from
            AND marketplace_order.sold_at <= coverage.history_through
          WHERE listing_account.marketplace = 'MERCADO_LIVRE'
            AND listing_business.code = coverage.account
            AND ${listingStatusSql(query.listingStatus)}
            AND ${search
              ? Prisma.sql`(
                  listing.external_listing_id ILIKE ${`%${search}%`}
                  OR listing.title ILIKE ${`%${search}%`}
                )`
              : Prisma.sql`TRUE`}
          GROUP BY
            listing.external_listing_id,
            listing.title,
            listing.status,
            listing.created_at
        ) candidate ON TRUE
      `,
    );
    const coverage = rows
      .filter(
        (row, index, all) =>
          all.findIndex(({ account }) => account === row.account) === index,
      )
      .map((row) => ({
        account: row.account,
        from: row.historyFrom,
        through: row.historyThrough,
      }));
    const listingRows = rows.filter(
      (row): row is NoSaleListingDatabaseRow & {
        externalListingId: string;
        localCreatedAt: Date;
      } => row.externalListingId !== null && row.localCreatedAt !== null,
    );
    const listings: NoSaleListingSource[] = listingRows.map((row) => ({
      externalListingId: row.externalListingId,
      title: row.title,
      status: row.listingStatus,
      createdAt:
        row.earliestOrderAt && row.earliestOrderAt < row.localCreatedAt
          ? row.earliestOrderAt
          : row.localCreatedAt,
      marketplaceAccount: {
        businessAccount: { code: row.account },
      },
    }));
    const relevantOrderItems: NoSaleOrderItemSource[] = listingRows.flatMap(
      (row) =>
        row.lastEffectiveSaleAt
          ? [
              {
                externalListingId: row.externalListingId,
                quantity: 0,
                grossAmount: new Prisma.Decimal(0),
                marketplaceOrder: {
                  id: `${row.account}:${row.externalListingId}:last-effective`,
                  normalizedStatus: MarketplaceOrderStatus.PAID,
                  soldAt: row.lastEffectiveSaleAt,
                  marketplaceAccount: {
                    businessAccount: { code: row.account },
                  },
                },
              },
            ]
          : [],
    );
    return buildNoSaleListings({
      now,
      timezone: this.timezone,
      thresholdDays: query.days,
      account: query.account,
      listingStatus: query.listingStatus,
      listings,
      orderItems: relevantOrderItems,
      coverage,
    });
  }
}

export function buildNoSaleListings(
  input: BuildNoSaleListingsInput,
): NoSaleListingsResponse {
  const effectiveStatuses = new Set<MarketplaceOrderStatus>(
    EFFECTIVE_SALE_STATUSES,
  );
  const salesByListing = new Map<string, NoSaleOrderItemSource[]>();
  const earliestEvidenceByListing = new Map<string, Date>();
  for (const item of input.orderItems) {
    const account = item.marketplaceOrder.marketplaceAccount.businessAccount?.code;
    if (!account) continue;
    const key = listingKey(account, item.externalListingId);
    const earliest = earliestEvidenceByListing.get(key);
    if (!earliest || item.marketplaceOrder.soldAt < earliest) {
      earliestEvidenceByListing.set(key, item.marketplaceOrder.soldAt);
    }
    if (!effectiveStatuses.has(item.marketplaceOrder.normalizedStatus)) continue;
    const current = salesByListing.get(key) ?? [];
    current.push(item);
    salesByListing.set(key, current);
  }
  const coverageByAccount = new Map(
    input.coverage.map((item) => [item.account, item]),
  );
  const evaluated = input.listings.flatMap((listing) => {
    const account = listing.marketplaceAccount.businessAccount?.code;
    if (
      !account ||
      (input.account !== NoSaleListingsAccount.All && account !== input.account) ||
      !matchesListingStatus(listing.status, input.listingStatus)
    ) {
      return [];
    }
    const key = listingKey(account, listing.externalListingId);
    const coverage = coverageByAccount.get(account);
    const earliestOrderEvidence = earliestEvidenceByListing.get(key);
    const listingFirstSeenAt =
      earliestOrderEvidence && earliestOrderEvidence < listing.createdAt
        ? earliestOrderEvidence
        : listing.createdAt;
    if (!coverage) return [];
    const referenceDate = coverage.through;
    const listingAgeDays = businessDateDifference(
      listingFirstSeenAt,
      referenceDate,
      input.timezone,
    );
    const availableHistoryDays = businessDateDifference(
      coverage.from,
      coverage.through,
      input.timezone,
    );
    const observedNoSaleDays = Math.min(listingAgeDays, availableHistoryDays);
    const sales = (salesByListing.get(
      key,
    ) ?? []).filter(
      ({ marketplaceOrder }) => marketplaceOrder.soldAt <= referenceDate,
    );
    const lastSaleAt = sales.reduce<Date | null>(
      (latest, sale) =>
        latest === null || sale.marketplaceOrder.soldAt > latest
          ? sale.marketplaceOrder.soldAt
          : latest,
      null,
    );
    const daysSinceLastSale = lastSaleAt
      ? businessDateDifference(lastSaleAt, referenceDate, input.timezone)
      : null;
    const sales30d = sales.filter(
      ({ marketplaceOrder }) =>
        businessDateDifference(
          marketplaceOrder.soldAt,
          referenceDate,
          input.timezone,
        ) < 30,
    );
    const orderIds30d = new Set(
      sales30d.map(({ marketplaceOrder }) => marketplaceOrder.id),
    );
    const grossRevenue30d = sales30d.reduce(
      (total, item) => total.plus(item.grossAmount.toString()),
      new Prisma.Decimal(0),
    );
    return [
      {
        source: listing,
        availableHistoryDays,
        listingFirstSeenAt,
        listingAgeDays,
        lastSaleAt,
        daysSinceLastSale,
        observedNoSaleDays,
        salesCount30d: orderIds30d.size,
        unitsSold30d: sales30d.reduce(
          (total, item) => total + item.quantity,
          0,
        ),
        grossRevenue30d: grossRevenue30d.toDecimalPlaces(2).toFixed(2),
      },
    ];
  });

  const qualifies = (item: (typeof evaluated)[number], days: number) =>
    item.listingAgeDays >= days &&
    item.availableHistoryDays >= days &&
    (item.daysSinceLastSale === null || item.daysSinceLastSale >= days);
  const candidates30d = evaluated.filter((item) => qualifies(item, 30));
  const selected = candidates30d
    .filter((item) => qualifies(item, input.thresholdDays))
    .map((item): NoSaleListingItem => ({
      mlb: item.source.externalListingId,
      title: item.source.title,
      account:
        item.source.marketplaceAccount.businessAccount?.code ?? 'UNKNOWN',
      listingStatus: (item.source.status ?? 'unknown').toUpperCase(),
      listingCreatedAt: null,
      listingFirstSeenAt: item.listingFirstSeenAt.toISOString(),
      listingAgeDays: item.listingAgeDays,
      lastSaleAt: item.lastSaleAt?.toISOString() ?? null,
      daysSinceLastSale: item.daysSinceLastSale,
      observedNoSaleDays: item.observedNoSaleDays,
      salesCount30d: item.salesCount30d,
      unitsSold30d: item.unitsSold30d,
      grossRevenue30d: item.grossRevenue30d,
      abcClass30d: null,
      abcMovement30d: null,
      operationalStatus: operationalStatus(item.daysSinceLastSale),
    }))
    .sort(
      (left, right) =>
        sortDays(right) - sortDays(left) ||
        left.account.localeCompare(right.account) ||
        left.mlb.localeCompare(right.mlb),
    );

  const coveredAccounts =
    input.account === NoSaleListingsAccount.All
      ? [...ACCOUNTS]
      : [input.account];
  const selectedCoverage = coveredAccounts
    .map((account) => coverageByAccount.get(account))
    .filter((item): item is AccountHistoryCoverage => item !== undefined);
  const dataThrough = selectedCoverage.length === coveredAccounts.length
    ? selectedCoverage.reduce((earliest, item) =>
        item.through < earliest.through ? item : earliest,
      ).through
    : null;
  const staleDays = dataThrough
    ? businessDateDifference(dataThrough, input.now, input.timezone)
    : null;
  return {
    metadata: {
      generatedAt: input.now.toISOString(),
      timezone: input.timezone,
      dataThrough: dataThrough?.toISOString() ?? null,
      historyThrough: dataThrough?.toISOString() ?? null,
      isDataCurrent: staleDays === 0,
      staleDays,
      thresholdDays: input.thresholdDays,
      account: input.account,
      listingStatus: input.listingStatus,
      activeOnlyByDefault: true,
      identity: 'BUSINESS_ACCOUNT_AND_EXTERNAL_LISTING_ID',
      listingAgeSource: 'EARLIEST_LOCAL_EVIDENCE',
      saleDefinition: {
        includedStatuses: [...EFFECTIVE_SALE_STATUSES],
        excludedStatuses: Object.values(MarketplaceOrderStatus).filter(
          (status) => !effectiveStatuses.has(status),
        ),
        description:
          'Venda efetiva confirmada/paga e não integralmente cancelada ou reembolsada.',
      },
      history: coveredAccounts.map((account) => {
        const item = coverageByAccount.get(account);
        return {
          account,
          availableFrom: item?.from.toISOString() ?? null,
          availableThrough: item?.through.toISOString() ?? null,
          availableDays: item
            ? businessDateDifference(item.from, item.through, input.timezone)
            : 0,
          currentThroughBusinessDay: item
            ? businessDateDifference(item.through, input.now, input.timezone) === 0
            : false,
        };
      }),
    },
    summary: {
      noSale30d: candidates30d.length,
      noSale60d: evaluated.filter((item) => qualifies(item, 60)).length,
      noSale90d: evaluated.filter((item) => qualifies(item, 90)).length,
      potentialRevenueAtRisk: null,
      potentialRevenueAtRiskReason:
        'Sem base confiável aprovada para estimar faturamento potencial.',
    },
    total: selected.length,
    listings: selected,
  };
}

function listingStatusSql(
  status: NoSaleListingStatusFilter,
): Prisma.Sql {
  if (status === NoSaleListingStatusFilter.All) return Prisma.sql`TRUE`;
  if (status === NoSaleListingStatusFilter.Inactive) {
    return Prisma.sql`(
      listing.status IS NULL OR listing.status NOT IN ('active', 'paused')
    )`;
  }
  return Prisma.sql`listing.status = ${status.toLowerCase()}`;
}

function matchesListingStatus(
  value: string | null,
  filter: NoSaleListingStatusFilter,
): boolean {
  if (filter === NoSaleListingStatusFilter.All) return true;
  const status = value?.toLowerCase() ?? 'unknown';
  if (filter === NoSaleListingStatusFilter.Inactive) {
    return status !== 'active' && status !== 'paused';
  }
  return status === filter.toLowerCase();
}

function operationalStatus(
  daysSinceLastSale: number | null,
): NoSaleOperationalStatus {
  if (daysSinceLastSale === null) return 'NO_SALE_IN_AVAILABLE_HISTORY';
  if (daysSinceLastSale >= 90) return 'NO_SALE_90D';
  if (daysSinceLastSale >= 60) return 'NO_SALE_60D';
  return 'NO_SALE_30D';
}

function sortDays(item: NoSaleListingItem): number {
  return item.daysSinceLastSale ?? item.observedNoSaleDays;
}

function listingKey(account: string, mlb: string): string {
  return `${account}\u0000${mlb}`;
}
