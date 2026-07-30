import type { AuthRequest } from "@cloudflare/workers-oauth-provider";

/**
 * Upstream `state` handling.
 *
 * MLH's www.mlh.com sign-in stores the whole `return_to` authorize URL
 * (including our `state`) in its cookie-backed Rails session. A `state`
 * longer than ~370 characters pushes that cookie past the 4096-byte
 * cookie-store limit and their /signin 500s (see
 * MLH-OAUTH-STATE-500-BUG-REPORT.md). Signed-JSON states for CIMD clients
 * run 600+ characters, so instead of round-tripping the request through
 * `state`, we park it in KV and send a short single-use random token.
 */
const STATE_KEY_PREFIX = "upstream-state:";
const STATE_TTL_SECONDS = 10 * 60;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function createUpstreamState(kv: KVNamespace, oauthReqInfo: AuthRequest): Promise<string> {
  const token = base64url(crypto.getRandomValues(new Uint8Array(32)));
  await kv.put(`${STATE_KEY_PREFIX}${token}`, JSON.stringify(oauthReqInfo), {
    expirationTtl: STATE_TTL_SECONDS,
  });
  return token;
}

/** Single-use: the stored request is deleted on first successful read. */
export async function consumeUpstreamState(kv: KVNamespace, token: string): Promise<AuthRequest | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const key = `${STATE_KEY_PREFIX}${token}`;
  const payload = await kv.get(key);
  if (payload === null) return null;
  await kv.delete(key);
  try {
    return JSON.parse(payload) as AuthRequest;
  } catch {
    return null;
  }
}
