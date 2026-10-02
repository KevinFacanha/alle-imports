import { Controller, Get, Query } from '@nestjs/common';

import {
  MlbSalesAbcReport,
  MlbSalesAbcService,
} from '../application/mlb-sales-abc.service.js';
import { MlbSalesAbcQueryDto } from './mlb-sales-abc-query.dto.js';

@Controller('analytics/mlb-abc')
export class MlbSalesAbcController {
  constructor(private readonly mlbSalesAbc: MlbSalesAbcService) {}

  @Get()
  find(
    @Query() query: MlbSalesAbcQueryDto,
  ): Promise<MlbSalesAbcReport> {
    return this.mlbSalesAbc.find(query);
  }
}
