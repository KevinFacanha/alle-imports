import {
  Controller,
  Get,
  Query,
  Redirect,
} from '@nestjs/common';

import {
  ConnectedMarketplaceAccount,
  MercadoLivreOAuthService,
} from './mercado-livre-oauth.service.js';

@Controller('auth/mercado-livre')
export class MercadoLivreOAuthController {
  constructor(private readonly oauthService: MercadoLivreOAuthService) {}

  @Get('connect')
  @Redirect(undefined, 302)
  connect(): { url: string; statusCode: number } {
    return {
      url: this.oauthService.createAuthorizationUrl(),
      statusCode: 302,
    };
  }

  @Get('callback')
  callback(
    @Query('state') state?: string,
    @Query('code') code?: string,
    @Query('error') authorizationError?: string,
  ): Promise<ConnectedMarketplaceAccount> {
    return this.oauthService.handleCallback(state, code, authorizationError);
  }
}
