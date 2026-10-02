import { Controller, Get } from '@nestjs/common';

import {
  ProductIntelligenceAlertsResponse,
  ProductIntelligenceComparisonResponse,
  ProductIntelligenceProductsResponse,
  ProductIntelligenceRankingsResponse,
  ProductIntelligenceService,
} from '../application/product-intelligence.service.js';

@Controller('analytics/product-intelligence')
export class ProductIntelligenceController {
  constructor(
    private readonly productIntelligence: ProductIntelligenceService,
  ) {}

  @Get('products')
  findProducts(): Promise<ProductIntelligenceProductsResponse> {
    return this.productIntelligence.findProducts();
  }

  @Get('rankings')
  findRankings(): Promise<ProductIntelligenceRankingsResponse> {
    return this.productIntelligence.findRankings();
  }

  @Get('comparison/c1-c2')
  findComparison(): Promise<ProductIntelligenceComparisonResponse> {
    return this.productIntelligence.findComparison();
  }

  @Get('alerts/no-sale')
  findNoSaleAlerts(): Promise<ProductIntelligenceAlertsResponse> {
    return this.productIntelligence.findNoSaleAlerts();
  }
}
