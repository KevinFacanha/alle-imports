export interface MercadoLivreTokenResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: string | null;
  scope: string | null;
  expiresIn: number;
}

export interface MercadoLivreUser {
  id: string;
  name: string;
}

export type MercadoLivreOAuthErrorCode =
  | 'INVALID_GRANT'
  | 'INVALID_RESPONSE'
  | 'REQUEST_FAILED'
  | 'TIMEOUT';

export class MercadoLivreOAuthError extends Error {
  constructor(
    readonly code: MercadoLivreOAuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MercadoLivreOAuthError';
  }
}
