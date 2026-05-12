import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';

import { User, UserDocument, UserRole } from './user.schema';

export type AdminUserSummary = {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  isLocked: boolean;
  failedLoginAttempts: number;
  failedAttempts: number;
  createdAt: Date;
};

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

  async hasRole(role: UserRole): Promise<boolean> {
    const user = await this.userModel.findOne({ role }).select({ _id: 1 }).lean();
    return Boolean(user);
  }

  async listForAdmin(): Promise<AdminUserSummary[]> {
    const users = await this.userModel
      .find({})
      .select({
        username: 1,
        email: 1,
        role: 1,
        isLocked: 1,
        failedLoginAttempts: 1,
        failedAttempts: 1,
        createdAt: 1
      })
      .sort({ createdAt: -1 })
      .lean();

    return users.map((user) => ({
      id: user._id.toString(),
      username: user.username,
      email: user.email,
      role: user.role,
      isLocked: user.isLocked,
      failedLoginAttempts: this.getFailedAttemptCount(user),
      failedAttempts: this.getFailedAttemptCount(user),
      createdAt: user.createdAt
    }));
  }

  async deleteById(userId: string): Promise<void> {
    if (!isValidObjectId(userId)) {
      throw new NotFoundException('User not found');
    }

    const deleted = await this.userModel.findByIdAndDelete(userId).exec();
    if (!deleted) {
      throw new NotFoundException('User not found');
    }
  }

  async unlockIfExpired(user: UserDocument): Promise<UserDocument> {
    if (user.isLocked && user.lockUntil && user.lockUntil.getTime() <= Date.now()) {
      user.isLocked = false;
      user.lockUntil = null;
      user.failedLoginAttempts = 0;
      (user as UserDocument & { failedAttempts?: number }).failedAttempts = undefined;
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
    const currentFailedAttempts = this.getFailedAttemptCount(user);
    user.failedLoginAttempts = currentFailedAttempts + 1;
    (user as UserDocument & { failedAttempts?: number }).failedAttempts = undefined;

    if (user.failedLoginAttempts >= 5) {
      user.isLocked = true;
      user.lockUntil = new Date(Date.now() + 15 * 60 * 1000);
    }

    return user.save();
  }

  async resetFailedAttempts(user: UserDocument): Promise<void> {
    user.failedLoginAttempts = 0;
    (user as UserDocument & { failedAttempts?: number }).failedAttempts = undefined;
    user.isLocked = false;
    user.lockUntil = null;
    await user.save();
  }

  private getFailedAttemptCount(user: {
    failedLoginAttempts?: number;
    failedAttempts?: number;
  }): number {
    if (typeof user.failedLoginAttempts === 'number') {
      return user.failedLoginAttempts;
    }

    return typeof user.failedAttempts === 'number' ? user.failedAttempts : 0;
  }
}
