import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common'
import { IsString, IsNotEmpty, IsOptional, IsArray, ValidateNested, IsDateString } from 'class-validator'
import { Type } from 'class-transformer'
import { Throttle } from '@nestjs/throttler'
import { Public } from '../../common/decorators/public.decorator'
import { DeviceUserAuthService } from './device-user-auth.service'

class LoginDto {
  @IsString() @IsNotEmpty() username: string
  @IsString() @IsNotEmpty() pin: string
}

class LogoutDto {
  @IsString() @IsNotEmpty() sessionId: string
  @IsOptional() @IsString() reason?: string
}

class OfflineSessionDto {
  @IsString() @IsNotEmpty() offlineSessionId: string
  @IsString() @IsNotEmpty() deviceUserId: string
  @IsDateString() startedAt: string
  @IsOptional() @IsDateString() endedAt?: string
  @IsOptional() @IsString() endedReason?: string
  @IsOptional() @IsString() status?: string
}

class SyncOfflineDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OfflineSessionDto)
  sessions: OfflineSessionDto[]
}

@Controller('device/user-auth')
export class DeviceUserAuthController {
  constructor(private readonly deviceUserAuthService: DeviceUserAuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ global: { ttl: 60000, limit: 5 } })
  login(
    @Headers('x-device-token') deviceToken: string,
    @Body() dto: LoginDto,
  ) {
    return this.deviceUserAuthService.loginDeviceUser(deviceToken, dto.username, dto.pin)
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(
    @Headers('x-device-token') deviceToken: string,
    @Body() dto: LogoutDto,
  ): Promise<void> {
    return this.deviceUserAuthService.logoutDeviceUser(deviceToken, dto.sessionId, dto.reason)
  }

  @Public()
  @Patch('session/:sessionId/timeout')
  @HttpCode(HttpStatus.NO_CONTENT)
  timeout(
    @Headers('x-device-token') deviceToken: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ): Promise<void> {
    return this.deviceUserAuthService.timeoutSession(deviceToken, sessionId)
  }

  @Public()
  @Get('users')
  getDeviceUsers(@Headers('x-device-token') deviceToken: string) {
    return this.deviceUserAuthService.getDeviceUsers(deviceToken)
  }

  @Public()
  @Post('sync-offline')
  @HttpCode(HttpStatus.OK)
  syncOffline(
    @Headers('x-device-token') deviceToken: string,
    @Body() dto: SyncOfflineDto,
  ) {
    return this.deviceUserAuthService.syncOfflineSessions(deviceToken, dto.sessions)
  }

  @Public()
  @Get('session/:sessionId/validate')
  @HttpCode(HttpStatus.OK)
  validate(
    @Headers('x-device-token') deviceToken: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ) {
    return this.deviceUserAuthService.validateSession(deviceToken, sessionId)
  }
}
