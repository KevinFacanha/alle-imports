import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Marketplace, Prisma } from '@prisma/client';

import { EnvironmentVariables } from '../../../config/environment.validation.js';
import { DatabaseService } from '../../../database/database.service.js';
import { localDayToUtcInterval } from '../../analytics/application/daily-sales-summary.service.js';
import { getMercadoLivreMetricsManualReference } from '../../analytics/application/mercado-livre-metrics-reference.js';
import {
  MercadoLivreClient,
  MercadoLivreClientError,
} from '../../marketplaces/mercado-livre/mercado-livre.client.js';
import {
  MercadoLivreOrder,
  MercadoLivreShipment,
} from '../../marketplaces/mercado-livre/mercado-livre.types.js';
import { mapMercadoLivreOrderStatus } from '../../marketplaces/mercado-livre/mercado-livre-order.mapper.js';
import { OlistOrdersClient } from './olist-orders.client.js';
import { OlistOrder } from './olist-orders.types.js';

const FULFILLMENT_LOGISTIC_TYPE = 'fulfillment';
const OLIST_FULFILLMENT_CHANNEL = 'Mercado Livre Fulfillment';
const OLIST_STANDARD_CHANNEL_PREFIX = 'ML_ALEIMMPORTS';
const ML_PAGE_SIZE = 50;
const SHIPMENT_CONCURRENCY = 5;

export type OlistOrdersInspectionErrorCode =
  | 'INVALID_DATE'
  | 'OLIST_ACCOUNT_NOT_FOUND'
  | 'OLIST_ACCOUNT_INACTIVE'
  | 'MARKETPLACE_ACCOUNT_NOT_FOUND'
  | 'MARKETPLACE_ACCOUNT_INACTIVE'
  | 'MARKETPLACE_ACCOUNT_UNIDENTIFIED'
  | 'UNSUPPORTED_MARKETPLACE'
  | 'ML_PARTIAL_RESPONSE';

export class OlistOrdersInspectionError extends Error {
  constructor(
    readonly code: OlistOrdersInspectionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'OlistOrdersInspectionError';
  }
}

function standardOlistChannel(marketplaceAccountName: string): string {
  const ordinal = /(\d+)\s*$/.exec(marketplaceAccountName.trim())?.[1];
  if (!ordinal) {
    throw new OlistOrdersInspectionError(
      'MARKETPLACE_ACCOUNT_UNIDENTIFIED',
      'Marketplace account name does not identify its account ordinal.',
    );
  }
  return `${OLIST_STANDARD_CHANNEL_PREFIX} ${ordinal}`;
}

type MatchingKind = 'MATCHED_EXACT' | 'UNMATCHED' | 'AMBIGUOUS' | 'CONFLICT';
type MatchingMethod =
  | 'numeroPedidoEcommerce->order.id'
  | 'numeroPedidoEcommerce->pack_id'
  | 'numeroPedidoCanalVenda->order.id'
  | 'numeroPedidoCanalVenda->pack_id';

interface MatchResult {
  kind: MatchingKind;
  method: MatchingMethod | null;
  matches: MercadoLivreOrder[];
}

interface CurrencyAmount {
  currency: string;
  amount: string;
}

interface MlAggregate {
  ordersCount: number;
  itemLines: number;
  units: number;
  orderAmountByCurrency: CurrencyAmount[];
  itemGrossAmountByCurrency: CurrencyAmount[];
}

interface ShipmentClassification {
  isFull: boolean | null;
  logisticTypes: string[];
}

interface FinancialSummary {
  totalPedido: string;
  totalProdutos: string | null;
  totalProdutosCoverage: { ordersWithValue: number; missingOrders: number };
  totalProdutosFromItemLines: string;
  frete: string;
  descontos: string;
  outrasDespesas: string | null;
  outrasDespesasCoverage: { ordersWithValue: number; missingOrders: number };
  unclassifiedCompositionResidual: string | null;
  residualSemantics: string;
  valorLiquido: null;
  valorLiquidoSemantics: string;
}

interface OlistAggregate extends FinancialSummary {
  ordersCount: number;
  itemLines: number;
  units: string;
}

