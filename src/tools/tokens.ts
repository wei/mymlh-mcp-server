import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types";

export function registerTokenTools(server: McpServer, ctx: ToolContext): void {
  // mymlh_refresh_token
  server.tool("mymlh_refresh_token", "Exchange refresh_token for a new access token and persist it", {}, async () => {
    const props = ctx.getProps();
    if (!props.refreshToken) {
      return {
        content: [{ type: "text", text: "No refresh token available. Cannot refresh access token." }],
        isError: true,
      };
    }
    const json = await ctx.refreshUpstreamToken();
    if (!json || !json.access_token) {
      return {
        content: [
          {
            type: "text",
            text: "Failed to refresh token. The refresh token may have been revoked. Please re-authenticate by reconnecting to the MCP server.",
          },
        ],
        isError: true,
      };
    }
    const { accessToken, tokenType, scope, expiresIn, accessTokenIssuedAt } = ctx.getProps();
    const expires_at = accessTokenIssuedAt && expiresIn ? accessTokenIssuedAt + expiresIn : undefined;
    const now = Math.floor(Date.now() / 1000);
    const expires_in = expires_at ? Math.max(0, expires_at - now) : undefined;
    const payload = {
      access_token: accessToken,
      token_type: tokenType,
      scope,
      issued_at: accessTokenIssuedAt,
      ttl: expiresIn,
      expires_in,
      expires_at,
    };
    return { content: [{ type: "text", text: JSON.stringify(payload) }] };
  });

  // mymlh_get_token
  server.tool("mymlh_get_token", "Return current MyMLH access token details", {}, async () => {
    const props = ctx.getProps();
    if (!props.accessToken) {
      return {
        content: [{ type: "text", text: "No access token available. Please authenticate first." }],
        isError: true,
      };
    }
    const { accessToken, tokenType, scope, expiresIn, accessTokenIssuedAt } = props;
    const expires_at = accessTokenIssuedAt && expiresIn ? accessTokenIssuedAt + expiresIn : undefined;
    const now = Math.floor(Date.now() / 1000);
    const expires_in = expires_at ? Math.max(0, expires_at - now) : undefined;
    const payload = {
      access_token: accessToken,
      token_type: tokenType,
      scope,
      issued_at: accessTokenIssuedAt,
      ttl: expiresIn,
      expires_in,
      expires_at,
    };
    return { content: [{ type: "text", text: JSON.stringify(payload) }] };
  });
}
