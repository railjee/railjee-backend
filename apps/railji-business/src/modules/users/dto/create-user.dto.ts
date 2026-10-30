import { IsBoolean, IsEmail, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class CreateUserDto {
  @IsNotEmpty()
  @IsString()
  supabaseId: string;

  @IsNotEmpty()
  @IsEmail()
  email: string;

  @IsNotEmpty()
  @IsString()
  username: string;

  // Tracking fields (all optional). Attribution is a plain object on purpose:
  // the service keeps only known keys, so a new or unexpected key from the
  // browser can never fail a signup with a 400.
  @IsOptional()
  @IsObject()
  attribution?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  authProvider?: string;

  @IsOptional()
  @IsBoolean()
  internal?: boolean;
}
