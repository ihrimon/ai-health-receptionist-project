/**
 * Verification and password-reset email are off until a mail provider is
 * chosen (M7-37). Set NEXT_PUBLIC_EMAIL_FEATURES_ENABLED=true (and
 * EMAIL_FEATURES_ENABLED=true on the API) to bring back the "Forgot
 * password?" link, the confirm-your-email banner and the "check your email"
 * screen after signup.
 */
export const EMAIL_FEATURES_ENABLED =
  process.env.NEXT_PUBLIC_EMAIL_FEATURES_ENABLED === "true";
