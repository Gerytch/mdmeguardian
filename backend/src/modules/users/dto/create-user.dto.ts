import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  MinLength,
  MaxLength,
} from 'class-validator';
import { UserRole } from '../entities/user.entity';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName: string;

  @IsEnum(UserRole)
  @IsOptional()
  role?: UserRole;

  @IsBoolean()
  @IsOptional()
  canAccessDevices?: boolean;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  deviceUsername?: string;

  @IsString()
  @IsOptional()
  @Length(4, 16)
  devicePin?: string;
}

export class UpdateUserDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  firstName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  lastName?: string;

  @IsEnum(UserRole)
  @IsOptional()
  role?: UserRole;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsBoolean()
  @IsOptional()
  canAccessDevices?: boolean;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  deviceUsername?: string;

  @IsString()
  @IsOptional()
  @Length(4, 16)
  devicePin?: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword: string;
}
