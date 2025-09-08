import type { MyMLHTokenResponse } from "./types";

/**
 * Constructs an authorization URL for an upstream service.
 *
 * @param {Object} options
 * @param {string} options.upstream_url - The base URL of the upstream service.
 * @param {string} options.client_id - The client ID of the application.
 * @param {string} options.redirect_uri - The redirect URI of the application.
 * @param {string} [options.state] - The state parameter.
 *
 * @returns {string} The authorization URL.
 */
export function getUpstreamAuthorizeUrl({
  upstream_url,
  client_id,
  scope,
  redirect_uri,
  state,
}: {
  upstream_url: string;
  client_id: string;
  scope: string;
  redirect_uri: string;
  state?: string;
}) {
  const upstream = new URL(upstream_url);
  upstream.searchParams.set("client_id", client_id);
  upstream.searchParams.set("redirect_uri", redirect_uri);
  upstream.searchParams.set("scope", scope);
  if (state) upstream.searchParams.set("state", state);
  upstream.searchParams.set("response_type", "code");
  return upstream.href;
}

/**
 * Fetches an authorization token from an upstream service.
 *
 * @param {Object} options
 * @param {string} options.client_id - The client ID of the application.
 * @param {string} options.client_secret - The client secret of the application.
 * @param {string} options.code - The authorization code.
 * @param {string} options.redirect_uri - The redirect URI of the application.
 * @param {string} options.upstream_url - The token endpoint URL of the upstream service.
 *
 * @returns {Promise<[string, null] | [null, Response]>} A promise that resolves to an array containing the access token or an error response.
 */
export async function fetchUpstreamAuthToken({
  client_id,
  client_secret,
  code,
  redirect_uri,
  upstream_url,
}: {
  code: string | undefined;
  upstream_url: string;
  client_secret: string;
  redirect_uri: string;
  client_id: string;
}): Promise<[string, null, MyMLHTokenResponse?] | [null, Response]> {
  if (!code) {
    return [null, new Response("Missing code", { status: 400 })];
  }
  const [json, err] = await requestOAuthToken({
    upstream_url,
    client_id,
    client_secret,
    grant_type: "authorization_code",
    code,
    redirect_uri,
  });
  if (err) return [null, err];
  const accessToken = json?.access_token ?? null;
  if (!accessToken) return [null, new Response("Missing access token", { status: 400 })];
  return [accessToken, null, json];
}

/**
 * Generic OAuth token request helper used for both authorization_code and refresh_token grants.
 */
export async function requestOAuthToken({
  upstream_url,
  client_id,
  client_secret,
  grant_type,
  code,
  redirect_uri,
  refresh_token,
}: {
  upstream_url: string;
  client_id: string;
  client_secret: string;
  grant_type: "authorization_code" | "refresh_token";
  code?: string;
  redirect_uri?: string;
  refresh_token?: string;
}): Promise<[MyMLHTokenResponse, null] | [null, Response]> {
  const params = new URLSearchParams({
    grant_type,
    client_id,
    client_secret,
  });
  if (grant_type === "authorization_code") {
    if (!code || !redirect_uri) {
      return [null, new Response("Missing code or redirect_uri", { status: 400 })];
    }
    params.set("code", code);
    params.set("redirect_uri", redirect_uri);
  } else if (grant_type === "refresh_token") {
    if (!refresh_token) {
      return [null, new Response("Missing refresh_token", { status: 400 })];
    }
    params.set("refresh_token", refresh_token);
  }

  try {
    const resp = await fetch(upstream_url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    if (!resp.ok) {
      console.error("Token endpoint error", { url: upstream_url, status: resp.status });
      return [null, new Response("Failed to fetch access token", { status: 500 })];
    }
    const json = (await resp.json()) as MyMLHTokenResponse;
    return [json, null];
  } catch (e) {
    console.error("Token endpoint network error", { url: upstream_url, error: String(e) });
    return [null, new Response("Upstream token request failed", { status: 502 })];
  }
}
