import { IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateConversationDto {
  @IsNotEmpty()
  @IsString()
  callSid: string;

  @IsOptional()
  transcript?: Record<string, unknown>[];

  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsInt()
  duration?: number;
}
