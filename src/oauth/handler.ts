import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import { name as pkgName } from "../../package.json";
import { DEFAULT_MYMLH_SCOPES, MYMLH_API_BASE, MYMLH_AUTH_URL, MYMLH_TOKEN_URL } from "../mymlh/scopes";
import type { MyMLHUser, Props } from "../types";
import { clientIdAlreadyApproved, parseRedirectApproval, renderApprovalDialog } from "./approval";
import { signState, verifyState } from "./approval/cookie";
import { getUpstreamAuthorizeUrl, requestUpstreamToken } from "./upstream";

const SERVER_DISPLAY_NAME = "MyMLH MCP Server";
const SERVER_DESCRIPTION = "MCP Remote Server using MyMLH (v4) for authentication.";
const SERVER_LOGO = "https://static.mlh.io/brand-assets/logo/official/mlh-logo-color.svg";
const APPROVAL_REPROMPT_SECONDS = 5;

type Bindings = Env & { OAUTH_PROVIDER: OAuthHelpers };

const app = new Hono<{ Bindings: Bindings }>();

app.get("/", (c) =>
  c.json({
    name: pkgName,
    env: c.env.ENV_NAME ?? "unknown",
    endpoints: ["/mcp", "/authorize", "/callback", "/token", "/register"],
  }),
);

app.get("/authorize", async (c) => {
  let oauthReqInfo: AuthRequest;
  try {
    oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid authorization request";
    return c.text(`Invalid authorization request: ${msg}`, 400);
  }

  const { clientId } = oauthReqInfo;
  if (!clientId) return c.text("Invalid request", 400);

  if (await clientIdAlreadyApproved(c.req.raw, clientId, c.env.COOKIE_ENCRYPTION_KEY)) {
    return await redirectToMyMLH(c.req.raw, oauthReqInfo, c.env.MYMLH_CLIENT_ID, {}, c.env.COOKIE_ENCRYPTION_KEY);
  }

  return renderApprovalDialog(c.req.raw, {
    client: await c.env.OAUTH_PROVIDER.lookupClient(clientId),
    server: { description: SERVER_DESCRIPTION, logo: SERVER_LOGO, name: SERVER_DISPLAY_NAME },
    state: { oauthReqInfo },
  });
});

app.post("/authorize", async (c) => {
  try {
    const { state, headers } = await parseRedirectApproval(
      c.req.raw,
      c.env.COOKIE_ENCRYPTION_KEY,
      APPROVAL_REPROMPT_SECONDS,
    );
    if (!state.oauthReqInfo) return c.text("Invalid request", 400);
    return await redirectToMyMLH(
      c.req.raw,
      state.oauthReqInfo,
      c.env.MYMLH_CLIENT_ID,
      headers,
      c.env.COOKIE_ENCRYPTION_KEY,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to process approval";
    return c.text(`Invalid approval submission: ${msg}`, 400);
  }
});

async function redirectToMyMLH(
  request: Request,
  oauthReqInfo: AuthRequest,
  client_id: string,
  headers: Record<string, string> = {},
  cookieEncryptionKey: string,
): Promise<Response> {
  const state = await signState(JSON.stringify(oauthReqInfo), cookieEncryptionKey);
  return new Response(null, {
    headers: {
      ...headers,
      location: getUpstreamAuthorizeUrl({
        client_id,
        redirect_uri: new URL("/callback", request.url).href,
        scope: DEFAULT_MYMLH_SCOPES,
        state,
        upstream_url: MYMLH_AUTH_URL,
      }),
    },
    status: 302,
  });
}

app.get("/callback", async (c) => {
  const stateParam = c.req.query("state");
  if (!stateParam) return c.text("Invalid state", 400);
  const verifiedPayload = await verifyState(stateParam, c.env.COOKIE_ENCRYPTION_KEY);
  if (!verifiedPayload) return c.text("Invalid state", 400);
  let oauthReqInfo: AuthRequest;
  try {
    oauthReqInfo = JSON.parse(verifiedPayload) as AuthRequest;
  } catch {
    return c.text("Invalid state", 400);
  }
  if (!oauthReqInfo.clientId) return c.text("Invalid state", 400);

  const code = c.req.query("code");
  if (!code) return c.text("Missing code", 400);

  const [tokenResponse, errResponse] = await requestUpstreamToken({
    client_id: c.env.MYMLH_CLIENT_ID,
    client_secret: c.env.MYMLH_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: new URL("/callback", c.req.raw.url).href,
    upstream_url: MYMLH_TOKEN_URL,
  });
  if (errResponse) return errResponse;
  const accessToken = tokenResponse.access_token;
  if (!accessToken) return c.text("Missing access token", 400);

  const meResp = await fetch(`${MYMLH_API_BASE}/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!meResp.ok) return c.text("Failed to fetch MyMLH user info", 502);
  const me = (await meResp.json()) as MyMLHUser;
  const { id, first_name, last_name, email } = me;

  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    metadata: { label: `${first_name} ${last_name}`.trim() },
    props: {
      accessToken,
      email,
      first_name,
      last_name,
      id,
      refreshToken: tokenResponse.refresh_token,
      tokenType: tokenResponse.token_type,
      expiresIn: tokenResponse.expires_in,
      accessTokenIssuedAt: Math.floor(Date.now() / 1000),
      scope: tokenResponse.scope,
    } satisfies Props,
    request: oauthReqInfo,
    scope: oauthReqInfo.scope,
    userId: id,
  });

  return Response.redirect(redirectTo);
});

export { app as MyMLHHandler };
