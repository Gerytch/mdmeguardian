import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './jwt-auth.guard';

/**
 * Ensures the authenticated user belongs to the tenant in the URL.
 * Must run AFTER JwtAuthGuard so req.user is populated.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const tenantId = request.params?.tenantId;

    // Route has no :tenantId param — skip
    if (!tenantId) return true;
    // No user (should have been caught by JwtAuthGuard) — skip
    if (!user) return true;
    // Device tokens may operate cross-tenant routes (e.g. /device/commands)
    if (user.isDevice) return true;

    if (user.tenantId !== tenantId) {
      throw new ForbiddenException('Access to this tenant is not allowed');
    }

    return true;
  }
}
