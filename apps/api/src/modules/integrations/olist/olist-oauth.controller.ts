import { Controller, Get, Query, Redirect } from '@nestjs/common';

import {
  ConnectedOlistAccount,
  OlistOAuthService,
} from './olist-oauth.service.js';

@Controller('auth/olist')
export class OlistOAuthController {
  constructor(private readonly oauthService: OlistOAuthService) {}

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
  ): Promise<ConnectedOlistAccount> {
    return this.oauthService.handleCallback(state, code, authorizationError);
  }
}
