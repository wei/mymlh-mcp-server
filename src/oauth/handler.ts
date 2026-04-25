import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import { DEFAULT_MYMLH_SCOPES, MYMLH_API_BASE, MYMLH_AUTH_URL, MYMLH_TOKEN_URL } from "../mymlh/scopes";
import type { MyMLHUser, Props } from "../types";
import { clientIdAlreadyApproved, parseRedirectApproval, renderApprovalDialog } from "./approval";
import { fetchUpstreamAuthToken, getUpstreamAuthorizeUrl } from "./upstream";

type Bindings = Env & { OAUTH_PROVIDER: OAuthHelpers };

const app = new Hono<{ Bindings: Bindings }>();

app.get("/", (c) =>
  c.json({
    name: "mymlh-mcp-server",
    env: c.env.ENV_NAME ?? "unknown",
    endpoints: ["/mcp", "/sse", "/authorize", "/callback", "/token", "/register"],
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
    return redirectToMyMLH(c.req.raw, oauthReqInfo, c.env.MYMLH_CLIENT_ID);
  }

  return renderApprovalDialog(c.req.raw, {
    client: await c.env.OAUTH_PROVIDER.lookupClient(clientId),
    server: {
      description: "MCP Remote Server using MyMLH (v4) for authentication.",
      logo: "https://static.mlh.io/brand-assets/logo/official/mlh-logo-color.svg",
      name: "MyMLH MCP Server",
    },
    state: { oauthReqInfo },
  });
});

app.post("/authorize", async (c) => {
  try {
    // 5-second cookie forces re-prompt on re-login
    const { state, headers } = await parseRedirectApproval(c.req.raw, c.env.COOKIE_ENCRYPTION_KEY, 5);
    if (!state.oauthReqInfo) return c.text("Invalid request", 400);
    return redirectToMyMLH(c.req.raw, state.oauthReqInfo, c.env.MYMLH_CLIENT_ID, headers);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to process approval";
    return c.text(`Invalid approval submission: ${msg}`, 400);
  }
});

function redirectToMyMLH(
  request: Request,
  oauthReqInfo: AuthRequest,
  client_id: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(null, {
    headers: {
      ...headers,
      location: getUpstreamAuthorizeUrl({
        client_id,
        redirect_uri: new URL("/callback", request.url).href,
        scope: DEFAULT_MYMLH_SCOPES,
        state: btoa(JSON.stringify(oauthReqInfo)),
        upstream_url: MYMLH_AUTH_URL,
      }),
    },
    status: 302,
  });
}

app.get("/callback", async (c) => {
  const stateParam = c.req.query("state");
  if (!stateParam) return c.text("Invalid state", 400);
  let oauthReqInfo: AuthRequest;
  try {
    oauthReqInfo = JSON.parse(atob(stateParam)) as AuthRequest;
  } catch {
    return c.text("Invalid state", 400);
  }
  if (!oauthReqInfo.clientId) return c.text("Invalid state", 400);

  const [accessToken, errResponse, tokenResponse] = await fetchUpstreamAuthToken({
    client_id: c.env.MYMLH_CLIENT_ID,
    client_secret: c.env.MYMLH_CLIENT_SECRET,
    code: c.req.query("code"),
    redirect_uri: new URL("/callback", c.req.url).href,
    upstream_url: MYMLH_TOKEN_URL,
  });
  if (errResponse) return errResponse;

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
      refreshToken: tokenResponse?.refresh_token,
      tokenType: tokenResponse?.token_type,
      expiresIn: tokenResponse?.expires_in,
      accessTokenIssuedAt: Math.floor(Date.now() / 1000),
      scope: tokenResponse?.scope,
    } satisfies Props,
    request: oauthReqInfo,
    scope: oauthReqInfo.scope,
    userId: id,
  });

  return Response.redirect(redirectTo);
});

export { app as MyMLHHandler };
