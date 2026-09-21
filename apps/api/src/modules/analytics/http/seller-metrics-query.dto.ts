import { IsDateString, IsUUID, Matches } from 'class-validator';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class DailySellerMetricsQueryDto {
  @IsUUID()
  marketplaceAccountId!: string;

  @Matches(DATE_ONLY_PATTERN, { message: 'date must use YYYY-MM-DD' })
  @IsDateString({ strict: true }, { message: 'date must be a valid date' })
  date!: string;
}

export class DailySellerMetricsRangeQueryDto {
  @IsUUID()
  marketplaceAccountId!: string;

  @Matches(DATE_ONLY_PATTERN, { message: 'from must use YYYY-MM-DD' })
  @IsDateString({ strict: true }, { message: 'from must be a valid date' })
  from!: string;

  @Matches(DATE_ONLY_PATTERN, { message: 'to must use YYYY-MM-DD' })
  @IsDateString({ strict: true }, { message: 'to must be a valid date' })
  to!: string;
}
