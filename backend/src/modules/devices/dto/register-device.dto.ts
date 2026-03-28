import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class RegisterDeviceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  serialNumber: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  imei?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  androidVersion?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  manufacturer?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  model?: string;

  @IsUUID()
  @IsOptional()
  policyId?: string;
}

export class EnrollDeviceDto extends RegisterDeviceDto {
  @IsString()
  @IsNotEmpty()
  enrollmentToken: string;
}