export interface OlistOrdersInspectionReport {
  diagnostic: 'READ_ONLY';
  persistence: 'DISABLED';
  sellerBiPromotion: false;
  date: string;
  accounts: {
    correlation: {
      olistAccount: { id: string; name: string };
      olistChannel: typeof OLIST_FULFILLMENT_CHANNEL;
      marketplaceAccount: {
        id: string;
        name: string;
        sellerId: string;
        marketplace: 'MERCADO_LIVRE';
      };
    };
    isolation: {
      marketplaceAccountFilter: 'EXACT_ID';
      otherMarketplaceAccountsExcluded: number;
    };
    availableMarketplaceAccounts: Array<{
      id: string;
      name: string;
      sellerId: string;
      active: boolean;
    }>;
    availableOlistAccounts: Array<{
      id: string;
      name: string;
      active: boolean;
    }>;
  };
  period: {
    localStart: string;
    localEndExclusive: string;
    utcStart: string;
    utcEndExclusive: string;
    timeZone: string;
  };
  endpoints: string[];
  olist: OlistAggregate & {
    channelFilter: {
      included: [string, typeof OLIST_FULFILLMENT_CHANNEL];
      excludedOrders: number;
    };
    byStatus: Array<{ statusCode: number | null; status: string } & OlistAggregate>;
    byChannel: Array<{ channel: string; ordersCount: number }>;
    skuBreakdown: Array<{
      sku: string;
      product: string | null;
      itemLines: number;
      units: string;
    }>;
    unitsInvestigation: {
      ordersCount: number;
      itemLines: number;
      units: string;
      linesWithQuantityGreaterThanOne: number;
      unitsOnLinesWithQuantityGreaterThanOne: string;
      explicitKitOrBundleEvidence: false;
      conclusion: string;
    };
  };
  mercadoLivre: MlAggregate & {
    source: 'LIVE_OFFICIAL_API_READ_ONLY';
    byRawStatus: Array<{ status: string } & MlAggregate>;
    byNormalizedStatus: Array<{ status: string } & MlAggregate>;
    cancellations: MlAggregate & {
      includedInTotals: true;
      rule: 'normalizedStatus=CANCELLED';
    };
  };
  matching: {
    matchedExact: number;
    unmatched: number;
    ambiguous: number;
    conflict: number;
    matchingRatePercent: string;
    byMethod: Record<MatchingMethod, number>;
    rows: Array<{
      olistOrderId: string;
      status: MatchingKind;
      method: MatchingMethod | null;
      mlOrderIds: string[];
      mlPackIds: string[];
    }>;
    comparisons: Array<{
      olistOrderId: string;
      mlOrderId: string;
      mlPackId: string | null;
      method: MatchingMethod;
      mlRawStatus: string;
      mlNormalizedStatus: string;
      olistStatus: string;
      full: boolean | null;
      mlUnits: number;
      olistUnits: string;
      mlOrderAmount: string;
      mlItemGrossAmount: string;
      olistTotalProdutos: string | null;
      mlItems: Array<{
        listingId: string;
        variationId: string | null;
        sellerSku: string | null;
        quantity: number;
        unitPrice: string;
        grossAmount: string;
      }>;
      olistItems: Array<{
        sku: string | null;
        quantity: string;
        unitPrice: string;
        grossAmount: string;
      }>;
    }>;
  };
  full: {
    olistChannel: { channel: typeof OLIST_FULFILLMENT_CHANNEL } & OlistAggregate;
    officialMlClassification: {
      rule: 'shipment.logistic_type=fulfillment';
      ordersCount: number;
      itemLines: number;
      units: number;
      orderAmountByCurrency: CurrencyAmount[];
      itemGrossAmountByCurrency: CurrencyAmount[];
      classificationErrors: number;
    };
    matchingEvidence: {
      corroborated: number;
      conflict: number;
      notProven: number;
      ambiguous: number;
      rows: Array<{
        olistOrderId: string;
        matchingStatus: MatchingKind;
        result: 'CORROBORATED' | 'CONFLICT' | 'NOT_PROVEN' | 'AMBIGUOUS';
        mlOrderIds: string[];
        logisticTypes: string[];
      }>;
    };
    sellerBiReference: {
      source: 'MANUAL_GABI_BI';
      salesCount: number;
      units: number;
      grossSales: string;
      hardcodedAsProductionRule: false;
    } | null;
    reproduction: {
      olistChannelSalesCount: boolean | null;
      olistChannelUnits: boolean | null;
      olistChannelTotalProdutos: boolean | null;
      officialMlSalesCount: boolean | null;
      officialMlUnits: boolean | null;
      officialMlGrossAmount: boolean | null;
    };
  };
}

export interface OlistOnlyInspectionReport {
  diagnostic: 'READ_ONLY';
  persistence: 'DISABLED';
  matching: 'NOT_RUN_CORRECT_ML_ACCOUNT_UNAVAILABLE';
  date: string;
  account: { id: string; name: string };
  period: {
    localStart: string;
    localEndExclusive: string;
    utcStart: string;
    utcEndExclusive: string;
    timeZone: string;
  };
  olist: OlistAggregate & {
    byStatus: Array<{ statusCode: number | null; status: string } & OlistAggregate>;
    byChannel: Array<{ channel: string; ordersCount: number }>;
    skuBreakdown: ReturnType<typeof buildSkuBreakdown>;
    unitsInvestigation: ReturnType<typeof buildUnitsInvestigation>;
  };
  fullOlistChannel: { channel: typeof OLIST_FULFILLMENT_CHANNEL } & OlistAggregate;
}

@Injectable()
export class OlistOrdersInspectionService {
  private readonly businessTimeZone: string;

