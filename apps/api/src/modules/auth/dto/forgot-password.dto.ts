import { EmailField } from './email-field';

export class ForgotPasswordDto {
  @EmailField()
  email: string;
}
