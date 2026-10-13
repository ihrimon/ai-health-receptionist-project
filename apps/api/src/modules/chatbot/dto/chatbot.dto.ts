import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsString,
  MaxLength,
} from 'class-validator';
import { ChatbotStatus } from '../../../generated/prisma/client';

export class SetChatbotStatusDto {
  @IsEnum(ChatbotStatus)
  status: ChatbotStatus;
}

/** Format rules live in allowed-domains.ts; this only bounds the input. */
export class SetAllowedDomainsDto {
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  domains: string[];
}
