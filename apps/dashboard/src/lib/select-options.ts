/* The choices behind the Currency, Social Contact and Time zone selects
   (review items 8 and 12). */

export interface Choice {
  value: string;
  /** What the closed select shows. */
  label: string;
  /** A short line under the label in the open list. */
  description?: string;
}

/**
 * `choices`, plus the saved `value` when it is not among them (a currency
 * or time zone chosen before these lists existed), so opening the page
 * never loses or silently changes what was saved.
 */
export function withSaved(
  choices: Choice[],
  value: string | null | undefined,
): Choice[] {
  if (!value || choices.some((c) => c.value === value)) return choices;
  return [...choices, { value, label: value, description: "Saved earlier" }];
}

/** USD first (the default), then the currencies owners ask for most. */
export const CURRENCIES: Choice[] = [
  { value: "USD", label: "USD · US dollar" },
  { value: "EUR", label: "EUR · Euro" },
  { value: "GBP", label: "GBP · British pound" },
  { value: "CAD", label: "CAD · Canadian dollar" },
  { value: "AUD", label: "AUD · Australian dollar" },
  { value: "NZD", label: "NZD · New Zealand dollar" },
  { value: "BDT", label: "BDT · Bangladeshi taka" },
  { value: "INR", label: "INR · Indian rupee" },
  { value: "PKR", label: "PKR · Pakistani rupee" },
  { value: "AED", label: "AED · UAE dirham" },
  { value: "SAR", label: "SAR · Saudi riyal" },
  { value: "SGD", label: "SGD · Singapore dollar" },
  { value: "MYR", label: "MYR · Malaysian ringgit" },
  { value: "JPY", label: "JPY · Japanese yen" },
  { value: "CNY", label: "CNY · Chinese yuan" },
  { value: "CHF", label: "CHF · Swiss franc" },
];

export const SOCIAL_KINDS = ["whatsapp", "facebook", "linkedin", "instagram"] as const;
export type SocialKind = (typeof SOCIAL_KINDS)[number];

export const SOCIAL: Record<
  SocialKind,
  { label: string; field: string; type: "tel" | "url"; placeholder: string }
> = {
  whatsapp: {
    label: "WhatsApp",
    field: "WhatsApp number",
    type: "tel",
    placeholder: "+1 555 123 4567",
  },
  facebook: {
    label: "Facebook",
    field: "Facebook link",
    type: "url",
    placeholder: "https://facebook.com/yourpage",
  },
  linkedin: {
    label: "LinkedIn",
    field: "LinkedIn link",
    type: "url",
    placeholder: "https://linkedin.com/company/yourcompany",
  },
  instagram: {
    label: "Instagram",
    field: "Instagram link",
    type: "url",
    placeholder: "https://instagram.com/yourhandle",
  },
};

/** Which social contact to show first: WhatsApp, or the first one that has a value. */
export function firstSocial(
  contact: Partial<Record<SocialKind, string | null | undefined>>,
): SocialKind {
  if (contact.whatsapp) return "whatsapp";
  return SOCIAL_KINDS.find((kind) => contact[kind]) ?? "whatsapp";
}

/** UTC first (the default), then the main zones by region, with the cities they cover. */
export const TIME_ZONES: Choice[] = [
  { value: "UTC", label: "UTC · UTC+0", description: "Coordinated Universal Time" },
  { value: "America/New_York", label: "New York · UTC-5/-4", description: "US Eastern: Miami, Atlanta, Toronto" },
  { value: "America/Chicago", label: "Chicago · UTC-6/-5", description: "US Central: Dallas, Houston, St. Louis" },
  { value: "America/Denver", label: "Denver · UTC-7/-6", description: "US Mountain: Salt Lake City, Calgary" },
  { value: "America/Phoenix", label: "Phoenix · UTC-7", description: "Arizona, no daylight saving" },
  { value: "America/Los_Angeles", label: "Los Angeles · UTC-8/-7", description: "US Pacific: San Francisco, Seattle, Vancouver" },
  { value: "America/Anchorage", label: "Anchorage · UTC-9/-8", description: "Alaska" },
  { value: "Pacific/Honolulu", label: "Honolulu · UTC-10", description: "Hawaii, no daylight saving" },
  { value: "America/Sao_Paulo", label: "São Paulo · UTC-3", description: "Brazil, Argentina" },
  { value: "Europe/London", label: "London · UTC+0/+1", description: "UK, Ireland, Portugal" },
  { value: "Europe/Paris", label: "Paris · UTC+1/+2", description: "Central Europe: Berlin, Madrid, Rome" },
  { value: "Europe/Athens", label: "Athens · UTC+2/+3", description: "Eastern Europe: Helsinki, Kyiv, Bucharest" },
  { value: "Europe/Istanbul", label: "Istanbul · UTC+3", description: "Turkey" },
  { value: "Africa/Lagos", label: "Lagos · UTC+1", description: "West Africa" },
  { value: "Africa/Johannesburg", label: "Johannesburg · UTC+2", description: "South Africa" },
  { value: "Africa/Nairobi", label: "Nairobi · UTC+3", description: "East Africa" },
  { value: "Asia/Riyadh", label: "Riyadh · UTC+3", description: "Saudi Arabia, Kuwait, Qatar" },
  { value: "Asia/Dubai", label: "Dubai · UTC+4", description: "UAE, Oman" },
  { value: "Asia/Karachi", label: "Karachi · UTC+5", description: "Pakistan" },
  { value: "Asia/Kolkata", label: "Kolkata · UTC+5:30", description: "India, Sri Lanka" },
  { value: "Asia/Dhaka", label: "Dhaka · UTC+6", description: "Bangladesh" },
  { value: "Asia/Bangkok", label: "Bangkok · UTC+7", description: "Thailand, Vietnam, Jakarta" },
  { value: "Asia/Singapore", label: "Singapore · UTC+8", description: "Singapore, Malaysia, Philippines" },
  { value: "Asia/Shanghai", label: "Shanghai · UTC+8", description: "China, Hong Kong, Taiwan" },
  { value: "Australia/Perth", label: "Perth · UTC+8", description: "Western Australia" },
  { value: "Asia/Tokyo", label: "Tokyo · UTC+9", description: "Japan, South Korea" },
  { value: "Australia/Sydney", label: "Sydney · UTC+10/+11", description: "Melbourne, Canberra" },
  { value: "Pacific/Auckland", label: "Auckland · UTC+12/+13", description: "New Zealand" },
];
