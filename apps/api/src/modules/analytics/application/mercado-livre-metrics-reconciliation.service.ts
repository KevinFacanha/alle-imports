import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Marketplace, MarketplaceOrderStatus, Prisma } from '@prisma/client';

import { EnvironmentVariables } from '../../../config/environment.validation.js';
import { DatabaseService } from '../../../database/database.service.js';
import {
  MercadoLivreClient,
  MercadoLivreClientError,
} from '../../marketplaces/mercado-livre/mercado-livre.client.js';
import { localDayToUtcInterval } from './daily-sales-summary.service.js';
import {
  getMercadoLivreMetricsManualReference,
  MercadoLivreMetricsManualReference,
} from './mercado-livre-metrics-reference.js';

export interface MercadoLivreMetricsReconciliationParams {
  marketplaceAccountId: string;
  date: string;
}

export type ReconciliationStatus =
  | 'NO_REFERENCE'
  | 'OPERATIONAL_DIAGNOSTIC'
  | 'SELLER_BI_REFERENCE';

export interface ReconciliationRow {
  metric: string;
  calculated: number | string | null;
  reference: number | string | null;
  difference: number | string | null;
  status: ReconciliationStatus;
  explanation?: string;
}

export interface OrderStatusBreakdown {
  status: string;
  orders: number;
  units: number;
  grossAmountByCurrency: CurrencyAmount[];
}

export interface CurrencyAmount {
  currency: string;
  amount: string;
}

export interface OfficialApiAvailability {
  status: 'AVAILABLE' | 'UNAVAILABLE';
  errorCode?: string;
  httpStatus?: number;
  message?: string;
}

export interface CancelledOrderDiagnostic {
  externalOrderId: string;
  normalizedStatus: 'CANCELLED';
  rawStatus: string | null;
  soldAt: string;
}

export interface MercadoLivreMetricsReconciliationReport {
  diagnostic: 'READ_ONLY';
  classification: {
    ordersAndShipments: 'OPERATIONAL_ORDERS_METRICS';
    biReference: 'SELLER_BI_METRICS';
  };
  conclusion: {
    marketplaceOrderIsDirectSpreadsheetSource: false;
    dailySalesSummaryIsDirectSpreadsheetSource: false;
    operationalLayerPurpose: 'AUDIT_AND_OPERATIONAL_DATA';
  };
  marketplaceAccountId: string;
  externalAccountId: string;
  date: string;
  period: { start: string; endExclusive: string; timeZone: string };
  reference: MercadoLivreMetricsManualReference | null;
  orders: {
    semantics: 'OPERATIONAL_ORDERS_METRICS';
    minimumSoldAt: string | null;
    maximumSoldAt: string | null;
    totalOrders: number;
    totalItems: number;
    totalUnits: number;
    grossAmountByCurrency: CurrencyAmount[];
    itemGrossAmountByCurrency: CurrencyAmount[];
    byNormalizedStatus: OrderStatusBreakdown[];
    byRawStatus: OrderStatusBreakdown[];
    cancelled: CancelledOrderDiagnostic[];
  };
  visits: {
    totalVisits: number | null;
    requestedDateFrom: string;
    requestedDateTo: string;
    api: OfficialApiAvailability;
  };
  full: {
    semantics: 'OPERATIONAL_ORDERS_METRICS';
    classificationRule: 'shipment.logistic_type = fulfillment';
    fullOrders: number | null;
    fullUnits: number | null;
    fullGrossAmountByCurrency: CurrencyAmount[];
    nonFullOrders: number | null;
    ordersWithoutShipment: number | null;
    shipmentsFound: number | null;
    api: OfficialApiAvailability;
  };
  orderCountInvestigation: {
    persistedOrders: number;
    panelSalesReference: number | null;
    difference: number | null;
    conclusion: 'NOT_COMPARABLE_DIFFERENT_SEMANTICS' | 'NO_REFERENCE';
    explanation: string;
  };
  comparison: ReconciliationRow[];
}

export type MercadoLivreMetricsReconciliationErrorCode =
  | 'INVALID_DATE'
  | 'ACCOUNT_NOT_FOUND'
  | 'ACCOUNT_INACTIVE'
  | 'UNSUPPORTED_MARKETPLACE';

export class MercadoLivreMetricsReconciliationError extends Error {
  constructor(
    readonly code: MercadoLivreMetricsReconciliationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MercadoLivreMetricsReconciliationError';
  }
}

