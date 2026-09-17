import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MarketplaceOrderStatus,
  Prisma,
} from '@prisma/client';

import { EnvironmentVariables } from '../../../config/environment.validation.js';
import { DatabaseService } from '../../../database/database.service.js';

export interface DailySalesSummaryParams {
  marketplaceAccountId: string;
  date: string;
}

export interface DailySalesStatusBreakdown {
  status: MarketplaceOrderStatus;
  orders: number;
  grossAmount: Prisma.Decimal;
}

export interface DailySalesSummary {
  date: string;
  marketplaceAccountId: string;
  currency: string | null;
  totalOrders: number;
  totalUnits: number;
  cancelledOrders: number;
  refundedOrders: number;
  partiallyRefundedOrders: number;
  marketplaceGrossAmount: Prisma.Decimal;
  cancelledGrossAmount: Prisma.Decimal;
  nonCancelledGrossAmount: Prisma.Decimal;
  averageTicket: Prisma.Decimal;
  statusBreakdown: DailySalesStatusBreakdown[];
}

export type DailySalesSummaryErrorCode =
  | 'INVALID_DATE'
  | 'ACCOUNT_NOT_FOUND'
  | 'MIXED_CURRENCIES';

export class DailySalesSummaryError extends Error {
  constructor(
    readonly code: DailySalesSummaryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DailySalesSummaryError';
  }
}

interface StatusAccumulator {
  orders: number;
  grossAmount: Prisma.Decimal;
}

const ZERO = '0';

@Injectable()
export class DailySalesSummaryService {
  private readonly businessTimeZone: string;

  constructor(
    private readonly database: DatabaseService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.businessTimeZone = config.get('BUSINESS_TIMEZONE', { infer: true });
  }

  async summarize(
    params: DailySalesSummaryParams,
  ): Promise<DailySalesSummary> {
    const interval = localDayToUtcInterval(
      params.date,
      this.businessTimeZone,
    );
    const account = await this.database.marketplaceAccount.findUnique({
      where: { id: params.marketplaceAccountId },
      select: { id: true },
    });

    if (!account) {
      throw new DailySalesSummaryError(
        'ACCOUNT_NOT_FOUND',
        'Marketplace account was not found.',
      );
    }

    const orderWhere = {
      marketplaceAccountId: params.marketplaceAccountId,
      soldAt: {
        gte: interval.start,
        lt: interval.end,
      },
    } satisfies Prisma.MarketplaceOrderWhereInput;

    // Pedidos e itens são consultados separadamente para que cada pedido
    // contribua uma única vez aos valores monetários e às contagens.
    const [orders, itemQuantity] = await Promise.all([
      this.database.marketplaceOrder.findMany({
        where: orderWhere,
        select: {
          normalizedStatus: true,
          currency: true,
          grossAmount: true,
        },
      }),
      this.database.marketplaceOrderItem.aggregate({
        where: { marketplaceOrder: { is: orderWhere } },
        _sum: { quantity: true },
      }),
    ]);

    const currencies = new Set(orders.map((order) => order.currency));
    if (currencies.size > 1) {
      throw new DailySalesSummaryError(
        'MIXED_CURRENCIES',
        'Daily sales summary cannot combine orders with different currencies.',
      );
    }

    const byStatus = new Map<MarketplaceOrderStatus, StatusAccumulator>();
    let marketplaceGrossAmount = decimalZero();
    let cancelledGrossAmount = decimalZero();
    let nonCancelledGrossAmount = decimalZero();
    let nonCancelledOrders = 0;

    for (const order of orders) {
      marketplaceGrossAmount = marketplaceGrossAmount.plus(order.grossAmount);
      const statusTotal = byStatus.get(order.normalizedStatus) ?? {
        orders: 0,
        grossAmount: decimalZero(),
      };
      statusTotal.orders += 1;
      statusTotal.grossAmount = statusTotal.grossAmount.plus(order.grossAmount);
      byStatus.set(order.normalizedStatus, statusTotal);

      if (order.normalizedStatus === MarketplaceOrderStatus.CANCELLED) {
        cancelledGrossAmount = cancelledGrossAmount.plus(order.grossAmount);
      }
      if (
        order.normalizedStatus !== MarketplaceOrderStatus.CANCELLED &&
        order.normalizedStatus !== MarketplaceOrderStatus.REFUNDED
      ) {
        nonCancelledGrossAmount = nonCancelledGrossAmount.plus(
          order.grossAmount,
        );
        nonCancelledOrders += 1;
      }
    }

    const averageTicket =
      nonCancelledOrders === 0
        ? decimalZero()
        : nonCancelledGrossAmount.div(nonCancelledOrders);

    return {
      date: params.date,
      marketplaceAccountId: params.marketplaceAccountId,
      currency: currencies.values().next().value ?? null,
      totalOrders: orders.length,
      totalUnits: itemQuantity._sum.quantity ?? 0,
      cancelledOrders: countStatus(byStatus, MarketplaceOrderStatus.CANCELLED),
      refundedOrders: countStatus(byStatus, MarketplaceOrderStatus.REFUNDED),
      partiallyRefundedOrders: countStatus(
        byStatus,
        MarketplaceOrderStatus.PARTIALLY_REFUNDED,
      ),
      marketplaceGrossAmount,
      cancelledGrossAmount,
      nonCancelledGrossAmount,
      averageTicket,
      statusBreakdown: Object.values(MarketplaceOrderStatus)
        .filter((status) => byStatus.has(status))
        .map((status) => ({
          status,
          orders: byStatus.get(status)!.orders,
          grossAmount: byStatus.get(status)!.grossAmount,
        })),
    };
  }
}

