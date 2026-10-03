import { Controller, Get, Query } from '@nestjs/common';

import {
  NoSaleListingsResponse,
  NoSaleListingsService,
} from '../application/no-sale-listings.service.js';

import {
  ProductIntelligenceComparisonResponse,
  ProductIntelligenceProductsResponse,
  ProductIntelligenceRankingsResponse,
  ProductIntelligenceService,
} from '../application/product-intelligence.service.js';
import { NoSaleListingsQueryDto } from './no-sale-listings-query.dto.js';

@Controller('analytics/product-intelligence')
export class ProductIntelligenceController {
  constructor(
    private readonly productIntelligence: ProductIntelligenceService,
    private readonly noSaleListings: NoSaleListingsService,
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
  findNoSaleAlerts(
    @Query() query: NoSaleListingsQueryDto,
  ): Promise<NoSaleListingsResponse> {
    return this.noSaleListings.find(query);
  }
}