interface PersistedOrder {
  externalOrderId: string;
  soldAt: Date;
  normalizedStatus: MarketplaceOrderStatus;
  rawStatus: string | null;
  currency: string;
  grossAmount: Prisma.Decimal;
  items: Array<{
    quantity: number;
    grossAmount: Prisma.Decimal;
  }>;
}

interface MutableBreakdown {
  orders: number;
  units: number;
  amounts: Map<string, Prisma.Decimal>;
}

const FULFILLMENT_LOGISTIC_TYPE = 'fulfillment';
const SHIPMENT_LOOKUP_CONCURRENCY = 5;
@Injectable()
export class MercadoLivreMetricsReconciliationService {
  private readonly businessTimeZone: string;

  constructor(
    private readonly database: DatabaseService,
    private readonly mercadoLivreClient: MercadoLivreClient,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.businessTimeZone = config.get('BUSINESS_TIMEZONE', { infer: true });
  }

  async reconcile(
    params: MercadoLivreMetricsReconciliationParams,
  ): Promise<MercadoLivreMetricsReconciliationReport> {
    let interval: { start: Date; end: Date };
    try {
      interval = localDayToUtcInterval(params.date, this.businessTimeZone);
    } catch {
      throw new MercadoLivreMetricsReconciliationError(
        'INVALID_DATE',
        'date must be a valid calendar date in YYYY-MM-DD format.',
      );
    }

    const account = await this.database.marketplaceAccount.findUnique({
      where: { id: params.marketplaceAccountId },
      select: {
        id: true,
        externalAccountId: true,
        marketplace: true,
        active: true,
      },
    });
    if (!account) {
      throw new MercadoLivreMetricsReconciliationError(
        'ACCOUNT_NOT_FOUND',
        'Marketplace account was not found.',
      );
    }
    if (!account.active) {
      throw new MercadoLivreMetricsReconciliationError(
        'ACCOUNT_INACTIVE',
        'Marketplace account is inactive.',
      );
    }
    if (account.marketplace !== Marketplace.MERCADO_LIVRE) {
      throw new MercadoLivreMetricsReconciliationError(
        'UNSUPPORTED_MARKETPLACE',
        'Marketplace account is not a Mercado Livre account.',
      );
    }

    const orders = await this.database.marketplaceOrder.findMany({
      where: {
        marketplaceAccountId: account.id,
        soldAt: { gte: interval.start, lt: interval.end },
      },
      select: {
        externalOrderId: true,
        soldAt: true,
        normalizedStatus: true,
        rawStatus: true,
        currency: true,
        grossAmount: true,
        items: { select: { quantity: true, grossAmount: true } },
      },
      orderBy: [{ soldAt: 'asc' }, { externalOrderId: 'asc' }],
    });

    const nextDate = nextCalendarDate(params.date);
    const visitsResult = await captureOfficialApiCall(() =>
      this.mercadoLivreClient.getUserVisits(
        account.externalAccountId,
        params.date,
        nextDate,
        account,
      ),
    );
    const shipmentResult = await captureOfficialApiCall(async () => {
      if (orders.length === 0) {
        return [];
      }

      // A primeira chamada funciona como prova de acesso e evita disparar uma
      // chamada por pedido quando a autorização inteira rejeita o recurso.
      const firstOrder = orders[0]!;
      const firstShipments = await this.mercadoLivreClient.getOrderShipments(
        firstOrder.externalOrderId,
        account,
      );
      const remaining = await mapWithConcurrency(
        orders.slice(1),
        SHIPMENT_LOOKUP_CONCURRENCY,
        async (order) => ({
          order,
          shipments: await this.mercadoLivreClient.getOrderShipments(
            order.externalOrderId,
            account,
          ),
        }),
      );
      return [{ order: firstOrder, shipments: firstShipments }, ...remaining];
    });

    const shipmentResults = shipmentResult.data ?? [];

    const fullOrders = shipmentResults
      .filter(({ shipments }) =>
        shipments.some(
          (shipment) =>
            shipment.logistic_type?.toLowerCase() ===
            FULFILLMENT_LOGISTIC_TYPE,
        ),
      )
      .map(({ order }) => order);
    const ordersWithoutShipment = shipmentResults.filter(
      ({ shipments }) => shipments.length === 0,
    ).length;
    const reference = getMercadoLivreMetricsManualReference(params.date);
    const minimumSoldAt = minimumDate(orders.map((order) => order.soldAt));
    const maximumSoldAt = maximumDate(orders.map((order) => order.soldAt));
    const totalItems = orders.reduce(
      (total, order) => total + order.items.length,
      0,
    );
    const totalUnits = sumUnits(orders);
    const fullUnits = sumUnits(fullOrders);
    const orderAmounts = amountsByCurrency(orders, (order) => order.grossAmount);
    const itemAmounts = amountsByCurrency(
      orders.flatMap((order) =>
        order.items.map((item) => ({ currency: order.currency, item })),
      ),
      ({ item }) => item.grossAmount,
    );
    const fullAmounts = amountsByCurrency(
      fullOrders,
      (order) => order.grossAmount,
    );
    const shipmentsAvailable = shipmentResult.data !== null;

    return {
      diagnostic: 'READ_ONLY',
      classification: {
        ordersAndShipments: 'OPERATIONAL_ORDERS_METRICS',
        biReference: 'SELLER_BI_METRICS',
      },
      conclusion: {
        marketplaceOrderIsDirectSpreadsheetSource: false,
        dailySalesSummaryIsDirectSpreadsheetSource: false,
        operationalLayerPurpose: 'AUDIT_AND_OPERATIONAL_DATA',
      },
      marketplaceAccountId: account.id,
      externalAccountId: account.externalAccountId,
      date: params.date,
      period: {
        start: interval.start.toISOString(),
        endExclusive: interval.end.toISOString(),
        timeZone: this.businessTimeZone,
      },
      reference,
      orders: {
        semantics: 'OPERATIONAL_ORDERS_METRICS',
        minimumSoldAt: minimumSoldAt?.toISOString() ?? null,
        maximumSoldAt: maximumSoldAt?.toISOString() ?? null,
        totalOrders: orders.length,
        totalItems,
        totalUnits,
        grossAmountByCurrency: orderAmounts,
        itemGrossAmountByCurrency: itemAmounts,
        byNormalizedStatus: buildBreakdown(
          orders,
          (order) => order.normalizedStatus,
        ),
        byRawStatus: buildBreakdown(
          orders,
          (order) => order.rawStatus ?? '(null)',
        ),
        cancelled: orders
          .filter(
            (order) =>
              order.normalizedStatus === MarketplaceOrderStatus.CANCELLED,
          )
          .map((order) => ({
            externalOrderId: order.externalOrderId,
            normalizedStatus: 'CANCELLED' as const,
            rawStatus: order.rawStatus,
            soldAt: order.soldAt.toISOString(),
          })),
      },
      visits: {
        totalVisits: visitsResult.data?.total_visits ?? null,
        requestedDateFrom: params.date,
        requestedDateTo: nextDate,
        api: availabilityOf(visitsResult.error),
      },
      full: {
        semantics: 'OPERATIONAL_ORDERS_METRICS',
        classificationRule: 'shipment.logistic_type = fulfillment',
        fullOrders: shipmentsAvailable ? fullOrders.length : null,
        fullUnits: shipmentsAvailable ? fullUnits : null,
        fullGrossAmountByCurrency: shipmentsAvailable ? fullAmounts : [],
        nonFullOrders: shipmentsAvailable
          ? orders.length - fullOrders.length
          : null,
        ordersWithoutShipment: shipmentsAvailable
          ? ordersWithoutShipment
          : null,
        shipmentsFound: shipmentsAvailable
          ? shipmentResults.reduce(
              (total, result) => total + result.shipments.length,
              0,
            )
          : null,
        api: availabilityOf(shipmentResult.error),
      },
      orderCountInvestigation: buildOrderCountInvestigation(
        orders.length,
        reference,
      ),
      comparison: buildComparison({
        reference,
        persistedOrders: orders.length,
        totalUnits,
        orderGrossAmount: singleBrlAmount(orderAmounts),
        totalVisits: visitsResult.data?.total_visits ?? null,
        visitsError: visitsResult.error,
        fullOrders: shipmentsAvailable ? fullOrders.length : null,
        fullUnits: shipmentsAvailable ? fullUnits : null,
        fullGrossAmount: shipmentsAvailable
          ? singleBrlAmount(fullAmounts)
          : null,
        shipmentsError: shipmentResult.error,
      }),
    };
  }
}

