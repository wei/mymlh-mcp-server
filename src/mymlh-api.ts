import { MYMLH_TOKEN_URL } from "./constants";
import type { MyMLHTokenResponse, Props } from "./types";
import { requestOAuthToken } from "./utils";

export function makeMyMLHApi(env: Env, getProps: () => Props, updateProps: (next: Props) => Promise<void>) {
  async function refreshUpstreamToken(): Promise<MyMLHTokenResponse | null> {
    const props = getProps();
    if (!props.refreshToken) return null;
    const [tokenJson] = await requestOAuthToken({
      upstream_url: MYMLH_TOKEN_URL,
      client_id: env.MYMLH_CLIENT_ID,
      client_secret: env.MYMLH_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: props.refreshToken,
    });
    if (!tokenJson) return null;
    if (tokenJson.access_token) {
      await updateProps({
        ...props,
        accessToken: tokenJson.access_token,
        refreshToken: tokenJson.refresh_token ?? props.refreshToken,
        tokenType: tokenJson.token_type ?? props.tokenType,
        scope: tokenJson.scope ?? props.scope,
        expiresIn: tokenJson.expires_in ?? props.expiresIn,
        accessTokenIssuedAt: Math.floor(Date.now() / 1000),
      });
    }
    return tokenJson;
  }

  async function fetchMyMLHWithAutoRefresh(url: string, init?: RequestInit): Promise<Response> {
    const props = getProps();
    const now = Math.floor(Date.now() / 1000);
    const issuedAt = props.accessTokenIssuedAt ?? 0;
    const expiresIn = props.expiresIn ?? 0;
    const expAt = issuedAt + expiresIn;
    const refreshThresholdSeconds = 60; // proactively refresh ~1 minute before expiry

    let effectiveAccessToken = props.accessToken;
    if (expiresIn && now >= expAt - refreshThresholdSeconds) {
      const refreshed = await refreshUpstreamToken();
      if (refreshed?.access_token) {
        effectiveAccessToken = refreshed.access_token;
      }
    }

    const withAuth = async (token: string): Promise<RequestInit> => {
      const headers = new Headers(init?.headers as HeadersInit);
      headers.set("Authorization", `Bearer ${token}`);
      return { ...(init ?? {}), headers } satisfies RequestInit;
    };

    let resp = await fetch(url, await withAuth(effectiveAccessToken));

    if (resp.status === 401) {
      const refreshed = await refreshUpstreamToken();
      const retryProps = getProps();
      const retryToken = refreshed?.access_token ?? retryProps.accessToken;
      resp = await fetch(url, await withAuth(retryToken));
    }
    return resp;
  }

  return { refreshUpstreamToken, fetchMyMLHWithAutoRefresh };
}
