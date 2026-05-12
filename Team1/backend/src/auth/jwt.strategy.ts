import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';

import { JwtUser } from './interfaces/jwt-user.interface';

type JwtPayload = {
  userId: string;
  role: JwtUser['role'];
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    const jwtSecret = configService.get<string>('JWT_SECRET');
    if (!jwtSecret) {
      throw new UnauthorizedException('JWT_SECRET is not configured');
    }
    if (Buffer.byteLength(jwtSecret, 'utf8') < 32) {
      throw new UnauthorizedException('JWT_SECRET must be at least 32 bytes');
    }

    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: Request) => (request.cookies?.accessToken as string | undefined) ?? null
      ]),
      ignoreExpiration: false,
      secretOrKey: jwtSecret
    });
  }

  validate(payload: JwtPayload): JwtUser {
    if (!payload.userId || !payload.role) {
      throw new UnauthorizedException('Invalid access token payload');
    }

    return {
      sub: payload.userId,
      role: payload.role
    };
  }
}
