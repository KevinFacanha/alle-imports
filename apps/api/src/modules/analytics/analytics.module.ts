import { Module } from '@nestjs/common';

import { MercadoLivreModule } from '../marketplaces/mercado-livre/mercado-livre.module.js';
import { DailySalesSummaryService } from './application/daily-sales-summary.service.js';
import { MercadoLivreMetricsReconciliationService } from './application/mercado-livre-metrics-reconciliation.service.js';

@Module({
  imports: [MercadoLivreModule],
  providers: [
    DailySalesSummaryService,
    MercadoLivreMetricsReconciliationService,
  ],
  exports: [
    DailySalesSummaryService,
    MercadoLivreMetricsReconciliationService,
  ],
})
export class AnalyticsModule {}
