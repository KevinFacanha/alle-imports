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
import {
  X1ProductIntelligenceResponse,
  X1ProductIntelligenceService,
} from '../application/x1-product-intelligence.service.js';
import { NoSaleListingsQueryDto } from './no-sale-listings-query.dto.js';
import { X1ProductIntelligenceQueryDto } from './x1-product-intelligence-query.dto.js';

@Controller('analytics/product-intelligence')
export class ProductIntelligenceController {
  constructor(
    private readonly productIntelligence: ProductIntelligenceService,
    private readonly noSaleListings: NoSaleListingsService,
    private readonly x1ProductIntelligence: X1ProductIntelligenceService,
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

  @Get('x1')
  findX1(
    @Query() query: X1ProductIntelligenceQueryDto,
  ): Promise<X1ProductIntelligenceResponse> {
    return this.x1ProductIntelligence.find(query.days);
  }

  @Get('alerts/no-sale')
  findNoSaleAlerts(
    @Query() query: NoSaleListingsQueryDto,
  ): Promise<NoSaleListingsResponse> {
    return this.noSaleListings.find(query);
  }
}
