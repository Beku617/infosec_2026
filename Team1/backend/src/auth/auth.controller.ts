import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';

import { AuthService } from './auth.service';
import { AdminCreateUserDto } from './dto/admin-create-user.dto';
import { BootstrapAdminDto } from './dto/bootstrap-admin.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CreateTranscriptDto } from './dto/create-transcript.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtUser } from './interfaces/jwt-user.interface';
import { LoginThrottlerGuard } from './login-throttler.guard';
import { Public } from './public.decorator';
import { Roles } from './roles.decorator';

@Controller()
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService
  ) {}

  @Public()
  @Post('auth/register')
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Public()
  @Post('auth/bootstrap-admin')
  @HttpCode(HttpStatus.CREATED)
  async bootstrapAdmin(
    @Body() bootstrapAdminDto: BootstrapAdminDto,
    @Headers('x-admin-setup-key') setupKey: string | undefined,
    @Req() req: Request
  ) {
    return this.authService.bootstrapAdmin(bootstrapAdminDto, setupKey, this.getIp(req));
  }

  @Public()
  @Post('auth/login')
  @UseGuards(LoginThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 900000 } })
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() loginDto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    const result = await this.authService.login(loginDto, this.getIp(req));
    this.setAuthCookies(res, result.accessToken, result.refreshToken);

    return {
      username: result.user.username,
      role: result.user.role
    };
  }

  @Public()
  @Post('auth/refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = req.cookies?.refreshToken as string | undefined;
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token missing');
    }

    const result = await this.authService.refresh(refreshToken, this.getIp(req));
    this.setAuthCookies(res, result.accessToken, result.refreshToken);

    return {
      username: result.user.username,
      role: result.user.role
    };
  }

  @Post('auth/logout')
  @Roles('admin', 'professor', 'student')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request & { user: JwtUser },
    @Res({ passthrough: true }) res: Response
  ) {
    await this.authService.logout(req.user.sub, req.cookies?.refreshToken, this.getIp(req));
    this.clearAuthCookies(res);

    return {
      message: 'Logged out'
    };
  }

  @Get('auth/me')
  @Roles('admin', 'professor', 'student')
  async me(@Req() req: Request & { user: JwtUser }) {
    return this.authService.me(req.user.sub);
  }

  @Post('auth/change-password')
  @Roles('admin', 'professor', 'student')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Body() changePasswordDto: ChangePasswordDto,
    @Req() req: Request & { user: JwtUser },
    @Res({ passthrough: true }) res: Response
  ) {
    await this.authService.changePassword(req.user.sub, changePasswordDto, this.getIp(req));
    this.clearAuthCookies(res);
    return {
      message: 'Password changed. Please login again.'
    };
  }

  @Post('lectures/upload')
  @Roles('professor')
  upload(@Req() req: Request & { user: JwtUser }) {
    const transcript = this.authService.logUpload(req.user.sub, this.getIp(req));
    return {
      message: 'upload simulated',
      transcriptId: transcript.id
    };
  }

  @Get('transcripts')
  @Roles('admin', 'professor', 'student')
  transcripts(@Req() req: Request & { user: JwtUser }) {
    return this.authService.getTranscripts(req.user, this.getIp(req));
  }

  @Get('transcripts/:transcriptId')
  @Roles('admin', 'professor', 'student')
  transcriptById(
    @Param('transcriptId', ParseIntPipe) transcriptId: number,
    @Req() req: Request & { user: JwtUser }
  ) {
    return this.authService.getTranscriptById(transcriptId, req.user, this.getIp(req));
  }

  @Get('admin/users')
  @Roles('admin')
  async listUsers() {
    return this.authService.adminListUsers();
  }

  @Post('admin/users')
  @Roles('admin')
  async createUserByAdmin(
    @Body() createUserDto: AdminCreateUserDto,
    @Req() req: Request & { user: JwtUser }
  ) {
    return this.authService.adminCreateUser(createUserDto, req.user.sub, this.getIp(req));
  }

  @Delete('admin/users/:userId')
  @Roles('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteUserByAdmin(
    @Param('userId') userId: string,
    @Req() req: Request & { user: JwtUser }
  ) {
    await this.authService.adminDeleteUser(userId, req.user.sub, this.getIp(req));
  }

  @Post('admin/transcripts')
  @Roles('admin')
  async createTranscriptByAdmin(
    @Body() createTranscriptDto: CreateTranscriptDto,
    @Req() req: Request & { user: JwtUser }
  ) {
    return this.authService.createTranscript(createTranscriptDto, req.user.sub, this.getIp(req));
  }

  @Delete('admin/transcripts/:transcriptId')
  @Roles('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteTranscriptByAdmin(
    @Param('transcriptId', ParseIntPipe) transcriptId: number,
    @Req() req: Request & { user: JwtUser }
  ) {
    this.authService.deleteTranscript(transcriptId, req.user.sub, this.getIp(req));
  }

  private setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
    const isDevelopment = this.configService.get<string>('NODE_ENV') === 'development';

    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: !isDevelopment,
      sameSite: 'strict',
      path: '/',
      maxAge: this.authService.getAccessTokenTtlMs()
    });

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: !isDevelopment,
      sameSite: 'strict',
      path: '/auth',
      maxAge: this.authService.getRefreshTokenTtlMs()
    });
  }

  private clearAuthCookies(res: Response): void {
    const isDevelopment = this.configService.get<string>('NODE_ENV') === 'development';

    res.clearCookie('accessToken', {
      httpOnly: true,
      secure: !isDevelopment,
      sameSite: 'strict',
      path: '/'
    });

    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: !isDevelopment,
      sameSite: 'strict',
      path: '/auth'
    });
  }

  private getIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      return forwarded.split(',')[0].trim();
    }

    if (Array.isArray(forwarded) && forwarded.length > 0) {
      return forwarded[0] ?? req.ip ?? 'unknown';
    }

    return req.ip ?? req.socket.remoteAddress ?? 'unknown';
  }
}