interface ComparisonValues {
  reference: MercadoLivreMetricsManualReference | null;
  persistedOrders: number;
  totalUnits: number;
  orderGrossAmount: string | null;
  totalVisits: number | null;
  visitsError: MercadoLivreClientError | null;
  fullOrders: number | null;
  fullUnits: number | null;
  fullGrossAmount: string | null;
  shipmentsError: MercadoLivreClientError | null;
}

export function buildComparison(values: ComparisonValues): ReconciliationRow[] {
  const reference = values.reference;
  return [
    operationalDiagnosticRow(
      'operational.orders.gross_amount',
      values.orderGrossAmount,
      'Soma de order.total_amount dos pedidos persistidos; diagnóstico operacional, não Faturamento Dia do BI.',
    ),
    operationalDiagnosticRow(
      'operational.orders.count',
      values.persistedOrders,
      'Quantidade de orders persistidas; diagnóstico operacional, não Quantidade de Vendas do BI.',
    ),
    operationalDiagnosticRow(
      'operational.orders.units',
      values.totalUnits,
      'Soma das quantidades dos itens persistidos; diagnóstico operacional.',
    ),
    values.visitsError
      ? operationalDiagnosticRow(
          'operational.visits',
          null,
          officialApiFailureExplanation('visits', values.visitsError),
        )
      : operationalDiagnosticRow(
          'operational.visits',
          values.totalVisits,
          'Visitas retornadas pelo endpoint oficial; diagnóstico operacional.',
        ),
    values.shipmentsError
      ? operationalDiagnosticRow(
          'operational.fulfillment.gross_amount',
          null,
          officialApiFailureExplanation('order shipments', values.shipmentsError),
        )
      : operationalDiagnosticRow(
          'operational.fulfillment.gross_amount',
          values.fullGrossAmount,
          'Soma operacional de order.total_amount para shipments fulfillment; não corresponde a BI.FULL.',
        ),
    values.shipmentsError
      ? operationalDiagnosticRow(
          'operational.fulfillment.orders',
          null,
          officialApiFailureExplanation('order shipments', values.shipmentsError),
        )
      : operationalDiagnosticRow(
          'operational.fulfillment.orders',
          values.fullOrders,
          'Quantidade operacional de orders com shipment fulfillment; não corresponde a BI.QTDE VENDAS FULL.',
        ),
    values.shipmentsError
      ? operationalDiagnosticRow(
          'operational.fulfillment.units',
          null,
          officialApiFailureExplanation('order shipments', values.shipmentsError),
        )
      : operationalDiagnosticRow(
          'operational.fulfillment.units',
          values.fullUnits,
          'Soma operacional das unidades em orders com shipment fulfillment.',
        ),
    sellerBiReferenceRow(
      'seller_bi.faturamento_dia',
      reference?.grossRevenueDay ?? null,
    ),
    sellerBiReferenceRow(
      'seller_bi.quantidade_vendas',
      reference?.salesQuantity ?? null,
    ),
    sellerBiReferenceRow(
      'seller_bi.full',
      reference?.fullGrossSales ?? null,
    ),
    sellerBiReferenceRow(
      'seller_bi.qtde_vendas_full',
      reference?.fullUnitsSold ?? null,
    ),
    sellerBiReferenceRow(
      'seller_bi.ticket_medio',
      reference?.averageTicket ?? null,
    ),
    sellerBiReferenceRow(
      'seller_bi.margem_contribuicao_percent',
      reference?.contributionMarginPercent ?? null,
    ),
  ];
}

