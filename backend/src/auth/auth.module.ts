import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';

import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { LoginThrottlerGuard } from './login-throttler.guard';
import { RefreshToken, RefreshTokenSchema } from './refresh-token.schema';

@Module({
  imports: [
    UsersModule,
    JwtModule.register({}),
    MongooseModule.forFeature([{ name: RefreshToken.name, schema: RefreshTokenSchema }])
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, LoginThrottlerGuard],
  exports: [AuthService]
})
export class AuthModule {}
