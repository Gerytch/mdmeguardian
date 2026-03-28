import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const ROLES_KEY = 'roles';
export enum Role {
  SUPER_ADMIN = 'SUPER_ADMIN',
  TENANT_ADMIN = 'TENANT_ADMIN',
  MANAGER = 'MANAGER',
  VIEWER = 'VIEWER',
  DEVICE = 'DEVICE',
}

const ROLE_HIERARCHY: Record<Role, number> = {
  [Role.SUPER_ADMIN]: 100,
  [Role.TENANT_ADMIN]: 80,
  [Role.MANAGER]: 60,
  [Role.VIEWER]: 40,
  [Role.DEVICE]: 20,
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles?.length) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) throw new ForbiddenException('No user context.');
    if (!user.isActive) throw new ForbiddenException('User account is inactive.');
    if (user.role === Role.SUPER_ADMIN) return true;

    const userLevel = ROLE_HIERARCHY[user.role as Role] ?? 0;
    const hasRole = requiredRoles.some((r) => userLevel >= (ROLE_HIERARCHY[r] ?? 0));

    if (!hasRole) {
      throw new ForbiddenException(`Requires roles: [${requiredRoles.join(', ')}]. Current: ${user.role}`);
    }

    return true;
  }
}