  constructor(
    private readonly database: DatabaseService,
    private readonly olistOrders: OlistOrdersClient,
    private readonly mercadoLivreClient: MercadoLivreClient,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.businessTimeZone = config.get('BUSINESS_TIMEZONE', { infer: true });
  }

  async inspectOlistOnly(params: {
    olistAccountId: string;
    date: string;
  }): Promise<OlistOnlyInspectionReport> {
    let interval: { start: Date; end: Date };
    try {
      interval = localDayToUtcInterval(params.date, this.businessTimeZone);
    } catch {
      throw new OlistOrdersInspectionError(
        'INVALID_DATE',
        'date must be a valid calendar date in YYYY-MM-DD format.',
      );
    }
    const account = await this.database.olistAccount.findUnique({
      where: { id: params.olistAccountId },
      select: { id: true, name: true, active: true },
    });
    if (!account) {
      throw new OlistOrdersInspectionError(
        'OLIST_ACCOUNT_NOT_FOUND',
        'Olist account was not found.',
      );
    }
    if (!account.active) {
      throw new OlistOrdersInspectionError(
        'OLIST_ACCOUNT_INACTIVE',
        'Olist account is inactive.',
      );
    }
    const orders = await this.olistOrders.listOrders({
      account,
      date: params.date,
      timeZone: this.businessTimeZone,
    });
    const fullOrders = orders.filter(
      (order) => effectiveOlistChannel(order) === OLIST_FULFILLMENT_CHANNEL,
    );
    return {
      diagnostic: 'READ_ONLY',
      persistence: 'DISABLED',
      matching: 'NOT_RUN_CORRECT_ML_ACCOUNT_UNAVAILABLE',
      date: params.date,
      account: { id: account.id, name: account.name },
      period: {
        localStart: `${params.date}T00:00:00`,
        localEndExclusive: `${nextCalendarDate(params.date)}T00:00:00`,
        utcStart: interval.start.toISOString(),
        utcEndExclusive: interval.end.toISOString(),
        timeZone: this.businessTimeZone,
      },
      olist: {
        ...aggregateOlist(orders),
        byStatus: buildStatusBreakdown(orders),
        byChannel: buildChannelBreakdown(orders),
        skuBreakdown: buildSkuBreakdown(orders),
        unitsInvestigation: buildUnitsInvestigation(orders),
      },
      fullOlistChannel: {
        channel: OLIST_FULFILLMENT_CHANNEL,
        ...aggregateOlist(fullOrders),
      },
    };
  }

