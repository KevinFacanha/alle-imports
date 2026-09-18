export interface OlistTokenResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: string | null;
  scope: string | null;
  expiresIn: number;
  refreshExpiresIn: number | null;
}

export interface OlistAccountIdentity {
  externalAccountId: string;
  name: string;
}

export type OlistOAuthErrorCode =
  | 'INVALID_GRANT'
  | 'INVALID_RESPONSE'
  | 'REQUEST_FAILED'
  | 'TIMEOUT';

export class OlistOAuthError extends Error {
  constructor(
    readonly code: OlistOAuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'OlistOAuthError';
  }
}
