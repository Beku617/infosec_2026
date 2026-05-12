import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserRole = 'professor' | 'student';

@Schema({
  timestamps: {
    createdAt: true,
    updatedAt: false
  }
})
export class User {
  @Prop({ required: true, unique: true, trim: true })
  username!: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email!: string;

  @Prop({ required: true })
  passwordHash!: string;

  @Prop({ required: true, enum: ['professor', 'student'] })
  role!: UserRole;

  @Prop({ default: false })
  isLocked!: boolean;

  @Prop({ type: Date, default: null })
  lockUntil!: Date | null;

  @Prop({ default: 0 })
  failedAttempts!: number;

  createdAt!: Date;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);