  async inspect(params: {
    olistAccountId: string;
    marketplaceAccountId: string;
    date: string;
  }): Promise<OlistOrdersInspectionReport> {
    let interval: { start: Date; end: Date };
    try {
      interval = localDayToUtcInterval(params.date, this.businessTimeZone);
    } catch {
      throw new OlistOrdersInspectionError(
        'INVALID_DATE',
        'date must be a valid calendar date in YYYY-MM-DD format.',
      );
    }

    const [olistAccount, marketplaceAccount, availableMl, availableOlist] =
      await Promise.all([
        this.database.olistAccount.findUnique({
          where: { id: params.olistAccountId },
          select: { id: true, name: true, active: true },
        }),
        this.database.marketplaceAccount.findUnique({
          where: { id: params.marketplaceAccountId },
          select: {
            id: true,
            name: true,
            externalAccountId: true,
            marketplace: true,
            active: true,
          },
        }),
        this.database.marketplaceAccount.findMany({
          where: { marketplace: Marketplace.MERCADO_LIVRE },
          select: {
            id: true,
            name: true,
            externalAccountId: true,
            active: true,
          },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        }),
        this.database.olistAccount.findMany({
          select: { id: true, name: true, active: true },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        }),
      ]);

    if (!olistAccount) {
      throw new OlistOrdersInspectionError(
        'OLIST_ACCOUNT_NOT_FOUND',
        'Olist account was not found.',
      );
    }
    if (!olistAccount.active) {
      throw new OlistOrdersInspectionError(
        'OLIST_ACCOUNT_INACTIVE',
        'Olist account is inactive.',
      );
    }
    if (!marketplaceAccount) {
      throw new OlistOrdersInspectionError(
        'MARKETPLACE_ACCOUNT_NOT_FOUND',
        'Marketplace account was not found.',
      );
    }
    if (!marketplaceAccount.active) {
      throw new OlistOrdersInspectionError(
        'MARKETPLACE_ACCOUNT_INACTIVE',
        'Marketplace account is inactive.',
      );
    }
    if (marketplaceAccount.marketplace !== Marketplace.MERCADO_LIVRE) {
      throw new OlistOrdersInspectionError(
        'UNSUPPORTED_MARKETPLACE',
        'Marketplace account is not a Mercado Livre account.',
      );
    }

    const olistStandardChannel = standardOlistChannel(marketplaceAccount.name);
    const includedOlistChannels = new Set([
      olistStandardChannel,
      OLIST_FULFILLMENT_CHANNEL,
    ]);
    const [loadedOlistOrders, mlOrders] = await Promise.all([
      this.olistOrders.listOrders({
        account: olistAccount,
        date: params.date,
        timeZone: this.businessTimeZone,
      }),
      this.loadLiveMercadoLivreOrders(marketplaceAccount, interval),
    ]);
    const olistOrders = loadedOlistOrders.filter((order) =>
      includedOlistChannels.has(effectiveOlistChannel(order)),
    );
    const matches = matchOrders(olistOrders, mlOrders);
    const shipmentClassifications = await classifyShipments(
      mlOrders,
      marketplaceAccount,
      this.mercadoLivreClient,
    );
    const fullMlOrders = mlOrders.filter(
      (order) => shipmentClassifications.get(String(order.id))?.isFull === true,
    );
    const fullChannelOrders = olistOrders.filter(
      (order) => effectiveOlistChannel(order) === OLIST_FULFILLMENT_CHANNEL,
    );
    const fullChannelAggregate = aggregateOlist(fullChannelOrders);
    const officialFull = aggregateMl(fullMlOrders);
    const officialFullBrl = singleCurrencyAmount(
      officialFull.orderAmountByCurrency,
      'BRL',
    );
    const fullEvidence = buildFullMatchingEvidence(
      fullChannelOrders,
      matches,
      shipmentClassifications,
    );
    const allOlist = aggregateOlist(olistOrders);
    const sellerBiReference = getMercadoLivreMetricsManualReference(params.date);

    return {
      diagnostic: 'READ_ONLY',
      persistence: 'DISABLED',
      sellerBiPromotion: false,
      date: params.date,
      accounts: {
        correlation: {
          olistAccount: { id: olistAccount.id, name: olistAccount.name },
          olistChannel: OLIST_FULFILLMENT_CHANNEL,
          marketplaceAccount: {
            id: marketplaceAccount.id,
            name: marketplaceAccount.name,
            sellerId: marketplaceAccount.externalAccountId,
            marketplace: 'MERCADO_LIVRE',
          },
        },
        isolation: {
          marketplaceAccountFilter: 'EXACT_ID',
          otherMarketplaceAccountsExcluded: availableMl.filter(
            (account) => account.id !== marketplaceAccount.id,
          ).length,
        },
        availableMarketplaceAccounts: availableMl.map((account) => ({
          id: account.id,
          name: account.name,
          sellerId: account.externalAccountId,
          active: account.active,
        })),
        availableOlistAccounts: availableOlist,
      },
      period: {
        localStart: `${params.date}T00:00:00`,
        localEndExclusive: `${nextCalendarDate(params.date)}T00:00:00`,
        utcStart: interval.start.toISOString(),
        utcEndExclusive: interval.end.toISOString(),
        timeZone: this.businessTimeZone,
      },
      endpoints: [
        'GET Olist /pedidos',
        'GET Olist /pedidos/{idPedido}',
        'GET Mercado Livre /orders/search',
        'GET Mercado Livre /orders/{order_id}/shipments',
      ],
      olist: {
        ...allOlist,
        channelFilter: {
          included: [olistStandardChannel, OLIST_FULFILLMENT_CHANNEL],
          excludedOrders: loadedOlistOrders.length - olistOrders.length,
        },
        byStatus: buildStatusBreakdown(olistOrders),
        byChannel: buildChannelBreakdown(olistOrders),
        skuBreakdown: buildSkuBreakdown(olistOrders),
        unitsInvestigation: buildUnitsInvestigation(olistOrders),
      },
      mercadoLivre: {
        source: 'LIVE_OFFICIAL_API_READ_ONLY',
        ...aggregateMl(mlOrders),
        byRawStatus: buildMlStatusBreakdown(mlOrders, (order) => order.status),
        byNormalizedStatus: buildMlStatusBreakdown(
          mlOrders,
          (order) => mapMercadoLivreOrderStatus(order.status),
        ),
        cancellations: {
          includedInTotals: true,
          rule: 'normalizedStatus=CANCELLED',
          ...aggregateMl(
            mlOrders.filter(
              (order) =>
                mapMercadoLivreOrderStatus(order.status) === 'CANCELLED',
            ),
          ),
        },
      },
      matching: buildMatchingReport(
        olistOrders,
        matches,
        shipmentClassifications,
      ),
      full: {
        olistChannel: {
          channel: OLIST_FULFILLMENT_CHANNEL,
          ...fullChannelAggregate,
        },
        officialMlClassification: {
          rule: 'shipment.logistic_type=fulfillment',
          ...officialFull,
          classificationErrors: [...shipmentClassifications.values()].filter(
            (classification) => classification.isFull === null,
          ).length,
        },
        matchingEvidence: fullEvidence,
        sellerBiReference:
          sellerBiReference === null
            ? null
            : {
                source: sellerBiReference.source,
                salesCount: sellerBiReference.fullSalesQuantity,
                units: sellerBiReference.fullUnitsSold,
                grossSales: sellerBiReference.fullGrossSales,
                hardcodedAsProductionRule: false,
              },
        reproduction: {
          olistChannelSalesCount: sellerBiReference === null
            ? null
            : fullChannelOrders.length === sellerBiReference.fullSalesQuantity,
          olistChannelUnits: sellerBiReference === null
            ? null
            : fullChannelAggregate.units === String(sellerBiReference.fullUnitsSold),
          olistChannelTotalProdutos:
            sellerBiReference === null || fullChannelAggregate.totalProdutos === null
              ? null
              : fullChannelAggregate.totalProdutos === sellerBiReference.fullGrossSales,
          officialMlSalesCount: sellerBiReference === null
            ? null
            : fullMlOrders.length === sellerBiReference.fullSalesQuantity,
          officialMlUnits: sellerBiReference === null
            ? null
            : sumMlUnits(fullMlOrders) === sellerBiReference.fullUnitsSold,
          officialMlGrossAmount:
            sellerBiReference === null || officialFullBrl === null
              ? null
              : officialFullBrl === sellerBiReference.fullGrossSales,
        },
      },
    };
  }

