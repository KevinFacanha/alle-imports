import { Module } from '@nestjs/common';

import { MercadoLivreModule } from '../../marketplaces/mercado-livre/mercado-livre.module.js';
import { OAuthSecurityModule } from '../oauth/oauth-security.module.js';
import { OlistAuthorizationService } from './olist-authorization.service.js';
import { OlistIntegrationConfigService } from './olist-integration-config.service.js';
import {
  OLIST_OAUTH_FETCH,
  OLIST_OAUTH_TIMEOUT_MS,
  OlistOAuthClient,
} from './olist-oauth.client.js';
import { OlistOAuthController } from './olist-oauth.controller.js';
import { OlistOAuthService } from './olist-oauth.service.js';
import {
  OLIST_ORDERS_FETCH,
  OLIST_ORDERS_REQUEST_INTERVAL_MS,
  OLIST_ORDERS_TIMEOUT_MS,
  OlistOrdersClient,
} from './olist-orders.client.js';
import { OlistOrdersInspectionService } from './olist-orders-inspection.service.js';

@Module({
  imports: [OAuthSecurityModule, MercadoLivreModule],
  controllers: [OlistOAuthController],
  providers: [
    OlistOAuthClient,
    OlistIntegrationConfigService,
    OlistOAuthService,
    OlistAuthorizationService,
    OlistOrdersClient,
    OlistOrdersInspectionService,
    {
      provide: OLIST_OAUTH_FETCH,
      useValue: globalThis.fetch,
    },
    {
      provide: OLIST_OAUTH_TIMEOUT_MS,
      useValue: 10_000,
    },
    {
      provide: OLIST_ORDERS_FETCH,
      useValue: globalThis.fetch,
    },
    {
      provide: OLIST_ORDERS_TIMEOUT_MS,
      useValue: 15_000,
    },
    {
      // 30 read requests/minute is the lowest documented Olist V3 plan limit.
      provide: OLIST_ORDERS_REQUEST_INTERVAL_MS,
      useValue: 2_100,
    },
  ],
  exports: [
    OlistAuthorizationService,
    OlistOAuthClient,
    OlistOrdersClient,
    OlistOrdersInspectionService,
  ],
})
export class OlistModule {}
