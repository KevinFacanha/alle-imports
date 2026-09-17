import { Module } from '@nestjs/common';

import { DailySalesSummaryService } from './application/daily-sales-summary.service.js';

@Module({
  providers: [DailySalesSummaryService],
  exports: [DailySalesSummaryService],
})
export class AnalyticsModule {}
