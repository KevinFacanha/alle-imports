import { Module } from '@nestjs/common';

import { MARKETPLACE_ORDERS_PROVIDER } from '../domain/marketplace-orders.provider.js';
import {
  ConfigMercadoLivreAccessTokenProvider,
  MERCADO_LIVRE_ACCESS_TOKEN_PROVIDER,
  MERCADO_LIVRE_FETCH,
  MERCADO_LIVRE_HTTP_TIMEOUT_MS,
  MercadoLivreClient,
} from './mercado-livre.client.js';
import { MercadoLivreOrdersProvider } from './mercado-livre-orders.provider.js';

@Module({
  providers: [
    ConfigMercadoLivreAccessTokenProvider,
    {
      provide: MERCADO_LIVRE_ACCESS_TOKEN_PROVIDER,
      useExisting: ConfigMercadoLivreAccessTokenProvider,
    },
    {
      provide: MERCADO_LIVRE_FETCH,
      useValue: globalThis.fetch,
    },
    {
      provide: MERCADO_LIVRE_HTTP_TIMEOUT_MS,
      useValue: 10_000,
    },
    MercadoLivreClient,
    MercadoLivreOrdersProvider,
    {
      provide: MARKETPLACE_ORDERS_PROVIDER,
      useExisting: MercadoLivreOrdersProvider,
    },
  ],
  exports: [MARKETPLACE_ORDERS_PROVIDER, MercadoLivreOrdersProvider],
})
export class MercadoLivreModule {}
