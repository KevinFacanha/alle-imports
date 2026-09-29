export const MERCADO_LIVRE_ACCOUNT_EXTERNAL_IDS = {
  c1: '740458955',
  c2: '1196767962',
} as const;

export type MercadoLivreAccountAlias =
  keyof typeof MERCADO_LIVRE_ACCOUNT_EXTERNAL_IDS;
