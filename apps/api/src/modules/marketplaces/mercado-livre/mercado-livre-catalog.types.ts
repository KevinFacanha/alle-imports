export interface MercadoLivreCatalogSearchResponse {
  results: string[] | null;
  scroll_id?: string | null;
}

export interface MercadoLivreCatalogAttribute {
  id: string | null;
  name?: string | null;
  value_name?: string | null;
}

export interface MercadoLivreCatalogVariation {
  id: string | number;
  seller_sku?: string | null;
  seller_custom_field?: string | null;
  attribute_combinations?: MercadoLivreCatalogAttribute[];
  attributes?: MercadoLivreCatalogAttribute[];
}

export interface MercadoLivreCatalogItem {
  id: string;
  title?: string | null;
  status?: string | null;
  seller_sku?: string | null;
  seller_custom_field?: string | null;
  attributes?: MercadoLivreCatalogAttribute[];
  variations?: MercadoLivreCatalogVariation[];
}

export interface MercadoLivreCatalogBulkApiResult {
  id: string;
  status_code: number;
  body?: unknown;
}

export interface MercadoLivreCatalogLegacyBulkApiResult {
  code: number;
  body: MercadoLivreCatalogItem;
}

export interface MercadoLivreCatalogBulkResult {
  id: string;
  statusCode: number;
  body?: MercadoLivreCatalogItem;
}
