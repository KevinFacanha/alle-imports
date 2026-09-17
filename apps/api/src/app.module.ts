import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { validateEnvironment } from './config/environment.validation.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { AnalyticsModule } from './modules/analytics/analytics.module.js';
import { MercadoLivreModule } from './modules/marketplaces/mercado-livre/mercado-livre.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      validate: validateEnvironment,
    }),
    DatabaseModule,
    HealthModule,
    AnalyticsModule,
    MercadoLivreModule,
  ],
})
export class AppModule {}
