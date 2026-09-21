import { Controller, Get, Query } from '@nestjs/common';

import {
  DailySellerMetricsQueryService,
  DailySellerMetricsRangeResponse,
  DailySellerMetricsResponse,
} from '../application/daily-seller-metrics-query.service.js';
import {
  DailySellerMetricsQueryDto,
  DailySellerMetricsRangeQueryDto,
} from './seller-metrics-query.dto.js';

@Controller('analytics/seller-metrics/daily')
export class SellerMetricsController {
  constructor(private readonly queryService: DailySellerMetricsQueryService) {}

  @Get()
  findDaily(
    @Query() query: DailySellerMetricsQueryDto,
  ): Promise<DailySellerMetricsResponse> {
    return this.queryService.findDaily(query.marketplaceAccountId, query.date);
  }

  @Get('range')
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
