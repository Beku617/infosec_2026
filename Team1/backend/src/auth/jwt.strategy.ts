import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';

import { JwtUser } from './interfaces/jwt-user.interface';

type JwtPayload = {
  sub: string;
  username: string;
  role: JwtUser['role'];
  type: JwtUser['type'];
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
    if (payload.type !== 'access') {
      throw new UnauthorizedException('Invalid token type');
    }

    return {
      sub: payload.sub,
      username: payload.username,
      role: payload.role,
      type: payload.type
    };
  }
}
