import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { TenantGuard } from './common/guards/tenant.guard';

import { AuthModule } from './modules/auth/auth.module';
import { TenantModule } from './modules/tenants/tenant.module';
import { UsersModule } from './modules/users/users.module';
import { DevicesModule } from './modules/devices/devices.module';
import { AppsModule } from './modules/apps/apps.module';
import { PoliciesModule } from './modules/policies/policies.module';
import { GeolocationModule } from './modules/geolocation/geolocation.module';
import { CommandsModule } from './modules/commands/commands.module';
import { DeviceUsersModule } from './modules/device-users/device-users.module';
import { DeviceSessionsModule } from './modules/device-sessions/device-sessions.module';
import { DeviceUserAuthModule } from './modules/device-user-auth/device-user-auth.module';
import { DeviceGroupsModule } from './modules/device-groups/device-groups.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('DATABASE_HOST', 'localhost'),
        port: config.get<number>('DATABASE_PORT', 5432),
        username: config.get('DATABASE_USER', 'mdm_user'),
        password: config.get('DATABASE_PASSWORD', 'mdm_password'),
        database: config.get('DATABASE_NAME', 'mdm_saas'),
        autoLoadEntities: true,
        synchronize: config.get('NODE_ENV') !== 'production',
        logging: config.get('NODE_ENV') === 'development',
        extra: {
          max: 20,
          min: 5,
          idleTimeoutMillis: 30000,
        },
      }),
    }),

    ScheduleModule.forRoot(),

    ThrottlerModule.forRoot([
      { name: 'global', ttl: 60000, limit: 500 },
    ]),

    AuthModule,
    TenantModule,
    UsersModule,
    DevicesModule,
    AppsModule,
    PoliciesModule,
    GeolocationModule,
    CommandsModule,
    DeviceUsersModule,
    DeviceSessionsModule,
    DeviceUserAuthModule,
    DeviceGroupsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
  ],
})
export class AppModule {}