  private async loadLiveMercadoLivreOrders(
    account: { id: string; externalAccountId: string },
    interval: { start: Date; end: Date },
  ): Promise<MercadoLivreOrder[]> {
    const orders: MercadoLivreOrder[] = [];
    let offset = 0;
    let total = Number.POSITIVE_INFINITY;
    while (offset < total) {
      const response = await this.mercadoLivreClient.searchOrders(
        {
          seller: account.externalAccountId,
          dateCreatedFrom: interval.start.toISOString(),
          dateCreatedTo: interval.end.toISOString(),
          offset,
          limit: ML_PAGE_SIZE,
          sort: 'date_asc',
        },
        account,
      );
      if (response.partial) {
        throw new OlistOrdersInspectionError(
          'ML_PARTIAL_RESPONSE',
          'Mercado Livre returned a partial orders page; inspection was aborted.',
        );
      }
      const page = response.data;
      if (page.paging.offset !== offset || page.paging.limit < 1) {
        throw new MercadoLivreClientError(
          'Mercado Livre returned inconsistent orders pagination.',
          'INVALID_RESPONSE',
        );
      }
      orders.push(
        ...page.results.filter((order) => {
          const createdAt = new Date(order.date_created);
          return createdAt >= interval.start && createdAt < interval.end;
        }),
      );
      total = page.paging.total;
      offset += page.paging.limit;
    }
    return orders;
  }
}

function matchOrders(
  olistOrders: OlistOrder[],
  mlOrders: MercadoLivreOrder[],
): Map<string, MatchResult> {
  const byOrderId = indexMlOrders(mlOrders, (order) => String(order.id));
  const byPackId = indexMlOrders(mlOrders, (order) => scalarId(order.pack_id));
  const result = new Map<string, MatchResult>();
  for (const order of olistOrders) {
    const attempts: Array<{
      method: MatchingMethod;
      value: string | null;
      index: Map<string, MercadoLivreOrder[]>;
    }> = [
      { method: 'numeroPedidoEcommerce->order.id', value: order.ecommerceOrderId, index: byOrderId },
      { method: 'numeroPedidoEcommerce->pack_id', value: order.ecommerceOrderId, index: byPackId },
      { method: 'numeroPedidoCanalVenda->order.id', value: order.salesChannelOrderId, index: byOrderId },
      { method: 'numeroPedidoCanalVenda->pack_id', value: order.salesChannelOrderId, index: byPackId },
    ];
    const successful = attempts.flatMap((attempt) => {
      if (attempt.value === null) return [];
      const found = attempt.index.get(attempt.value) ?? [];
      return found.length === 0 ? [] : [{ ...attempt, found }];
    });
    const first = successful[0];
    let match: MatchResult = { kind: 'UNMATCHED', method: null, matches: [] };
    if (first) {
      const firstIds = candidateIdKey(first.found);
      const identifiersConflict = successful.some(
        (attempt) => candidateIdKey(attempt.found) !== firstIds,
      );
      match = {
        kind: identifiersConflict
          ? 'CONFLICT'
          : first.found.length === 1
            ? 'MATCHED_EXACT'
            : 'AMBIGUOUS',
        method: first.method,
        matches: identifiersConflict
          ? uniqueOrders(successful.flatMap((attempt) => attempt.found))
          : first.found,
      };
    }
    result.set(order.olistOrderId, match);
  }
  return result;
}

function candidateIdKey(orders: MercadoLivreOrder[]): string {
  return orders.map((order) => String(order.id)).sort().join(',');
}

function uniqueOrders(orders: MercadoLivreOrder[]): MercadoLivreOrder[] {
  return [...new Map(orders.map((order) => [String(order.id), order])).values()];
}

