import { IsEnum, IsOptional, IsString, IsUUID, IsBoolean, IsArray, IsInt, Min, Max, MaxLength } from 'class-validator';
import { DeviceStatus } from '../entities/device.entity';

export class UpdateDeviceDto {
  @IsString()
  @IsOptional()
  @MaxLength(255)
  name?: string;

  @IsEnum(DeviceStatus)
  @IsOptional()
  status?: DeviceStatus;

  @IsUUID()
  @IsOptional()
  policyId?: string;

  @IsUUID()
  @IsOptional()
  currentUserId?: string;

  @IsBoolean()
  @IsOptional()
  isKioskMode?: boolean;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  kioskApps?: string[];

  @IsString()
  @IsOptional()
  @MaxLength(20)
  osVersion?: string;
}

export class DeviceHeartbeatDto {
  @IsInt()
  @Min(0)
  @Max(100)
  @IsOptional()
  batteryLevel?: number;

  @IsBoolean()
  @IsOptional()
  isOnline?: boolean;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  osVersion?: string;
}
