import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { JwtPayload } from './auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET', 'change-me-secret'),
      issuer: undefined,
      audience: undefined,
    });
  }

  async validate(payload: JwtPayload): Promise<any> {
    if (payload.isDevice) {
      // Device tokens are valid as-is (verified by device token lookup in services)
      return {
        id: payload.sub,
        role: 'DEVICE',
        tenantId: payload.tenantId,
        isDevice: true,
        isActive: true,
      };
    }

    const user = await this.userRepository.findOne({
      where: { id: payload.sub, tenantId: payload.tenantId },
      select: ['id', 'email', 'role', 'isActive', 'tenantId'],
    });

    if (!user) throw new UnauthorizedException('User not found');
    if (!user.isActive) throw new UnauthorizedException('User account is inactive');

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      isActive: user.isActive,
      isDevice: false,
    };
  }
}
