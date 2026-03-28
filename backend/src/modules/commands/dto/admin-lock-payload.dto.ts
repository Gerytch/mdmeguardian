import {
  IsString,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsDateString,
  MaxLength,
  MinLength,
} from 'class-validator';

export enum AdminLockSeverity {
  INFO = 'info',
  WARNING = 'warning',
  CRITICAL = 'critical',
}

export class AdminLockPayloadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  message: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  contact?: string;

  @IsOptional()
  @IsBoolean()
  allowEmergencyOnly?: boolean;

  @IsOptional()
  @IsDateString()
  autoReleaseAt?: string;

  @IsOptional()
  @IsEnum(AdminLockSeverity)
  severity?: AdminLockSeverity;
}

export class SendMessagePayloadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  message: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string;
}
