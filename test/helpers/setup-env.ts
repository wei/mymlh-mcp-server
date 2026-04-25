import { env } from "cloudflare:test";

export function injectTestSecrets(
  overrides: Partial<{
    MYMLH_CLIENT_ID: string;
    MYMLH_CLIENT_SECRET: string;
    COOKIE_ENCRYPTION_KEY: string;
  }> = {},
) {
  const e = env as unknown as Record<string, string>;
  e.MYMLH_CLIENT_ID = overrides.MYMLH_CLIENT_ID ?? "test-client-id";
  e.MYMLH_CLIENT_SECRET = overrides.MYMLH_CLIENT_SECRET ?? "test-client-secret";
  e.COOKIE_ENCRYPTION_KEY = overrides.COOKIE_ENCRYPTION_KEY ?? "test-cookie-secret";
}
