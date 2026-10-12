import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { IsAcceptablePassword } from '../password-rules';
import { EmailField } from './email-field';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class RegisterDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @EmailField()
  email: string;

  @IsAcceptablePassword()
  password: string;

  /** Becomes the workspace name and the bot's business.name. */
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  companyName: string;
}
