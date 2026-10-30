import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ collection: 'users', timestamps: true })
export class User extends Document {
  @Prop({ unique: true, sparse: true })
  username: string;

  @Prop({})
  password: string;

  @Prop({ enum: ['superadmin', 'admin', 'user'] })
  userType: string;

  @Prop({ unique: true, sparse: true })
  userId?: string;

  @Prop({ unique: true, sparse: true })
  supabaseId?: string;

  @Prop()
  email?: string;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: Date.now })
  createdAt: Date;

  @Prop({ default: Date.now })
  updatedAt: Date;

  @Prop()
  lastLoggedIn?: Date;

  /** 'email' or 'google', set when the account is created. */
  @Prop()
  authProvider?: string;

  /** First-touch ad attribution at signup: utm_*, fbclid, fbc, fbp, landingPage, firstSeenAt. */
  @Prop({ type: Object })
  attribution?: Record<string, string>;

  /** Our own test account: no Meta events are sent for it. */
  @Prop()
  trackingExcluded?: boolean;
}

export const UserSchema = SchemaFactory.createForClass(User);
