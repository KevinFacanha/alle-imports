import { Controller, Get, Query } from '@nestjs/common';

import {
  DailySellerMetricsQueryService,
  DailySellerMetricsRangeResponse,
  DailySellerMetricsResponse,
  MarketplaceAccountSummaryResponse,
} from '../application/daily-seller-metrics-query.service.js';
import {
  DailySellerMetricsQueryDto,
  DailySellerMetricsRangeQueryDto,
} from './seller-metrics-query.dto.js';

@Controller('analytics/seller-metrics')
export class SellerMetricsController {
  constructor(private readonly queryService: DailySellerMetricsQueryService) {}

  @Get('accounts')
  findAccounts(): Promise<MarketplaceAccountSummaryResponse[]> {
    return this.queryService.findActiveAccounts();
  }

  @Get('daily')
  findDaily(
    @Query() query: DailySellerMetricsQueryDto,
  ): Promise<DailySellerMetricsResponse> {
    return this.queryService.findDaily(query.marketplaceAccountId, query.date);
  }

  @Get('daily/range')
  findRange(
    @Query() query: DailySellerMetricsRangeQueryDto,
  ): Promise<DailySellerMetricsRangeResponse> {
    return this.queryService.findRange(
      query.marketplaceAccountId,
      query.from,
      query.to,
    );
  }
}
