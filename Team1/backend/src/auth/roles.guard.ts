import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { JwtUser } from './interfaces/jwt-user.interface';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass()
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: JwtUser; ip?: string }>();
    if (!request.user || !requiredRoles.includes(request.user.role)) {
      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          userId: request.user?.sub ?? null,
          action: 'ACCESS_DENIED',
          result: 'DENY',
          ip: request.ip ?? 'unknown'
        })
      );
      throw new ForbiddenException('Access denied');
    }

    return true;
  }
}
