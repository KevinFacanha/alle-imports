import { Module } from '@nestjs/common';

import { OAuthStateStore } from './oauth-state.store.js';
import { TokenEncryptionService } from './token-encryption.service.js';

@Module({
  providers: [OAuthStateStore, TokenEncryptionService],
  exports: [OAuthStateStore, TokenEncryptionService],
})
export class OAuthSecurityModule {}