function indexMlOrders(
  orders: MercadoLivreOrder[],
  keyOf: (order: MercadoLivreOrder) => string | null,
): Map<string, MercadoLivreOrder[]> {
  const index = new Map<string, MercadoLivreOrder[]>();
  for (const order of orders) {
    const key = keyOf(order);
    if (key === null) continue;
    const bucket = index.get(key) ?? [];
    bucket.push(order);
    index.set(key, bucket);
  }
  return index;
}

async function classifyShipments(
  orders: MercadoLivreOrder[],
  account: { id: string },
  client: MercadoLivreClient,
): Promise<Map<string, ShipmentClassification>> {
  const entries = await mapWithConcurrency(
    orders,
    SHIPMENT_CONCURRENCY,
    async (order): Promise<[string, ShipmentClassification]> => {
      try {
        const shipments = await client.getOrderShipments(String(order.id), account);
        const logisticTypes = uniqueLogisticTypes(shipments);
        return [String(order.id), { isFull: logisticTypes.includes(FULFILLMENT_LOGISTIC_TYPE), logisticTypes }];
      } catch (error: unknown) {
        if (error instanceof MercadoLivreClientError) {
          return [String(order.id), { isFull: null, logisticTypes: [] }];
        }
        throw error;
      }
    },
  );
  return new Map(entries);
}

function uniqueLogisticTypes(shipments: MercadoLivreShipment[]): string[] {
  return [...new Set(shipments.flatMap((shipment) =>
    shipment.logistic_type === null ? [] : [shipment.logistic_type.toLowerCase()],
  ))].sort();
}

function aggregateOlist(orders: OlistOrder[]): OlistAggregate {
  const reportedProducts = orders.flatMap((order) =>
    order.productTotalAmount === null ? [] : [order.productTotalAmount],
  );
  const otherExpenses = orders.flatMap((order) =>
    order.otherExpensesAmount === null ? [] : [order.otherExpensesAmount],
  );
  const totalPedido = sumDecimal(orders.map((order) => order.totalAmount));
  const totalProdutos = reportedProducts.length === orders.length ? sumDecimal(reportedProducts) : null;
  const frete = sumDecimal(orders.map((order) => order.freightAmount));
  const descontos = sumDecimal(orders.map((order) => order.discountAmount));
  const outrasDespesas = otherExpenses.length === orders.length ? sumDecimal(otherExpenses) : null;
  const residual = totalProdutos === null || outrasDespesas === null
    ? null
    : totalPedido.minus(totalProdutos).minus(frete).plus(descontos).minus(outrasDespesas);
  return {
    ordersCount: orders.length,
    itemLines: orders.reduce((total, order) => total + order.items.length, 0),
    units: decimalString(sumOlistUnits(orders)),
    totalPedido: money(totalPedido),
    totalProdutos: totalProdutos === null ? null : money(totalProdutos),
    totalProdutosCoverage: { ordersWithValue: reportedProducts.length, missingOrders: orders.length - reportedProducts.length },
    totalProdutosFromItemLines: money(sumDecimal(orders.flatMap((order) =>
      order.items.map((item) => item.unitPrice.mul(item.quantity)),
    ))),
    frete: money(frete),
    descontos: money(descontos),
    outrasDespesas: outrasDespesas === null ? null : money(outrasDespesas),
    outrasDespesasCoverage: { ordersWithValue: otherExpenses.length, missingOrders: orders.length - otherExpenses.length },
    unclassifiedCompositionResidual: residual === null ? null : money(residual),
    residualSemantics: 'Diagnostic identity only: totalPedido - totalProdutos - frete + descontos - outrasDespesas; never used to force reconciliation.',
    valorLiquido: null,
    valorLiquidoSemantics: 'Not calculated: the inspected Olist order contract does not document a net-settlement field or settlement formula.',
  };
}

function buildStatusBreakdown(orders: OlistOrder[]) {
  const groups = new Map<string, OlistOrder[]>();
  for (const order of orders) {
    const key = `${order.statusCode ?? 'null'}:${order.status}`;
    const group = groups.get(key) ?? [];
    group.push(order);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({
    statusCode: group[0]!.statusCode,
    status: group[0]!.status,
    ...aggregateOlist(group),
  })).sort((left, right) => left.status.localeCompare(right.status));
}

function buildChannelBreakdown(orders: OlistOrder[]): Array<{ channel: string; ordersCount: number }> {
  const counts = new Map<string, number>();
  for (const order of orders) {
    const channel = effectiveOlistChannel(order);
    counts.set(channel, (counts.get(channel) ?? 0) + 1);
  }
  return [...counts.entries()].map(([channel, ordersCount]) => ({ channel, ordersCount }))
    .sort((left, right) => left.channel.localeCompare(right.channel, 'pt-BR'));
}

function effectiveOlistChannel(order: OlistOrder): string {
  return order.salesChannel ?? order.ecommerce ?? '(nao informado)';
}

