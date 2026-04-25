import { requestUpstreamToken } from "../oauth/upstream";
import type { MyMLHTokenResponse, Props } from "../types";
import { MYMLH_TOKEN_URL } from "./scopes";

const REFRESH_THRESHOLD_SECONDS = 60;

export function makeMyMLHApi(env: Env, getProps: () => Props, updateProps: (next: Props) => Promise<void>) {
  async function clearStoredTokens(base: Props): Promise<void> {
    await updateProps({
      ...base,
      accessToken: "",
      refreshToken: undefined,
      tokenType: undefined,
      scope: undefined,
      expiresIn: undefined,
      accessTokenIssuedAt: undefined,
    });
  }

  async function refreshUpstreamToken(): Promise<MyMLHTokenResponse | null> {
    const props = getProps();
    if (!props.refreshToken) {
      await clearStoredTokens(props);
      return null;
    }
    const [tokenJson] = await requestUpstreamToken({
      upstream_url: MYMLH_TOKEN_URL,
      client_id: env.MYMLH_CLIENT_ID,
      client_secret: env.MYMLH_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: props.refreshToken,
    });
    if (tokenJson?.access_token) {
      await updateProps({
        ...props,
        accessToken: tokenJson.access_token,
        refreshToken: tokenJson.refresh_token ?? props.refreshToken,
        tokenType: tokenJson.token_type ?? props.tokenType,
        scope: tokenJson.scope ?? props.scope,
        expiresIn: tokenJson.expires_in ?? props.expiresIn,
        accessTokenIssuedAt: Math.floor(Date.now() / 1000),
      });
      return tokenJson;
    }
    await clearStoredTokens(props);
    return null;
  }

  async function fetchMyMLHWithAutoRefresh(url: string, init?: RequestInit): Promise<Response> {
    const props = getProps();
    const now = Math.floor(Date.now() / 1000);
    const issuedAt = props.accessTokenIssuedAt ?? 0;
    const expiresIn = props.expiresIn ?? 0;
    const expAt = issuedAt + expiresIn;

    let effectiveAccessToken = props.accessToken;
    let didProactiveRefresh = false;
    if (expiresIn && now >= expAt - REFRESH_THRESHOLD_SECONDS) {
      const refreshed = await refreshUpstreamToken();
      if (refreshed?.access_token) {
        effectiveAccessToken = refreshed.access_token;
        didProactiveRefresh = true;
      }
    }

    const withAuth = (token: string): RequestInit => {
      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${token}`);
      return { ...(init ?? {}), headers };
    };

    let resp = await fetch(url, withAuth(effectiveAccessToken));
    // If we just refreshed proactively and still got 401, the token is unusable —
    // skip a second refresh and treat as unauthenticated.
    if (resp.status === 401 && !didProactiveRefresh) {
      const refreshed = await refreshUpstreamToken();
      const retryToken = refreshed?.access_token ?? getProps().accessToken;
      resp = await fetch(url, withAuth(retryToken));
    }
    if (resp.status === 401) await clearStoredTokens(getProps());
    return resp;
  }

  return { refreshUpstreamToken, fetchMyMLHWithAutoRefresh };
}