function buildOrderCountInvestigation(
  persistedOrders: number,
  reference: MercadoLivreMetricsManualReference | null,
): MercadoLivreMetricsReconciliationReport['orderCountInvestigation'] {
  if (!reference) {
    return {
      persistedOrders,
      panelSalesReference: null,
      difference: null,
      conclusion: 'NO_REFERENCE',
      explanation: 'Não existe referência manual cadastrada para a data.',
    };
  }
  return {
    persistedOrders,
    panelSalesReference: reference.salesQuantity,
    difference: null,
    conclusion: 'NOT_COMPARABLE_DIFFERENT_SEMANTICS',
    explanation:
      'Orders persistidas são um diagnóstico operacional e não são comparáveis diretamente à Quantidade de Vendas do Seller Metrics.',
  };
}

function operationalDiagnosticRow(
  metric: string,
  calculated: number | string | null,
  explanation: string,
): ReconciliationRow {
  return {
    metric,
    calculated,
    reference: null,
    difference: null,
    status: 'OPERATIONAL_DIAGNOSTIC',
    explanation,
  };
}

function sellerBiReferenceRow(
  metric: string,
  reference: number | string | null,
): ReconciliationRow {
  return {
    metric,
    calculated: null,
    reference,
    difference: null,
    status: reference === null ? 'NO_REFERENCE' : 'SELLER_BI_REFERENCE',
    explanation:
      'Métrica de BI com semântica Seller Metrics; MarketplaceOrder/DailySalesSummary não é sua fonte direta.',
  };
}

