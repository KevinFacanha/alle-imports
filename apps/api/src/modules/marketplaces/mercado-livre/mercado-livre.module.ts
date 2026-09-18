import { Module } from '@nestjs/common';

import { OAuthSecurityModule } from '../../integrations/oauth/oauth-security.module.js';
import { OrdersIngestionService } from '../application/orders-ingestion.service.js';
import { MARKETPLACE_ORDERS_PROVIDER } from '../domain/marketplace-orders.provider.js';
import {
  MERCADO_LIVRE_ACCESS_TOKEN_PROVIDER,
  MERCADO_LIVRE_FETCH,
  MERCADO_LIVRE_HTTP_TIMEOUT_MS,
  MercadoLivreClient,
} from './mercado-livre.client.js';
import { MercadoLivreOrdersProvider } from './mercado-livre-orders.provider.js';
import {
  MERCADO_LIVRE_OAUTH_FETCH,
  MERCADO_LIVRE_OAUTH_TIMEOUT_MS,
  MercadoLivreOAuthClient,
} from './oauth/mercado-livre-oauth.client.js';
import { MercadoLivreOAuthController } from './oauth/mercado-livre-oauth.controller.js';
import { MercadoLivreOAuthService } from './oauth/mercado-livre-oauth.service.js';
import { MarketplaceAuthorizationService } from './oauth/marketplace-authorization.service.js';

@Module({
  imports: [OAuthSecurityModule],
  controllers: [MercadoLivreOAuthController],
  providers: [
    MercadoLivreOAuthClient,
    MercadoLivreOAuthService,
    MarketplaceAuthorizationService,
    {
      provide: MERCADO_LIVRE_ACCESS_TOKEN_PROVIDER,
      useExisting: MarketplaceAuthorizationService,
    },
    {
      provide: MERCADO_LIVRE_FETCH,
      useValue: globalThis.fetch,
    },
    {
      provide: MERCADO_LIVRE_HTTP_TIMEOUT_MS,
      useValue: 10_000,
    },
    {
      provide: MERCADO_LIVRE_OAUTH_FETCH,
      useValue: globalThis.fetch,
    },
    {
      provide: MERCADO_LIVRE_OAUTH_TIMEOUT_MS,
      useValue: 10_000,
    },
    MercadoLivreClient,
    MercadoLivreOrdersProvider,
    OrdersIngestionService,
    {
      provide: MARKETPLACE_ORDERS_PROVIDER,
      useExisting: MercadoLivreOrdersProvider,
    },
  ],
  exports: [
    MARKETPLACE_ORDERS_PROVIDER,
    MercadoLivreClient,
    MercadoLivreOrdersProvider,
    MarketplaceAuthorizationService,
    OrdersIngestionService,
  ],
})
export class MercadoLivreModule {}
