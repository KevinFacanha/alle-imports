import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export enum NoSaleListingsAccount {
  C1 = 'C1',
  C2 = 'C2',
  All = 'ALL',
}

export enum NoSaleListingStatusFilter {
  Active = 'ACTIVE',
  Paused = 'PAUSED',
  Inactive = 'INACTIVE',
  All = 'ALL',
}

export class NoSaleListingsQueryDto {
  @IsOptional()
  @IsEnum(NoSaleListingsAccount)
  account: NoSaleListingsAccount = NoSaleListingsAccount.All;

  @IsOptional()
  @Type(() => Number)
  @IsIn([30, 60, 90])
  days: 30 | 60 | 90 = 30;

  @IsOptional()
  @IsEnum(NoSaleListingStatusFilter)
  listingStatus: NoSaleListingStatusFilter =
    NoSaleListingStatusFilter.Active;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}