function countStatus(
  totals: Map<MarketplaceOrderStatus, StatusAccumulator>,
  status: MarketplaceOrderStatus,
): number {
  return totals.get(status)?.orders ?? 0;
}

function decimalZero(): Prisma.Decimal {
  return new Prisma.Decimal(ZERO);
}

interface UtcInterval {
  start: Date;
  end: Date;
}

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

export function localDayToUtcInterval(
  date: string,
  timeZone: string,
): UtcInterval {
  const startParts = parseLocalDate(date);
  const nextDate = new Date(
    Date.UTC(startParts.year, startParts.month - 1, startParts.day + 1),
  );
  const endParts: LocalDateParts = {
    year: nextDate.getUTCFullYear(),
    month: nextDate.getUTCMonth() + 1,
    day: nextDate.getUTCDate(),
  };

  return {
    start: localMidnightToUtc(startParts, timeZone),
    end: localMidnightToUtc(endParts, timeZone),
  };
}

function parseLocalDate(value: string): LocalDateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  const day = Number(match?.[3]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  if (
    !match ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth
  ) {
    throw new DailySalesSummaryError(
      'INVALID_DATE',
      'date must be a valid calendar date in YYYY-MM-DD format.',
    );
  }

  return { year, month, day };
}

function localMidnightToUtc(parts: LocalDateParts, timeZone: string): Date {
  const targetAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day);
  let candidate = targetAsUtc;

  // Recalcular o offset resolve mudanças de horário da zona entre a primeira
  // aproximação em UTC e a meia-noite local desejada.
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const represented = datePartsInTimeZone(new Date(candidate), timeZone);
    const representedAsUtc = Date.UTC(
      represented.year,
      represented.month - 1,
      represented.day,
      represented.hour,
      represented.minute,
      represented.second,
    );
    candidate = targetAsUtc - (representedAsUtc - candidate);
  }

  return new Date(candidate);
}

function datePartsInTimeZone(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const values = new Map(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );

  return {
    year: values.get('year')!,
    month: values.get('month')!,
    day: values.get('day')!,
    hour: values.get('hour')!,
    minute: values.get('minute')!,
    second: values.get('second')!,
  };
}
