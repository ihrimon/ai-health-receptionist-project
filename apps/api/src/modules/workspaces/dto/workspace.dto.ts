import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  MaxLength,
  ValidateBy,
  ValidateIf,
} from 'class-validator';

export class SwitchWorkspaceDto {
  @IsUUID()
  workspaceId: string;
}

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Text that may be cleared: blank becomes null. */
const blankToNull = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() || null : value;

/** An IANA time zone this server knows, e.g. "Asia/Dhaka". */
export function isTimeZone(value: unknown): boolean {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The zone's canonical name ("asia/dhaka" -> "Asia/Dhaka"). */
export function canonicalTimeZone(value: string): string {
  return new Intl.DateTimeFormat('en', {
    timeZone: value,
  }).resolvedOptions().timeZone;
}

/**
 * PATCH /v1/workspace (owner): any of these. Only the fields sent change; a
 * text field sent blank (or null) is cleared, except the name and the time
 * zone, which a workspace always has (M7-42).
 */
export class UpdateWorkspaceDto {
  @ValidateIf((o: UpdateWorkspaceDto) => o.name !== undefined)
  @Transform(trim)
  @IsString()
  @Matches(/\S/, { message: 'name should not be empty' })
  @MaxLength(100)
  name?: string;

  @ValidateIf((o: UpdateWorkspaceDto) => o.website != null)
  @Transform(blankToNull)
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true },
    { message: 'website must be a full web address, like https://example.com' },
  )
  @MaxLength(200)
  website?: string | null;

  @ValidateIf((o: UpdateWorkspaceDto) => o.industry != null)
  @Transform(blankToNull)
  @IsString()
  @MaxLength(80)
  industry?: string | null;

  @ValidateIf((o: UpdateWorkspaceDto) => o.contactEmail != null)
  @Transform(({ value }: { value: unknown }) => {
    const v = blankToNull({ value });
    return typeof v === 'string' ? v.toLowerCase() : v;
  })
  @IsEmail()
  @MaxLength(255)
  contactEmail?: string | null;

  @ValidateIf((o: UpdateWorkspaceDto) => o.contactPhone != null)
  @Transform(blankToNull)
  @Matches(/^[0-9+()\-.\s]{5,30}$/, {
    message: 'contactPhone should be a phone number',
  })
  contactPhone?: string | null;

  @ValidateIf((o: UpdateWorkspaceDto) => o.timeZone !== undefined)
  @Transform(trim)
  @ValidateBy({
    name: 'isTimeZone',
    validator: {
      validate: isTimeZone,
      defaultMessage: () => 'timeZone must be a time zone like Asia/Dhaka',
    },
  })
  timeZone?: string;
}
