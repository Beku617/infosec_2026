import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({
  timestamps: {
    createdAt: true,
    updatedAt: false
  }
})
export class RefreshToken {
  @Prop({ required: true, unique: true, sparse: true })
  tokenId!: string;

  @Prop({ required: true, unique: true })
  token!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ default: false })
  isRevoked!: boolean;

  @Prop({ required: true })
  expiresAt!: Date;

  createdAt!: Date;
}

export type RefreshTokenDocument = HydratedDocument<RefreshToken>;
export const RefreshTokenSchema = SchemaFactory.createForClass(RefreshToken);
