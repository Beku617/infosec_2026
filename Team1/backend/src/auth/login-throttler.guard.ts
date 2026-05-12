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

@Injectable()
export class LoginThrottlerGuard extends ThrottlerGuard {
  constructor(
    @Inject(getOptionsToken()) options: ThrottlerModuleOptions,
    @Inject(getStorageToken()) storageService: ThrottlerStorage,
    reflector: Reflector
  ) {
    super(options, storageService, reflector);
  }

  protected async getTracker(req: Request & { body?: { username?: string } }): Promise<string> {
    const rawUsername = req.body?.username;
    const normalizedUsername =
      typeof rawUsername === 'string' && rawUsername.trim().length > 0
        ? rawUsername.trim().toLowerCase()
        : 'unknown-user';
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown-ip';

    return `${ip}:${normalizedUsername}`;
  }
}