function buildSkuBreakdown(orders: OlistOrder[]) {
  const groups = new Map<string, { sku: string; product: string | null; itemLines: number; units: Prisma.Decimal }>();
  for (const item of orders.flatMap((order) => order.items)) {
    const sku = item.sku ?? '(nao informado)';
    const current = groups.get(sku) ?? { sku, product: item.product, itemLines: 0, units: new Prisma.Decimal(0) };
    current.itemLines += 1;
    current.units = current.units.plus(item.quantity);
    groups.set(sku, current);
  }
  return [...groups.values()].map((group) => ({ ...group, units: decimalString(group.units) }))
    .sort((left, right) => new Prisma.Decimal(right.units).comparedTo(new Prisma.Decimal(left.units)));
}

function buildUnitsInvestigation(orders: OlistOrder[]) {
  const items = orders.flatMap((order) => order.items);
  const multiplied = items.filter((item) => item.quantity.greaterThan(1));
  return {
    ordersCount: orders.length,
    itemLines: items.length,
    units: decimalString(sumOlistUnits(orders)),
    linesWithQuantityGreaterThanOne: multiplied.length,
    unitsOnLinesWithQuantityGreaterThanOne: decimalString(sumDecimal(multiplied.map((item) => item.quantity))),
    explicitKitOrBundleEvidence: false as const,
    conclusion: 'The inspected Olist order contract exposes item quantities but no explicit kit/bundle relationship; kit expansion cannot be asserted from these fields.',
  };
}

function buildMatchingReport(
  orders: OlistOrder[],
  matches: Map<string, MatchResult>,
  classifications: Map<string, ShipmentClassification>,
): OlistOrdersInspectionReport['matching'] {
  const rows = orders.map((order) => {
    const match = matches.get(order.olistOrderId)!;
    return {
      olistOrderId: order.olistOrderId,
      status: match.kind,
      method: match.method,
      mlOrderIds: match.matches.map((candidate) => String(candidate.id)),
      mlPackIds: [...new Set(match.matches.flatMap((candidate) => {
        const packId = scalarId(candidate.pack_id);
        return packId === null ? [] : [packId];
      }))],
    };
  });
  const methods: Record<MatchingMethod, number> = {
    'numeroPedidoEcommerce->order.id': 0,
    'numeroPedidoEcommerce->pack_id': 0,
    'numeroPedidoCanalVenda->order.id': 0,
    'numeroPedidoCanalVenda->pack_id': 0,
  };
  for (const row of rows) if (row.method !== null) methods[row.method] += 1;
  return {
    matchedExact: rows.filter((row) => row.status === 'MATCHED_EXACT').length,
    unmatched: rows.filter((row) => row.status === 'UNMATCHED').length,
    ambiguous: rows.filter((row) => row.status === 'AMBIGUOUS').length,
    conflict: rows.filter((row) => row.status === 'CONFLICT').length,
    matchingRatePercent: percentage(
      rows.filter((row) => row.status === 'MATCHED_EXACT').length,
      rows.length,
    ),
    byMethod: methods,
    rows,
    comparisons: buildMatchedComparisons(orders, matches, classifications),
  };
}

function buildMatchedComparisons(
  orders: OlistOrder[],
  matches: Map<string, MatchResult>,
  classifications: Map<string, ShipmentClassification>,
): OlistOrdersInspectionReport['matching']['comparisons'] {
  return orders.flatMap((order) => {
    const match = matches.get(order.olistOrderId)!;
    if (match.kind !== 'MATCHED_EXACT' || match.method === null) return [];
    const mlOrder = match.matches[0]!;
    return [{
      olistOrderId: order.olistOrderId,
      mlOrderId: String(mlOrder.id),
      mlPackId: scalarId(mlOrder.pack_id),
      method: match.method,
      mlRawStatus: mlOrder.status,
      mlNormalizedStatus: mapMercadoLivreOrderStatus(mlOrder.status),
      olistStatus: order.status,
      full: classifications.get(String(mlOrder.id))?.isFull ?? null,
      mlUnits: sumMlUnits([mlOrder]),
      olistUnits: decimalString(sumOlistUnits([order])),
      mlOrderAmount: money(new Prisma.Decimal(String(mlOrder.total_amount))),
      mlItemGrossAmount: money(sumMlItemGross([mlOrder])),
      olistTotalProdutos:
        order.productTotalAmount === null
          ? null
          : money(order.productTotalAmount),
      mlItems: mlOrder.order_items.map((item) => ({
        listingId: item.item.id,
        variationId: scalarId(item.item.variation_id),
        sellerSku: item.item.seller_sku ?? null,
        quantity: item.quantity,
        unitPrice: money(new Prisma.Decimal(String(item.unit_price))),
        grossAmount: money(mlItemGross(item)),
      })),
      olistItems: order.items.map((item) => ({
        sku: item.sku,
        quantity: decimalString(item.quantity),
        unitPrice: money(item.unitPrice),
        grossAmount: money(item.unitPrice.mul(item.quantity)),
      })),
    }];
  });
}

