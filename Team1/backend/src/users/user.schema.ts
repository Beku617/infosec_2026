import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export const USER_ROLES = ['admin', 'professor', 'student'] as const;
export type UserRole = (typeof USER_ROLES)[number];

@Schema({
  timestamps: {
    createdAt: true,
    updatedAt: true
  }
})
export class User {
  @Prop({ required: true, unique: true, trim: true })
  username!: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email!: string;

  @Prop({ required: true })
  passwordHash!: string;

  @Prop({ required: true, enum: USER_ROLES })
  role!: UserRole;

  @Prop({ default: false })
  isLocked!: boolean;

  @Prop({ type: Date, default: null })
  lockUntil!: Date | null;

  @Prop({ default: 0 })
  failedLoginAttempts!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);
