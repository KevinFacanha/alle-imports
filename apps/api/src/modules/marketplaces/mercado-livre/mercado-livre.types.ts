export interface MercadoLivreOrderItem {
  item: {
    id: string;
    variation_id?: string | number | null;
    seller_sku?: string | null;
    title?: string | null;
  };
  quantity: number;
  unit_price: number;
  /**
   * Total bruto/original do item para a quantidade comprada, antes de descontos.
   * Pode estar ausente em payloads antigos do Mercado Livre.
   */
  gross_price?: number | null;
}

export interface MercadoLivreOrder {
  id: string | number;
  status: string;
  date_created: string;
  currency_id: string;
  total_amount: number;
  cancel_detail?: {
    date?: string | null;
  } | null;
  order_items: MercadoLivreOrderItem[];
}

export interface MercadoLivreOrdersSearchResponse {
  results: MercadoLivreOrder[];
  paging: {
    total: number;
    offset: number;
    limit: number;
  };
}

export interface MercadoLivreOrdersSearchParams {
  seller: string;
  dateCreatedFrom: string;
  dateCreatedTo: string;
  offset: number;
  limit: number;
  sort: 'date_asc' | 'date_desc';
}

export interface MercadoLivreHttpResult<T> {
  data: T;
  partial: boolean;
}
