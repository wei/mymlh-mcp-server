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

  const resp = await fetch(upstream_url, {
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id,
      client_secret,
      code: code as string,
      redirect_uri,
    }).toString(),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });
  if (!resp.ok) {
    console.log(await resp.text());
    return [null, new Response("Failed to fetch access token", { status: 500 })];
  }
  let accessToken: string | null = null;
  const raw: MyMLHTokenResponse | undefined = (await resp.json()) as MyMLHTokenResponse;
  accessToken = raw.access_token ?? null;
  if (!accessToken) {
    return [null, new Response("Missing access token", { status: 400 })];
  }
  return [accessToken, null, raw];
}

export interface MyMLHUserProfile {
  country_of_residence?: string;
  race_or_ethnicity?: string;
  gender?: string;
  age?: number;
}

export interface MyMLHEducationEntry {
  id: string;
  current: boolean;
  school_name: string;
  school_type: string | null;
  start_date: number | null;
  end_date: number | null;
  major?: string | null;
}

export interface MyMLHEmploymentEntry {
  id: string;
  current: boolean;
  employer_name: string;
  company?: string;
  title?: string | null;
  type?: string | null;
  start_date: number | null;
  end_date: number | null;
}

export interface MyMLHAddress {
  id: string;
  line1: string;
  line2?: string | null;
  city: string;
  state?: string | null;
  postal_code?: string | null;
  country: string;
}

export interface MyMLHUser {
  id: string;
  created_at?: number;
  updated_at?: number;
  first_name: string;
  last_name: string;
  email: string;
  phone_number?: string;
  profile?: MyMLHUserProfile;
  address?: MyMLHAddress;
  professional_experience?: MyMLHEmploymentEntry[];
  education?: MyMLHEducationEntry[];
  // future optional fields: event_preferences, social_profiles, etc.
}

export interface MyMLHTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

export type Props = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  expiresIn?: number;
  // Unix time (seconds) when the current access token was issued
  accessTokenIssuedAt?: number;
};

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
