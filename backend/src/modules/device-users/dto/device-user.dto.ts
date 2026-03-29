import { IsString, IsNotEmpty, IsOptional, IsEnum, IsUrl, Matches } from 'class-validator'
import { DeviceUserStatus } from '../entities/device-user.entity'

export class CreateDeviceUserDto {
  @IsString()
  @IsNotEmpty()
  username: string

  @IsString()
  @IsNotEmpty()
  fullName: string

  @Matches(/^\d{4,6}$/, { message: 'PIN must be 4-6 digits' })
  pin: string

  @IsOptional()
  @IsString()
  department?: string

  @IsOptional()
  @IsString()
  jobTitle?: string

  @IsOptional()
  @IsUrl()
  photoUrl?: string
}

export class UpdateDeviceUserDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  username?: string

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  fullName?: string

  @IsOptional()
  @IsString()
  department?: string

  @IsOptional()
  @IsString()
  jobTitle?: string

  @IsOptional()
  @IsUrl()
  photoUrl?: string
}

export class UpdatePinDto {
  @Matches(/^\d{4,6}$/, { message: 'PIN must be 4-6 digits' })
  pin: string
}

export class UpdateDeviceUserStatusDto {
  @IsEnum(DeviceUserStatus)
  status: DeviceUserStatus
}
