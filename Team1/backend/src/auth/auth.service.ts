import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  UnauthorizedException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'crypto';
import { Model } from 'mongoose';

import { UserDocument, UserRole } from '../users/user.schema';
import { UsersService } from '../users/users.service';
import { BootstrapAdminDto } from './dto/bootstrap-admin.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CreateTranscriptDto } from './dto/create-transcript.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshToken, RefreshTokenDocument } from './refresh-token.schema';
import { Transcript, TranscriptDocument } from './transcript.schema';

type AuthResult = {
  accessToken: string;
  refreshToken: string;
  user: {
    username: string;
    role: UserRole;
  };
};

type RefreshPayload = {
  sub: string;
  role: UserRole;
  type: 'refresh';
  jti: string;
};

export type TranscriptRecord = {
  id: number;
  text: string;
  createdBy: string;
  allowedRoles: UserRole[];
  createdAt: string;
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
    private readonly refreshTokenModel: Model<RefreshTokenDocument>,
    @InjectModel(Transcript.name)
    private readonly transcriptModel: Model<TranscriptDocument>
  ) {}

  async register(registerDto: RegisterDto): Promise<{ username: string; role: UserRole }> {
    const passwordHash = await bcrypt.hash(registerDto.password, 12);
    const role = registerDto.role ?? 'student';
    const user = await this.usersService.create({
      username: registerDto.username,
      email: registerDto.email,
      passwordHash,
      role
    });

    return {
      username: user.username,
      role: user.role
    };
  }

  async bootstrapAdmin(
    bootstrapAdminDto: BootstrapAdminDto,
    setupKey: string | undefined,
    ip: string
  ): Promise<{ username: string; role: UserRole }> {
    const configuredSetupKey = this.configService.get<string>('ADMIN_SETUP_KEY');
    if (!configuredSetupKey) {
      throw new UnauthorizedException('ADMIN_SETUP_KEY is not configured');
    }

    if (!setupKey || setupKey !== configuredSetupKey) {
      this.logEvent({
        action: 'ADMIN_BOOTSTRAP',
        result: 'DENY',
        ip
      });
      throw new UnauthorizedException('Invalid admin setup key');
    }

    const hasAdmin = await this.usersService.hasRole('admin');
    if (hasAdmin) {
      throw new ConflictException('Admin account already exists');
    }

    const passwordHash = await bcrypt.hash(bootstrapAdminDto.password, 12);
    const user = await this.usersService.create({
      username: bootstrapAdminDto.username,
      email: bootstrapAdminDto.email,
      passwordHash,
      role: 'admin'
    });

    this.logEvent({
      userId: user.id,
      action: 'ADMIN_BOOTSTRAP',
      result: 'OK',
      ip
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
        username: loginDto.username,
        reason: 'USER_NOT_FOUND',
        ip
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const user = await this.usersService.unlockIfExpired(existingUser);

    if (this.usersService.isCurrentlyLocked(user)) {
      const remainingMinutes = Math.ceil(this.usersService.getLockRemainingMs(user) / 60000);
      this.logEvent({
        userId: user.id,
        username: user.username,
        role: user.role,
        action: 'ACCOUNT_LOCKED',
        result: 'LOCKED',
        reason: 'LOCKOUT_ACTIVE',
        ip
      });
      throw new HttpException(`Account locked for ${remainingMinutes} minute(s)`, 423);
    }

    const isValidPassword = await bcrypt.compare(loginDto.password, user.passwordHash);
    if (!isValidPassword) {
      const updated = await this.usersService.registerFailedAttempt(user);
      this.logEvent({
        userId: updated.id,
        username: updated.username,
        role: updated.role,
        action: 'LOGIN_FAIL',
        result: 'FAIL',
        reason: 'PASSWORD_MISMATCH',
        ip
      });

      if (updated.isLocked) {
        this.logEvent({
          userId: updated.id,
          username: updated.username,
          role: updated.role,
          action: 'ACCOUNT_LOCKED',
          result: 'LOCKED',
          reason: 'LOCKOUT_THRESHOLD',
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
      username: user.username,
      role: user.role,
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
    let tokenRecord = await this.refreshTokenModel.findOne({ tokenId: payload.jti }).exec();
    if (!tokenRecord) {
      tokenRecord = await this.refreshTokenModel.findOne({ token: tokenHash }).exec();
    }

    if (!tokenRecord) {
      this.logEvent({
        userId: payload.sub,
        action: 'TOKEN_REFRESH',
        result: 'FAIL',
        reason: 'TOKEN_RECORD_NOT_FOUND',
        ip
      });
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (tokenRecord.token !== tokenHash) {
      await this.revokeAllTokens(payload.sub);
      this.logEvent({
        userId: payload.sub,
        action: 'TOKEN_REFRESH_REUSE',
        result: 'WARNING',
        reason: 'TOKEN_HASH_MISMATCH',
        ip
      });
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (tokenRecord.isRevoked) {
      await this.revokeAllTokens(payload.sub);
      this.logEvent({
        userId: payload.sub,
        action: 'TOKEN_REFRESH_REUSE',
        result: 'WARNING',
        reason: 'REVOKED_TOKEN_REUSE',
        ip
      });
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (tokenRecord.expiresAt.getTime() <= Date.now()) {
      tokenRecord.isRevoked = true;
      await tokenRecord.save();
      this.logEvent({
        userId: payload.sub,
        action: 'TOKEN_REFRESH',
        result: 'FAIL',
        reason: 'TOKEN_EXPIRED',
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
        reason: 'TOKEN_SUB_MISMATCH',
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
      username: user.username,
      role: user.role,
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
      endpoint: 'POST /auth/logout',
      ip
    });
  }

  async me(userId: string): Promise<{ username: string; role: UserRole }> {
    const user = await this.usersService.findById(userId);
    return {
      username: user.username,
      role: user.role
    };
  }

  async changePassword(userId: string, changePasswordDto: ChangePasswordDto, ip: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    const isCurrentPasswordValid = await bcrypt.compare(
      changePasswordDto.currentPassword,
      user.passwordHash
    );

    if (!isCurrentPasswordValid) {
      this.logEvent({
        userId: user.id,
        username: user.username,
        role: user.role,
        action: 'PASSWORD_CHANGE',
        result: 'FAIL',
        reason: 'CURRENT_PASSWORD_MISMATCH',
        ip
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    if (changePasswordDto.currentPassword === changePasswordDto.newPassword) {
      throw new BadRequestException('New password must be different from current password');
    }

    user.passwordHash = await bcrypt.hash(changePasswordDto.newPassword, 12);
    await user.save();
    await this.usersService.resetFailedAttempts(user);
    await this.revokeAllTokens(user.id);

    this.logEvent({
      userId: user.id,
      username: user.username,
      role: user.role,
      action: 'PASSWORD_CHANGE',
      result: 'OK',
      ip
    });
  }

  async logAccessDenied(userId: string | undefined, ip: string): Promise<void> {
    this.logEvent({
      userId,
      action: 'ACCESS_DENIED',
      result: 'DENY',
      ip
    });
  }

  async logUpload(userId: string, ip: string): Promise<TranscriptRecord> {
    const transcriptId = await this.getNextTranscriptId();
    const lectureTitle = await this.getNextLectureTitle();
    const transcript = await this.transcriptModel.create({
      id: transcriptId,
      text: lectureTitle,
      createdBy: userId,
      allowedRoles: ['admin', 'student']
    });

    this.logEvent({
      userId,
      action: 'UPLOAD',
      result: 'OK',
      ip
    });

    return this.toTranscriptRecord(transcript);
  }

  logTranscriptRead(userId: string, ip: string, endpoint: string): void {
    this.logEvent({
      userId,
      endpoint,
      action: 'TRANSCRIPT_READ',
      result: 'OK',
      ip
    });
  }

  async getTranscripts(user: { sub: string; role: UserRole }, ip: string): Promise<TranscriptRecord[]> {
    const query = this.buildTranscriptVisibilityQuery(user.sub, user.role);
    const transcripts = await this.transcriptModel.find(query).sort({ id: -1 }).exec();

    this.logTranscriptRead(user.sub, ip, 'GET /transcripts');
    return transcripts.map((transcript) => this.toTranscriptRecord(transcript));
  }

  async getTranscriptById(
    transcriptId: number,
    user: { sub: string; role: UserRole },
    ip: string
  ): Promise<TranscriptRecord> {
    const transcript = await this.transcriptModel.findOne({ id: transcriptId }).exec();
    if (!transcript) {
      throw new HttpException('Transcript not found', 404);
    }

    const transcriptRecord = this.toTranscriptRecord(transcript);
    if (!this.canReadTranscript(transcriptRecord, user.sub, user.role)) {
      this.logEvent({
        userId: user.sub,
        role: user.role,
        endpoint: `GET /transcripts/${transcriptId}`,
        action: 'ACCESS_DENIED',
        result: 'DENY',
        reason: 'TRANSCRIPT_NOT_ALLOWED',
        ip
      });
      throw new ForbiddenException('Access denied');
    }

    this.logTranscriptRead(user.sub, ip, `GET /transcripts/${transcriptId}`);
    return transcriptRecord;
  }

  async createTranscript(
    createTranscriptDto: CreateTranscriptDto,
    actorUserId: string,
    ip: string
  ): Promise<TranscriptRecord> {
    const transcriptText = createTranscriptDto.text.trim();
    if (!transcriptText) {
      throw new HttpException('Transcript text is required', 400);
    }

    const transcriptId = await this.getNextTranscriptId();
    const transcript = await this.transcriptModel.create({
      id: transcriptId,
      text: transcriptText,
      createdBy: actorUserId,
      allowedRoles: createTranscriptDto.allowStudentAccess ? ['admin', 'student'] : ['admin']
    });
    this.logEvent({
      userId: actorUserId,
      action: 'ADMIN_TRANSCRIPT_CREATE',
      result: 'OK',
      ip
    });

    return this.toTranscriptRecord(transcript);
  }

  async deleteTranscript(transcriptId: number, actorUserId: string, ip: string): Promise<void> {
    const deletion = await this.transcriptModel.deleteOne({ id: transcriptId }).exec();
    if (deletion.deletedCount === 0) {
      throw new HttpException('Transcript not found', 404);
    }

    this.logEvent({
      userId: actorUserId,
      action: 'ADMIN_TRANSCRIPT_DELETE',
      result: 'OK',
      ip
    });
  }

  private buildTranscriptVisibilityQuery(userId: string, role: UserRole): Record<string, string> {
    if (role === 'admin') {
      return {};
    }

    if (role === 'professor') {
      return { createdBy: userId };
    }

    return { allowedRoles: 'student' };
  }

  private toTranscriptRecord(transcript: TranscriptDocument): TranscriptRecord {
    return {
      id: transcript.id,
      text: transcript.text,
      createdBy: transcript.createdBy,
      allowedRoles: transcript.allowedRoles,
      createdAt: transcript.createdAt.toISOString()
    };
  }

  private async getNextTranscriptId(): Promise<number> {
    const latest = await this.transcriptModel.findOne().sort({ id: -1 }).exec();
    return (latest?.id ?? 0) + 1;
  }

  private async getNextLectureTitle(): Promise<string> {
    const lectureRecords = await this.transcriptModel.find({ text: /^Lecture \d+$/i }).select('text').exec();
    let maxLectureNumber = 0;

    for (const record of lectureRecords) {
      const match = /^Lecture\s+(\d+)$/i.exec(record.text.trim());
      if (!match) {
        continue;
      }

      const lectureNumber = Number.parseInt(match[1], 10);
      if (!Number.isNaN(lectureNumber) && lectureNumber > maxLectureNumber) {
        maxLectureNumber = lectureNumber;
      }
    }

    return `Lecture ${maxLectureNumber + 1}`;
  }

  private async issueTokens(user: UserDocument): Promise<{ accessToken: string; refreshToken: string }> {
    const jwtSecret = this.getJwtSecret();

    const accessToken = await this.jwtService.signAsync(
      {
        userId: user.id,
        role: user.role
      },
      {
        secret: jwtSecret,
        expiresIn: `${this.accessTokenTtlSeconds}s`
      }
    );

    const tokenId = randomUUID();
    const refreshToken = await this.jwtService.signAsync(
      {
        sub: user.id,
        role: user.role,
        type: 'refresh',
        jti: tokenId
      },
      {
        secret: jwtSecret,
        expiresIn: `${this.refreshTokenTtlSeconds}s`
      }
    );

    await this.refreshTokenModel.create({
      tokenId,
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
      if (payload.type !== 'refresh' || typeof payload.jti !== 'string' || payload.jti.length === 0) {
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

    if (Buffer.byteLength(jwtSecret, 'utf8') < 32) {
      throw new UnauthorizedException('JWT_SECRET must be at least 32 bytes');
    }

    return jwtSecret;
  }

  private async revokeAllTokens(userId: string): Promise<void> {
    await this.refreshTokenModel.updateMany({ userId }, { $set: { isRevoked: true } }).exec();
  }

  private logEvent(params: {
    userId?: string;
    username?: string;
    role?: UserRole;
    endpoint?: string;
    action: string;
    result: string;
    reason?: string;
    ip: string;
  }): void {
    void params;
  }

  private canReadTranscript(transcript: TranscriptRecord, userId: string, role: UserRole): boolean {
    if (role === 'admin') {
      return true;
    }

    if (role === 'professor') {
      return transcript.createdBy === userId;
    }

    if (role === 'student') {
      return transcript.allowedRoles.includes('student');
    }

    return false;
  }

  getAccessTokenTtlMs(): number {
    return this.accessTokenTtlSeconds * 1000;
  }

  getRefreshTokenTtlMs(): number {
    return this.refreshTokenTtlSeconds * 1000;
  }
}
