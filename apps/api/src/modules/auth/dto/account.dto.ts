import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { IsAcceptablePassword, PASSWORD_MAX_LENGTH } from '../password-rules';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** PATCH /v1/auth/profile: the signed-in person's own name (M7-42). */
export class UpdateProfileDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;
}

/** POST /v1/auth/change-password: needs the current password (M7-42). */
export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword: string;

  @IsAcceptablePassword()
  newPassword: string;
}
