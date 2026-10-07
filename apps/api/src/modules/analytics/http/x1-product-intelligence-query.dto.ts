import { Type } from 'class-transformer';
import { IsIn } from 'class-validator';

export class X1ProductIntelligenceQueryDto {
  @Type(() => Number)
  @IsIn([30, 60, 90])
  days!: 30 | 60 | 90;
}
