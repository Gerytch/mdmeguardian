import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { TokenExpiredError, JsonWebTokenError } from 'jsonwebtoken';

export const IS_PUBLIC_KEY = 'isPublic';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, info: any): any {
    if (info instanceof TokenExpiredError) {
      throw new UnauthorizedException({ error: 'TOKEN_EXPIRED', message: 'Access token expired. Please refresh.' });
    }
    if (info instanceof JsonWebTokenError) {
      throw new UnauthorizedException({ error: 'INVALID_TOKEN', message: 'Invalid access token.' });
    }
    if (err || !user) {
      throw err || new UnauthorizedException('Authentication required.');
    }
    return user;
  }
}
