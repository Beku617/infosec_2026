import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

import { JwtUser } from './interfaces/jwt-user.interface';
import { IS_PUBLIC_KEY } from './public.decorator';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    if (isPublic) {
      return true;
    }

    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    const request = context.switchToHttp().getRequest<Request & { user?: JwtUser }>();

    if (!requiredRoles || requiredRoles.length === 0) {
      this.logAccessDenied(request, requiredRoles);
      throw new ForbiddenException('Access denied');
    }

    if (!request.user || !requiredRoles.includes(request.user.role)) {
      this.logAccessDenied(request, requiredRoles);
      throw new ForbiddenException('Access denied');
    }

    return true;
  }

  private logAccessDenied(
    request: Request & { user?: JwtUser },
    requiredRoles: string[] | undefined
  ): void {
    void request;
    void requiredRoles;
  }
}