function buildBreakdown(
  orders: PersistedOrder[],
  getStatus: (order: PersistedOrder) => string,
): OrderStatusBreakdown[] {
  const groups = new Map<string, MutableBreakdown>();
  for (const order of orders) {
    const status = getStatus(order);
    const group = groups.get(status) ?? {
      orders: 0,
      units: 0,
      amounts: new Map<string, Prisma.Decimal>(),
    };
    group.orders += 1;
    group.units += order.items.reduce((total, item) => total + item.quantity, 0);
    addAmount(group.amounts, order.currency, order.grossAmount);
    groups.set(status, group);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([status, group]) => ({
      status,
      orders: group.orders,
      units: group.units,
      grossAmountByCurrency: serializeAmounts(group.amounts),
    }));
}

function amountsByCurrency<T extends { currency: string }>(
  values: T[],
  getAmount: (value: T) => Prisma.Decimal,
): CurrencyAmount[] {
  const amounts = new Map<string, Prisma.Decimal>();
  for (const value of values) {
    addAmount(amounts, value.currency, getAmount(value));
  }
  return serializeAmounts(amounts);
}

function addAmount(
  amounts: Map<string, Prisma.Decimal>,
  currency: string,
  amount: Prisma.Decimal,
): void {
  amounts.set(
    currency,
    (amounts.get(currency) ?? new Prisma.Decimal(0)).plus(amount),
  );
}

function serializeAmounts(
  amounts: Map<string, Prisma.Decimal>,
): CurrencyAmount[] {
  return [...amounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, amount]) => ({ currency, amount: amount.toFixed(2) }));
}

function singleBrlAmount(amounts: CurrencyAmount[]): string | null {
  return amounts.length === 1 && amounts[0]?.currency === 'BRL'
    ? amounts[0].amount
    : null;
}

function sumUnits(orders: PersistedOrder[]): number {
  return orders.reduce(
    (total, order) =>
      total + order.items.reduce((sum, item) => sum + item.quantity, 0),
    0,
  );
}

function minimumDate(values: Date[]): Date | null {
  return values.length === 0
    ? null
    : new Date(Math.min(...values.map((value) => value.getTime())));
}

function maximumDate(values: Date[]): Date | null {
  return values.length === 0
    ? null
    : new Date(Math.max(...values.map((value) => value.getTime())));
}

function nextCalendarDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + 1))
    .toISOString()
    .slice(0, 10);
}

interface OfficialApiCallResult<T> {
  data: T | null;
  error: MercadoLivreClientError | null;
}

async function captureOfficialApiCall<T>(
  operation: () => Promise<T>,
): Promise<OfficialApiCallResult<T>> {
  try {
    return { data: await operation(), error: null };
  } catch (error: unknown) {
    if (error instanceof MercadoLivreClientError) {
      return { data: null, error };
    }
    throw error;
  }
}

function availabilityOf(
  error: MercadoLivreClientError | null,
): OfficialApiAvailability {
  return error
    ? {
        status: 'UNAVAILABLE',
        errorCode: error.code,
        ...(error.statusCode ? { httpStatus: error.statusCode } : {}),
        message: error.message,
      }
    : { status: 'AVAILABLE' };
}

function officialApiFailureExplanation(
  resource: string,
  error: MercadoLivreClientError,
): string {
  const status = error.statusCode ? ` HTTP ${error.statusCode}` : '';
  return `A consulta oficial de ${resource} falhou (${error.code}${status}); nenhum corpo de resposta ou credencial foi registrado.`;
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]!);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, values.length) },
      async () => worker(),
    ),
  );
  return results;
}
