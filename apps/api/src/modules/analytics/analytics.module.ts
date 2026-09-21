import { Module } from '@nestjs/common';

import { OlistModule } from '../integrations/olist/olist.module.js';
import { MercadoLivreModule } from '../marketplaces/mercado-livre/mercado-livre.module.js';
import { DailySalesSummaryService } from './application/daily-sales-summary.service.js';
import { MercadoLivreMetricsReconciliationService } from './application/mercado-livre-metrics-reconciliation.service.js';
import {
  createGeFinanceProvider,
  GEFINANCE_PROVIDER_FACTORY,
  SellerMetricsReconciliationService,
} from './application/seller-metrics-reconciliation.service.js';

@Module({
  imports: [MercadoLivreModule, OlistModule],
  providers: [
    DailySalesSummaryService,
    MercadoLivreMetricsReconciliationService,
    SellerMetricsReconciliationService,
    {
      provide: GEFINANCE_PROVIDER_FACTORY,
      useValue: createGeFinanceProvider,
    },
  ],
  exports: [
    DailySalesSummaryService,
    MercadoLivreMetricsReconciliationService,
    SellerMetricsReconciliationService,
  ],
})
export class AnalyticsModule {}
