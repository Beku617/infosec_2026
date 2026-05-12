import { Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ThrottlerGuard,
  ThrottlerModuleOptions,
  ThrottlerStorage,
  getOptionsToken,
  getStorageToken
} from '@nestjs/throttler';
import { Request } from 'express';

import { UsersService } from '../users/users.service';

@Injectable()
export class LoginThrottlerGuard extends ThrottlerGuard {
  constructor(
    @Inject(getOptionsToken()) options: ThrottlerModuleOptions,
    @Inject(getStorageToken()) storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly usersService: UsersService
  ) {
    super(options, storageService, reflector);
  }

  protected async shouldSkip(context: Parameters<ThrottlerGuard['shouldSkip']>[0]): Promise<boolean> {
    const skippedByBase = await super.shouldSkip(context);
    if (skippedByBase) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request & { body?: { username?: string } }>();
    const username = req.body?.username;
    if (!username) {
      return false;
    }

    const user = await this.usersService.findByUsername(username);
    if (!user) {
      return false;
    }

    await this.usersService.unlockIfExpired(user);
    return this.usersService.isCurrentlyLocked(user);
  }
}
