import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { PASSWORD_MAX_LENGTH } from '../password-rules';
import { EmailField } from './email-field';

export class LoginDto {
  @EmailField()
  email: string;

  // No strength rules here: they apply when a password is set, not when
  // it's checked.
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password: string;
}
