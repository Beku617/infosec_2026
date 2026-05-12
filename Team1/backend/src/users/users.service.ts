import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { User, UserDocument, UserRole } from './user.schema';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private readonly userModel: Model<UserDocument>) {}

  async create(params: {
    username: string;
    email: string;
    passwordHash: string;
    role: UserRole;
  }): Promise<UserDocument> {
    const existing = await this.userModel
      .findOne({
        $or: [{ username: params.username }, { email: params.email.toLowerCase() }]
      })
      .lean();

    if (existing) {
      throw new ConflictException('Username or email already exists');
    }

    return this.userModel.create({
      username: params.username,
      email: params.email.toLowerCase(),
      passwordHash: params.passwordHash,
      role: params.role
    });
  }

  async findById(userId: string): Promise<UserDocument> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async findByUsername(username: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ username }).exec();
  }

  async unlockIfExpired(user: UserDocument): Promise<UserDocument> {
    if (user.isLocked && user.lockUntil && user.lockUntil.getTime() <= Date.now()) {
      user.isLocked = false;
      user.lockUntil = null;
      user.failedAttempts = 0;
      await user.save();
    }
    return user;
  }

  isCurrentlyLocked(user: UserDocument): boolean {
    if (!user.isLocked) {
      return false;
    }
    if (!user.lockUntil) {
      return true;
    }
    return user.lockUntil.getTime() > Date.now();
  }

  getLockRemainingMs(user: UserDocument): number {
    if (!user.lockUntil) {
      return 0;
    }
    return Math.max(user.lockUntil.getTime() - Date.now(), 0);
  }

  async registerFailedAttempt(user: UserDocument): Promise<UserDocument> {
    user.failedAttempts += 1;
    if (user.failedAttempts >= 5) {
      user.isLocked = true;
      user.lockUntil = new Date(Date.now() + 15 * 60 * 1000);
    }
    return user.save();
  }

  async resetFailedAttempts(user: UserDocument): Promise<void> {
    user.failedAttempts = 0;
    user.isLocked = false;
    user.lockUntil = null;
    await user.save();
  }
}
