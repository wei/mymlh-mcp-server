import { requestUpstreamToken } from "../oauth/upstream";
import type { Props } from "../types";
import { MYMLH_TOKEN_URL } from "./scopes";

/**
 * Exchange the stored MyMLH refresh token for a fresh access token and return
 * the updated props. Returns null when there is nothing to refresh or MyMLH
 * rejects the refresh token.
 *
 * Called from the OAuthProvider `tokenExchangeCallback` (see src/index.ts),
 * which persists the result into the grant. The 2026-07-28 spec is stateless,
 * so there is no per-request place to write refreshed tokens back to.
 */
export async function refreshUpstreamProps(env: Env, props: Props): Promise<Props | null> {
  if (!props.refreshToken) return null;

  const [tokenJson] = await requestUpstreamToken({
    upstream_url: MYMLH_TOKEN_URL,
    client_id: env.MYMLH_CLIENT_ID,
    client_secret: env.MYMLH_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: props.refreshToken,
  });
  if (!tokenJson?.access_token) return null;

  return {
    ...props,
    accessToken: tokenJson.access_token,
    refreshToken: tokenJson.refresh_token ?? props.refreshToken,
    tokenType: tokenJson.token_type ?? props.tokenType,
    scope: tokenJson.scope ?? props.scope,
    expiresIn: tokenJson.expires_in ?? props.expiresIn,
    accessTokenIssuedAt: Math.floor(Date.now() / 1000),
  };
}

/**
 * Our access token TTL is pinned to the MyMLH token TTL, so by the time a tool
 * runs the token in props is current and a 401 means revoked, not stale.
 */
export function makeMyMLHApi(getProps: () => Props) {
  async function fetchMyMLH(url: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${getProps().accessToken}`);
    return fetch(url, { ...(init ?? {}), headers });
  }

  return { fetchMyMLH };
}
