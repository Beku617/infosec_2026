import { HttpException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'crypto';
import { Model } from 'mongoose';

import { UserDocument } from '../users/user.schema';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshToken, RefreshTokenDocument } from './refresh-token.schema';

type AuthResult = {
  accessToken: string;
  refreshToken: string;
  user: {
    username: string;
    role: 'professor' | 'student';
  };
};

type RefreshPayload = {
  sub: string;
  username: string;
  role: 'professor' | 'student';
  type: 'refresh';
  jti: string;
};

@Injectable()
export class AuthService {
  private readonly accessTokenTtlSeconds = 15 * 60;
  private readonly refreshTokenTtlSeconds = 7 * 24 * 60 * 60;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectModel(RefreshToken.name)
    private readonly refreshTokenModel: Model<RefreshTokenDocument>
  ) {}

  async register(registerDto: RegisterDto): Promise<{ username: string; role: 'professor' | 'student' }> {
    const passwordHash = await bcrypt.hash(registerDto.password, 12);
    const user = await this.usersService.create({
      username: registerDto.username,
      email: registerDto.email,
      passwordHash,
      role: registerDto.role
    });

    return {
      username: user.username,
      role: user.role
    };
  }

  async login(loginDto: LoginDto, ip: string): Promise<AuthResult> {
    const existingUser = await this.usersService.findByUsername(loginDto.username);
    if (!existingUser) {
      this.logEvent({
        action: 'LOGIN_FAIL',
        result: 'FAIL',
        ip
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const user = await this.usersService.unlockIfExpired(existingUser);

    if (this.usersService.isCurrentlyLocked(user)) {
      const remainingMinutes = Math.ceil(this.usersService.getLockRemainingMs(user) / 60000);
      this.logEvent({
        userId: user.id,
        action: 'ACCOUNT_LOCKED',
        result: 'LOCKED',
        ip
      });
      throw new HttpException(`Account locked for ${remainingMinutes} minute(s)`, 423);
    }

    const isValidPassword = await bcrypt.compare(loginDto.password, user.passwordHash);
    if (!isValidPassword) {
      const updated = await this.usersService.registerFailedAttempt(user);
      this.logEvent({
        userId: updated.id,
        action: 'LOGIN_FAIL',
        result: 'FAIL',
        ip
      });

      if (updated.isLocked) {
        this.logEvent({
          userId: updated.id,
          action: 'ACCOUNT_LOCKED',
          result: 'LOCKED',
          ip
        });
        throw new HttpException('Account locked for 15 minute(s)', 423);
      }

      throw new UnauthorizedException('Invalid credentials');
    }

    await this.usersService.resetFailedAttempts(user);
    const tokens = await this.issueTokens(user);

    this.logEvent({
      userId: user.id,
      action: 'LOGIN_SUCCESS',
      result: 'OK',
      ip
    });

    return {
      ...tokens,
      user: {
        username: user.username,
        role: user.role
      }
    };
  }

  async refresh(refreshToken: string, ip: string): Promise<AuthResult> {
    const payload = await this.verifyRefreshToken(refreshToken);
    const tokenHash = this.hashToken(refreshToken);
    const tokenRecord = await this.refreshTokenModel.findOne({ token: tokenHash }).exec();

    if (!tokenRecord) {
      this.logEvent({
        userId: payload.sub,
        action: 'TOKEN_REFRESH',
        result: 'FAIL',
        ip
      });
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (tokenRecord.isRevoked) {
      await this.revokeAllTokens(payload.sub);
      console.warn(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          userId: payload.sub,
          action: 'TOKEN_REFRESH_REUSE',
          result: 'WARNING',
          ip
        })
      );
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (tokenRecord.expiresAt.getTime() <= Date.now()) {
      tokenRecord.isRevoked = true;
      await tokenRecord.save();
      this.logEvent({
        userId: payload.sub,
        action: 'TOKEN_REFRESH',
        result: 'FAIL',
        ip
      });
      throw new UnauthorizedException('Refresh token expired');
    }

    if (tokenRecord.userId.toHexString() !== payload.sub) {
      await this.revokeAllTokens(tokenRecord.userId.toHexString());
      this.logEvent({
        userId: payload.sub,
        action: 'TOKEN_REFRESH',
        result: 'FAIL',
        ip
      });
      throw new UnauthorizedException('Invalid refresh token');
    }

    tokenRecord.isRevoked = true;
    await tokenRecord.save();

    const user = await this.usersService.findById(payload.sub);
    const tokens = await this.issueTokens(user);

    this.logEvent({
      userId: user.id,
      action: 'TOKEN_REFRESH',
      result: 'OK',
      ip
    });

    return {
      ...tokens,
      user: {
        username: user.username,
        role: user.role
      }
    };
  }

  async logout(userId: string, refreshToken: string | undefined, ip: string): Promise<void> {
    if (refreshToken) {
      const tokenHash = this.hashToken(refreshToken);
      await this.refreshTokenModel.updateOne({ token: tokenHash }, { $set: { isRevoked: true } }).exec();
    }

    this.logEvent({
      userId,
      action: 'LOGOUT',
      result: 'OK',
      ip
    });
  }

  async me(userId: string): Promise<{ username: string; role: 'professor' | 'student' }> {
    const user = await this.usersService.findById(userId);
    return {
      username: user.username,
      role: user.role
    };
  }

  async logAccessDenied(userId: string | undefined, ip: string): Promise<void> {
    this.logEvent({
      userId,
      action: 'ACCESS_DENIED',
      result: 'DENY',
      ip
    });
  }

  logUpload(userId: string, ip: string): void {
    this.logEvent({
      userId,
      action: 'UPLOAD',
      result: 'OK',
      ip
    });
  }

  logTranscriptRead(userId: string, ip: string): void {
    this.logEvent({
      userId,
      action: 'TRANSCRIPT_READ',
      result: 'OK',
      ip
    });
  }

  private async issueTokens(user: UserDocument): Promise<{ accessToken: string; refreshToken: string }> {
    const jwtSecret = this.getJwtSecret();
    const basePayload = {
      sub: user.id,
      username: user.username,
      role: user.role
    };

    const accessToken = await this.jwtService.signAsync(
      {
        ...basePayload,
        type: 'access'
      },
      {
        secret: jwtSecret,
        expiresIn: `${this.accessTokenTtlSeconds}s`
      }
    );

    const refreshToken = await this.jwtService.signAsync(
      {
        ...basePayload,
        type: 'refresh',
        jti: randomUUID()
      },
      {
        secret: jwtSecret,
        expiresIn: `${this.refreshTokenTtlSeconds}s`
      }
    );

    await this.refreshTokenModel.create({
      token: this.hashToken(refreshToken),
      userId: user._id,
      isRevoked: false,
      expiresAt: new Date(Date.now() + this.refreshTokenTtlSeconds * 1000)
    });

    return {
      accessToken,
      refreshToken
    };
  }

  private async verifyRefreshToken(token: string): Promise<RefreshPayload> {
    try {
      const payload = await this.jwtService.verifyAsync<RefreshPayload>(token, {
        secret: this.getJwtSecret()
      });
      if (payload.type !== 'refresh') {
        throw new UnauthorizedException('Invalid token type');
      }
      return payload;
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private getJwtSecret(): string {
    const jwtSecret = this.configService.get<string>('JWT_SECRET');
    if (!jwtSecret) {
      throw new UnauthorizedException('JWT_SECRET is not configured');
    }
    return jwtSecret;
  }

  private async revokeAllTokens(userId: string): Promise<void> {
    await this.refreshTokenModel.updateMany({ userId }, { $set: { isRevoked: true } }).exec();
  }

  private logEvent(params: {
    userId?: string;
    action: string;
    result: string;
    ip: string;
  }): void {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        userId: params.userId ?? null,
        action: params.action,
        result: params.result,
        ip: params.ip
      })
    );
  }

  getAccessTokenTtlMs(): number {
    return this.accessTokenTtlSeconds * 1000;
  }

  getRefreshTokenTtlMs(): number {
    return this.refreshTokenTtlSeconds * 1000;
  }
}
