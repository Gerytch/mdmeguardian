import { IsEmail, IsString, MinLength, MaxLength, Matches, IsNotEmpty } from 'class-validator';
import { Transform } from 'class-transformer';

export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  companyName: string;

  @IsString()
  @MinLength(3)
  @MaxLength(63)
  @Matches(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, {
    message: 'Slug must be lowercase letters, numbers, and hyphens only',
  })
  companySlug: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  firstName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  lastName: string;

  @IsEmail()
  @MaxLength(255)
  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase().trim() : value))
  email: string;

  @IsString()
  @MinLength(10)
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*]).{10,}$/, {
    message: 'Password must include uppercase, lowercase, number, and special character',
  })
  password: string;
}
