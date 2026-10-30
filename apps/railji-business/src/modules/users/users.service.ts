import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, generateUserId } from '@libs';
import { SharedUsersService } from '@railji/shared';
import { CreateUserDto } from './dto/create-user.dto';
import { ErrorHandlerService } from '@railji/shared';
import { MetaCapiService } from '../meta/meta-capi.service';
import { ClientContext, logEvent } from '../meta/tracking.utils';

const ATTRIBUTION_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'utm_id',
  'fbclid',
  'fbc',
  'fbp',
  'landingPage',
  'firstSeenAt',
];
const AUTH_PROVIDERS = ['email', 'google'];

/** Keep known keys only, as trimmed strings of at most 200 characters. */
function cleanAttribution(raw?: Record<string, unknown>): Record<string, string> | undefined {
  if (!raw) return undefined;
  const cleaned: Record<string, string> = {};
  for (const key of ATTRIBUTION_KEYS) {
    const value = raw[key];
    if (typeof value === 'string' && value.trim()) cleaned[key] = value.trim().slice(0, 200);
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

@Injectable()
export class UsersService extends SharedUsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectModel(User.name)
    userModel: Model<User>,
    private readonly errorHandler: ErrorHandlerService,
    private readonly metaCapi: MetaCapiService,
  ) {
    super(userModel);
  }

  async createOrGetUser(
    createUserDto: CreateUserDto,
    client: ClientContext = {},
  ): Promise<{ user: User; created: boolean }> {
    // Tracking fields are not profile fields: keep them out of the spread below.
    const { attribution, authProvider, internal, ...profile } = createUserDto;

    try {
      // Check if user already exists
      const existingUser = await this.userModel.findOne({
        $or: [
          { supabaseId: createUserDto.supabaseId },
          { email: createUserDto.email },
        ],
      });

      if (existingUser) {
        // Update lastLoggedIn for existing user
        existingUser.lastLoggedIn = new Date();
        const updatedUser = await existingUser.save();
        
        this.logger.log(`User already exists with userId: ${existingUser.userId}, updated lastLoggedIn`);
        return { user: updatedUser, created: false };
      }

      // Generate nanoId for userId
      const userId = generateUserId();

      const cleanedAttribution = cleanAttribution(attribution);
      const provider = AUTH_PROVIDERS.includes(authProvider) ? authProvider : undefined;
      const excluded = this.metaCapi.isExcluded({ internalFlag: internal, email: profile.email });

      const newUser = new this.userModel({
        userId,
        ...profile,
        authProvider: provider,
        attribution: cleanedAttribution,
        trackingExcluded: excluded || undefined,
        lastLoggedIn: new Date(),
      });

      const savedUser = await newUser.save();
      this.logger.log(`User created successfully with userId: ${userId}`);

      this.trackSignup(savedUser, provider, cleanedAttribution, excluded, client);

      return { user: savedUser, created: true };
    } catch (error) {
      this.errorHandler.handle(error, { context: 'UsersService.createUser' });
    }
  }

  /**
   * Signup log line + Meta CompleteRegistration. Runs only for a new user
   * (201). The event is fire-and-forget and can't fail the signup.
   */
  private trackSignup(
    user: User,
    authProvider: string | undefined,
    attribution: Record<string, string> | undefined,
    excluded: boolean,
    client: ClientContext,
  ): void {
    logEvent(this.logger, 'signup', {
      user_id: user.userId,
      auth_provider: authProvider ?? 'unknown',
      internal: excluded || undefined,
      utm_source: attribution?.utm_source,
      utm_campaign: attribution?.utm_campaign,
      has_fbc: !!attribution?.fbc,
    });

    if (excluded) return;

    this.metaCapi.send({
      eventName: 'CompleteRegistration',
      // Must match registrationEventId() in the frontend (src/lib/metaTracking.ts).
      eventId: `reg-${user.supabaseId}`,
      eventSourcePath: '/auth/signup',
      client,
      email: user.email,
      externalId: user.userId,
      fbp: attribution?.fbp,
      fbc: attribution?.fbc,
      customData: { status: 'registered', ...(authProvider ? { auth_provider: authProvider } : {}) },
    });
  }

  async findAllUsers(): Promise<User[]> {
    try {
      const users = await this.userModel.find().exec();

      if (!users || users.length === 0) {
        throw new NotFoundException('No users found');
      }

      this.logger.log(`Found ${users.length} users`);

      return users;
    } catch (error) {
      this.errorHandler.handle(error, { context: 'UsersService.findAllUsers' });
    }
  }

  // getUserFromRequest is inherited from SharedUsersService

  async updateLastLoggedIn(userId: string): Promise<User> {
    try {
      const user = await this.userModel.findOneAndUpdate(
        { userId },
        { lastLoggedIn: new Date() },
        { new: true }
      ).exec();

      if (!user) {
        throw new NotFoundException(`User with userId ${userId} not found`);
      }

      this.logger.log(`Updated lastLoggedIn for user with userId: ${userId}`);
      return user;
    } catch (error) {
      this.errorHandler.handle(error, { context: 'UsersService.updateLastLoggedIn' });
    }
  }
}
