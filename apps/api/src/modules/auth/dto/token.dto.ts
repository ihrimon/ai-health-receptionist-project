import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { IsAcceptablePassword } from '../password-rules';

export class VerifyEmailDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  token: string;
}

export class ResetPasswordDto extends VerifyEmailDto {
  @IsAcceptablePassword()
  newPassword: string;
}
