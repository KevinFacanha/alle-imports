import { IsEnum, Matches } from 'class-validator';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export enum MlbSalesAbcScope {
  C1 = 'C1',
  C2 = 'C2',
  Consolidated = 'CONSOLIDATED',
}

export enum MlbSalesAbcMetric {
  Units = 'UNITS',
  GrossRevenue = 'GROSS_REVENUE',
}

export class MlbSalesAbcQueryDto {
  @Matches(DATE_ONLY_PATTERN, { message: 'start must use YYYY-MM-DD' })
  start!: string;

  @Matches(DATE_ONLY_PATTERN, { message: 'end must use YYYY-MM-DD' })
  end!: string;

  @IsEnum(MlbSalesAbcScope)
  scope!: MlbSalesAbcScope;

  @IsEnum(MlbSalesAbcMetric)
  metric!: MlbSalesAbcMetric;
}