function buildFullMatchingEvidence(
  orders: OlistOrder[],
  matches: Map<string, MatchResult>,
  classifications: Map<string, ShipmentClassification>,
): OlistOrdersInspectionReport['full']['matchingEvidence'] {
  const rows = orders.map((order) => {
    const match = matches.get(order.olistOrderId)!;
    const classification = match.kind === 'MATCHED_EXACT'
      ? classifications.get(String(match.matches[0]!.id))
      : undefined;
    const result = match.kind === 'CONFLICT'
      ? ('CONFLICT' as const)
      : match.kind === 'AMBIGUOUS'
      ? ('AMBIGUOUS' as const)
      : match.kind !== 'MATCHED_EXACT' || classification?.isFull === null
        ? ('NOT_PROVEN' as const)
        : classification?.isFull === true
          ? ('CORROBORATED' as const)
          : ('CONFLICT' as const);
    return {
      olistOrderId: order.olistOrderId,
      matchingStatus: match.kind,
      result,
      mlOrderIds: match.matches.map((candidate) => String(candidate.id)),
      logisticTypes: classification?.logisticTypes ?? [],
    };
  });
  return {
    corroborated: rows.filter((row) => row.result === 'CORROBORATED').length,
    conflict: rows.filter((row) => row.result === 'CONFLICT').length,
    notProven: rows.filter((row) => row.result === 'NOT_PROVEN').length,
    ambiguous: rows.filter((row) => row.result === 'AMBIGUOUS').length,
    rows,
  };
}

function aggregateMl(orders: MercadoLivreOrder[]): MlAggregate {
  return {
    ordersCount: orders.length,
    itemLines: countMlItemLines(orders),
    units: sumMlUnits(orders),
    orderAmountByCurrency: amountsByCurrency(
      orders,
      (order) => new Prisma.Decimal(String(order.total_amount)),
    ),
    itemGrossAmountByCurrency: amountsByCurrency(
      orders,
      (order) => sumMlItemGross([order]),
    ),
  };
}

function buildMlStatusBreakdown(
  orders: MercadoLivreOrder[],
  statusOf: (order: MercadoLivreOrder) => string,
): Array<{ status: string } & MlAggregate> {
  const groups = new Map<string, MercadoLivreOrder[]>();
  for (const order of orders) {
    const status = statusOf(order);
    const group = groups.get(status) ?? [];
    group.push(order);
    groups.set(status, group);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([status, group]) => ({ status, ...aggregateMl(group) }));
}

function amountsByCurrency(
  orders: MercadoLivreOrder[],
  amountOf: (order: MercadoLivreOrder) => Prisma.Decimal,
): CurrencyAmount[] {
  const amounts = new Map<string, Prisma.Decimal>();
  for (const order of orders) {
    const value = amountOf(order);
    amounts.set(order.currency_id, (amounts.get(order.currency_id) ?? new Prisma.Decimal(0)).plus(value));
  }
  return [...amounts.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, amount]) => ({ currency, amount: money(amount) }));
}

function singleCurrencyAmount(values: Array<{ currency: string; amount: string }>, currency: string): string | null {
  return values.find((value) => value.currency === currency)?.amount ?? null;
}

function countMlItemLines(orders: MercadoLivreOrder[]): number {
  return orders.reduce((total, order) => total + order.order_items.length, 0);
}

function sumMlUnits(orders: MercadoLivreOrder[]): number {
  return orders.reduce((total, order) => total + order.order_items.reduce((sum, item) => sum + item.quantity, 0), 0);
}

function sumMlItemGross(orders: MercadoLivreOrder[]): Prisma.Decimal {
  return orders.reduce(
    (total, order) => total.plus(sumDecimal(order.order_items.map(mlItemGross))),
    new Prisma.Decimal(0),
  );
}

function mlItemGross(item: MercadoLivreOrder['order_items'][number]): Prisma.Decimal {
  return item.gross_price === null || item.gross_price === undefined
    ? new Prisma.Decimal(String(item.unit_price)).mul(item.quantity)
    : new Prisma.Decimal(String(item.gross_price));
}

function sumOlistUnits(orders: OlistOrder[]): Prisma.Decimal {
  return sumDecimal(orders.flatMap((order) => order.items.map((item) => item.quantity)));
}

function sumDecimal(values: Prisma.Decimal[]): Prisma.Decimal {
  return values.reduce((total, value) => total.plus(value), new Prisma.Decimal(0));
}

function scalarId(value: string | number | null | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : typeof value === 'number' && Number.isSafeInteger(value)
      ? String(value)
      : null;
}

function money(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

function decimalString(value: Prisma.Decimal): string {
  return value.isInteger() ? value.toFixed(0) : value.toString();
}

function percentage(numerator: number, denominator: number): string {
  return denominator === 0
    ? '0.00'
    : new Prisma.Decimal(numerator).dividedBy(denominator).mul(100).toFixed(2);
}

function nextCalendarDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + 1)).toISOString().slice(0, 10);
}

async function mapWithConcurrency<T, R>(values: T[], concurrency: number, mapper: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}
