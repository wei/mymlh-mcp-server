import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import { ALL_MYMLH_SCOPES, type MyMLHUser, type Props, fetchUpstreamAuthToken, getUpstreamAuthorizeUrl } from "./utils";
import { clientIdAlreadyApproved, parseRedirectApproval, renderApprovalDialog } from "./workers-oauth-utils";

const app = new Hono<{ Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers } }>();

app.get("/authorize", async (c) => {
  const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  const { clientId } = oauthReqInfo;
  if (!clientId) {
    return c.text("Invalid request", 400);
  }

  if (await clientIdAlreadyApproved(c.req.raw, oauthReqInfo.clientId, c.env.COOKIE_ENCRYPTION_KEY)) {
    return redirectToMyMLH(c.req.raw, oauthReqInfo, c.env.MYMLH_CLIENT_ID);
  }

  return renderApprovalDialog(c.req.raw, {
    client: await c.env.OAUTH_PROVIDER.lookupClient(clientId),
    server: {
      description: "MCP Remote Server using MyMLH (v4) for authentication.",
      logo: "https://static.mlh.io/brand-assets/logo/official/mlh-logo-color.svg",
      name: "MyMLH MCP Server", // optional
    },
    state: { oauthReqInfo }, // arbitrary data that flows through the form submission below
  });
});

app.post("/authorize", async (c) => {
  // Validates form submission, extracts state, and generates Set-Cookie headers to skip approval dialog next time
  const { state, headers } = await parseRedirectApproval(c.req.raw, c.env.COOKIE_ENCRYPTION_KEY);
  if (!state.oauthReqInfo) {
    return c.text("Invalid request", 400);
  }

  return redirectToMyMLH(c.req.raw, state.oauthReqInfo, c.env.MYMLH_CLIENT_ID, headers);
});

async function redirectToMyMLH(
  request: Request,
  oauthReqInfo: AuthRequest,
  client_id: string,
  headers: Record<string, string> = {},
) {
  return new Response(null, {
    headers: {
      ...headers,
      location: getUpstreamAuthorizeUrl({
        client_id,
        redirect_uri: new URL("/callback", request.url).href,
        scope: ALL_MYMLH_SCOPES,
        state: btoa(JSON.stringify(oauthReqInfo)),
        upstream_url: "https://my.mlh.io/oauth/authorize",
      }),
    },
    status: 302,
  });
}

/**
 * OAuth Callback Endpoint
 *
 * This route handles the callback from MyMLH after user authentication.
 * It exchanges the temporary code for an access token, then stores some
 * user metadata & the auth token as part of the 'props' on the token passed
 * down to the client. It ends by redirecting the client back to _its_ callback URL
 */
app.get("/callback", async (c) => {
  // Get the oathReqInfo out of KV
  const oauthReqInfo = JSON.parse(atob(c.req.query("state") as string)) as AuthRequest;
  if (!oauthReqInfo.clientId) {
    return c.text("Invalid state", 400);
  }

  // Exchange the code for an access token
  const [accessToken, errResponse, tokenResponse] = await fetchUpstreamAuthToken({
    client_id: c.env.MYMLH_CLIENT_ID,
    client_secret: c.env.MYMLH_CLIENT_SECRET,
    code: c.req.query("code"),
    redirect_uri: new URL("/callback", c.req.url).href,
    upstream_url: "https://my.mlh.io/oauth/token",
  });
  if (errResponse) return errResponse;

  // Fetch the user info from MyMLH
  const meResp = await fetch("https://api.mlh.com/v4/users/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!meResp.ok) {
    return c.text("Failed to fetch MyMLH user info", 502);
  }
  const me: MyMLHUser = (await meResp.json()) as MyMLHUser;
  const { id, first_name, last_name, email } = me;

  // Return back to the MCP client a new token
  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    metadata: {
      label: `${first_name} ${last_name}`.trim(),
    },
    // This will be available on this.props inside MyMCP
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
    } as Props,
    request: oauthReqInfo,
    scope: oauthReqInfo.scope,
    userId: id,
  });

  return Response.redirect(redirectTo);
});

export { app as MyMLHHandler };
