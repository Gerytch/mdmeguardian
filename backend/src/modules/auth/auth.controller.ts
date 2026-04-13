import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  HttpException,
  Request,
  Headers,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** POST /api/v1/auth/login — requires X-Tenant-ID header */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ global: { ttl: 60000, limit: 10 } })
  login(
    @Body() dto: LoginDto,
    @Headers('x-tenant-id') tenantId: string,
  ) {
    return this.authService.login(dto, tenantId);
  }

  /** POST /api/v1/auth/register — disabled (single-tenant deployment) */
  @Public()
  @Post('register')
  @HttpCode(HttpStatus.GONE)
  register() {
    throw new HttpException('Registration is disabled on this instance', HttpStatus.GONE);
  }

  /** POST /api/v1/auth/refresh */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshToken(dto.refreshToken);
  }

  /** POST /api/v1/auth/device/login — device token exchange */
  @Public()
  @Post('device/login')
  @HttpCode(HttpStatus.OK)
  deviceLogin(@Headers('x-device-token') token: string) {
    return this.authService.deviceLogin(token);
  }

  /** GET /api/v1/auth/me */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMe(@Request() req: any) {
    return this.authService.getProfile(req.user.id);
  }
}
