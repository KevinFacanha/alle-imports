import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';

import { EnvironmentVariables } from '../../../../config/environment.validation.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const FORMAT_VERSION = 'v1';

export class TokenEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenEncryptionError';
  }
}

@Injectable()
export class TokenEncryptionService {
  private readonly key: Buffer;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.key = decodeKey(config.getOrThrow('OAUTH_TOKEN_ENCRYPTION_KEY'));
  }

  encrypt(plaintext: string): string {
    if (plaintext.length === 0) {
      throw new TokenEncryptionError('Cannot encrypt an empty token.');
    }

    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authenticationTag = cipher.getAuthTag();

    return [
      FORMAT_VERSION,
      iv.toString('base64url'),
      authenticationTag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  decrypt(encrypted: string): string {
    try {
      const [version, ivEncoded, tagEncoded, ciphertextEncoded, extra] =
        encrypted.split('.');
      if (
        version !== FORMAT_VERSION ||
        !ivEncoded ||
        !tagEncoded ||
        !ciphertextEncoded ||
        extra !== undefined
      ) {
        throw new Error('Invalid encrypted token format.');
      }

      const iv = Buffer.from(ivEncoded, 'base64url');
      const authenticationTag = Buffer.from(tagEncoded, 'base64url');
      const ciphertext = Buffer.from(ciphertextEncoded, 'base64url');
      if (iv.length !== IV_LENGTH_BYTES || authenticationTag.length !== 16) {
        throw new Error('Invalid encrypted token metadata.');
      }

      const decipher = createDecipheriv(ALGORITHM, this.key, iv);
      decipher.setAuthTag(authenticationTag);
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new TokenEncryptionError('Encrypted token could not be decrypted.');
    }
  }
}

function decodeKey(encodedKey: string): Buffer {
  const trimmedKey = encodedKey.trim();
  let key: Buffer;

  if (/^[a-f\d]{64}$/i.test(trimmedKey)) {
    key = Buffer.from(trimmedKey, 'hex');
  } else {
    key = Buffer.from(trimmedKey, 'base64');
  }

  if (key.length !== KEY_LENGTH_BYTES) {
    throw new TokenEncryptionError(
      'OAUTH_TOKEN_ENCRYPTION_KEY must encode exactly 32 bytes.',
    );
  }

  return key;
}
