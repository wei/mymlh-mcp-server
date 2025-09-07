import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { name, version } from "../package.json";
import { MyMLHHandler } from "./mymlh-handler";
import type { MyMLHUser, Props } from "./utils";

export class MyMCP extends McpAgent<Env, Record<string, never>, Props> {
  server = new McpServer({
    name,
    version,
  });

  // Refresh upstream MyMLH token using refresh_token; persists props when successful
  private async refreshUpstreamToken(): Promise<{
    access_token?: string;
    refresh_token?: string;
    token_type?: string;
    scope?: string;
    expires_in?: number;
  } | null> {
    if (!this.props.refreshToken) return null;
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: this.env.MYMLH_CLIENT_ID,
      client_secret: this.env.MYMLH_CLIENT_SECRET,
      refresh_token: this.props.refreshToken,
    }).toString();
    const refreshResp = await fetch("https://my.mlh.io/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!refreshResp.ok) return null;
    const tokenJson = (await refreshResp.json()) as {
      access_token?: string;
      refresh_token?: string;
      token_type?: string;
      scope?: string;
      expires_in?: number;
    };
    if (tokenJson.access_token) {
      await this.updateProps({
        ...this.props,
        accessToken: tokenJson.access_token,
        refreshToken: tokenJson.refresh_token ?? this.props.refreshToken,
        tokenType: tokenJson.token_type ?? this.props.tokenType,
        scope: tokenJson.scope ?? this.props.scope,
        expiresIn: tokenJson.expires_in ?? this.props.expiresIn,
        accessTokenIssuedAt: Math.floor(Date.now() / 1000),
      });
    }
    return tokenJson;
  }

  // Unified MyMLH fetch with preemptive and on-401 refresh
  private async fetchMyMLHWithAutoRefresh(url: string, init?: RequestInit): Promise<Response> {
    const now = Math.floor(Date.now() / 1000);
    const issuedAt = this.props.accessTokenIssuedAt ?? 0;
    const expiresIn = this.props.expiresIn ?? 0;
    const expAt = issuedAt + expiresIn;
    const refreshThresholdSeconds = 60; // proactively refresh ~1 minute before expiry

    // Preemptive refresh window
    let effectiveAccessToken = this.props.accessToken;
    if (expiresIn && now >= expAt - refreshThresholdSeconds) {
      const refreshed = await this.refreshUpstreamToken();
      if (refreshed?.access_token) {
        // Use the just-refreshed token immediately to avoid stale in-memory props
        effectiveAccessToken = refreshed.access_token;
      }
    }

    const withAuth = (token: string): RequestInit => ({
      ...(init ?? {}),
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${token}`,
      } as Record<string, string>,
    });

    let resp = await fetch(url, withAuth(effectiveAccessToken));

    if (resp.status === 401) {
      const refreshed = await this.refreshUpstreamToken();
      const retryToken = refreshed?.access_token ?? this.props.accessToken;
      resp = await fetch(url, withAuth(retryToken));
    }
    return resp;
  }

  async init() {
    // MyMLH: Get current user info
    this.server.tool("mymlh_get_user_info", "Fetch current MyMLH user", {}, async () => {
      const url =
        "https://api.mlh.com/v4/users/me?expand[]=education&expand[]=professional_experience&expand[]=address";

      const resp = await this.fetchMyMLHWithAutoRefresh(url);
      if (!resp.ok) {
        if (resp.status === 401) {
          const text =
            "Authentication with MyMLH has expired or was revoked. Please re-authenticate via this server's /authorize endpoint, then retry.";
          return { content: [{ type: "text", text }] };
        }
        return { content: [{ type: "text", text: `Failed: ${resp.status}` }] };
      }
      const full: MyMLHUser = (await resp.json()) as MyMLHUser;
      return { content: [{ type: "text", text: JSON.stringify(full) }] };
    });

    // MyMLH: Refresh token
    this.server.tool(
      "mymlh_refresh_token",
      "Exchange MyMLH refresh_token for a new access token and persist it",
      {},
      async () => {
        if (!this.props.refreshToken) {
          return { content: [{ type: "text", text: "No refresh token available" }] };
        }
        const json = await this.refreshUpstreamToken();
        if (!json || !json.access_token) {
          return { content: [{ type: "text", text: "Failed to refresh token" }] };
        }
        const { accessToken, tokenType, scope, expiresIn, accessTokenIssuedAt } = this.props;
        const expires_at = accessTokenIssuedAt && expiresIn ? accessTokenIssuedAt + expiresIn : undefined;
        const now = Math.floor(Date.now() / 1000);
        const expires_in = expires_at ? Math.max(0, expires_at - now) : undefined;
        const payload = {
          access_token: accessToken,
          token_type: tokenType,
          scope,
          issued_at: accessTokenIssuedAt,
          // the original TTL in seconds from MyMLH
          ttl: expiresIn,
          // expires_in is the remaining seconds until expiration (dynamic)
          expires_in,
          expires_at,
        };
        return { content: [{ type: "text", text: JSON.stringify(payload) }] };
      },
    );

    // MyMLH: Inspect current token details
    this.server.tool("mymlh_get_token_details", "Return current MyMLH access token details", {}, async () => {
      if (!this.props.accessToken) {
        return { content: [{ type: "text", text: "No access token available" }] };
      }
      const { accessToken, tokenType, scope, expiresIn, accessTokenIssuedAt } = this.props;
      const expires_at = accessTokenIssuedAt && expiresIn ? accessTokenIssuedAt + expiresIn : undefined;
      const now = Math.floor(Date.now() / 1000);
      const expires_in = expires_at ? Math.max(0, expires_at - now) : undefined;
      const payload = {
        access_token: accessToken,
        token_type: tokenType,
        scope,
        issued_at: accessTokenIssuedAt,
        // the original TTL in seconds from MyMLH
        ttl: expiresIn,
        // expires_in is the remaining seconds until expiration (dynamic)
        expires_in,
        expires_at,
      };
      return { content: [{ type: "text", text: JSON.stringify(payload) }] };
    });
  }
}

export default new OAuthProvider({
  // NOTE - during the summer 2025, the SSE protocol was deprecated and replaced by the Streamable-HTTP protocol
  // https://developers.cloudflare.com/agents/model-context-protocol/transport/#mcp-server-with-authentication
  apiHandlers: {
    "/sse": MyMCP.serveSSE("/sse"), // deprecated SSE protocol - use /mcp instead
    "/mcp": MyMCP.serve("/mcp"), // Streamable-HTTP protocol
  },
  authorizeEndpoint: "/authorize",
  clientRegistrationEndpoint: "/register",
  defaultHandler: MyMLHHandler as any,
  tokenEndpoint: "/token",
});
