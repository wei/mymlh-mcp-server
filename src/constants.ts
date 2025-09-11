export const MYMLH_AUTH_URL = "https://my.mlh.io/oauth/authorize";
export const MYMLH_TOKEN_URL = "https://my.mlh.io/oauth/token";
export const MYMLH_API_BASE = "https://api.mlh.com/v4";

export const DEFAULT_MYMLH_SCOPES = [
  "public",
  "offline_access",
  "user:read:profile",

  // Adding more scopes as default until MLH OAuth supports re-prompt consent screen
  "user:read:education",
  "user:read:employment",
].join(" ");

export const ALL_MYMLH_SCOPES = [
  "public",
  "offline_access",
  "user:read:profile",
  // "user:read:address",  // Not yet ready on MyMLH as of 09/05/2025
  "user:read:birthday",
  "user:read:demographics",
  "user:read:education",
  "user:read:email",
  "user:read:employment",
  "user:read:event_preferences",
  "user:read:phone",
  "user:read:social_profiles",
].join(" ");
