import { Module } from '@nestjs/common';

import { OlistModule } from '../integrations/olist/olist.module.js';
import { MercadoLivreModule } from '../marketplaces/mercado-livre/mercado-livre.module.js';
import { DailySalesSummaryService } from './application/daily-sales-summary.service.js';
import { DailySellerMetricsBackfillService } from './application/daily-seller-metrics-backfill.service.js';
import { DailySellerMetricsPersistenceService } from './application/daily-seller-metrics-persistence.service.js';
import { DailySellerMetricsQueryService } from './application/daily-seller-metrics-query.service.js';
import { GeFinanceImportService } from './application/gefinance-import.service.js';
import { MercadoLivreMetricsReconciliationService } from './application/mercado-livre-metrics-reconciliation.service.js';
import { SellerBiMetricResolver } from './application/seller-bi-metric.resolver.js';
import {
  createGeFinanceProvider,
  GEFINANCE_PROVIDER_FACTORY,
  SellerMetricsReconciliationService,
} from './application/seller-metrics-reconciliation.service.js';
import { SellerMetricsController } from './http/seller-metrics.controller.js';

@Module({
  imports: [MercadoLivreModule, OlistModule],
  controllers: [SellerMetricsController],
  providers: [
    DailySalesSummaryService,
    DailySellerMetricsBackfillService,
    DailySellerMetricsPersistenceService,
    DailySellerMetricsQueryService,
    GeFinanceImportService,
    MercadoLivreMetricsReconciliationService,
    SellerBiMetricResolver,
    SellerMetricsReconciliationService,
    {
      provide: GEFINANCE_PROVIDER_FACTORY,
      useValue: createGeFinanceProvider,
    },
  ],
  exports: [
    DailySalesSummaryService,
    DailySellerMetricsBackfillService,
    DailySellerMetricsPersistenceService,
    GeFinanceImportService,
    MercadoLivreMetricsReconciliationService,
    SellerBiMetricResolver,
    SellerMetricsReconciliationService,
  ],
})
export class AnalyticsModule {}
