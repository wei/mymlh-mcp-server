import { env } from "cloudflare:workers";
import OAuthProvider, { OAuthError } from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp/server";
import { createMcpServer } from "./mcp/server";
import { refreshUpstreamProps } from "./mymlh/api";
import { MyMLHHandler } from "./oauth/handler";
import type { Props } from "./types";

// Stateless per the 2026-07-28 spec: no Durable Object, no session ids. The
// same route also serves legacy 2025-era clients via the SDK's fallback.
const mcpHandler = createMcpHandler(() => createMcpServer(), { route: "/mcp" });

export default new OAuthProvider({
  apiHandlers: {
    "/mcp": { fetch: (request, handlerEnv, ctx) => mcpHandler(request, handlerEnv, ctx) },
  },
  authorizeEndpoint: "/authorize",
  clientIdMetadataDocumentEnabled: true,
  // Kept alongside CIMD so clients that cannot serve a metadata document still
  // have Dynamic Client Registration to fall back to.
  clientRegistrationEndpoint: "/register",
  defaultHandler: MyMLHHandler as unknown as ExportedHandler,
  refreshTokenTTL: 24 * 60 * 60,
  tokenEndpoint: "/token",
  // Stateless serving has no per-request place to persist refreshed upstream
  // tokens, so the MyMLH refresh happens here and is written into the grant.
  // Pinning our access token TTL to MyMLH's keeps the two expiring in step.
  tokenExchangeCallback: async (options) => {
    const props = options.props as Props;

    if (options.grantType === "authorization_code") {
      return props.expiresIn ? { accessTokenTTL: props.expiresIn } : undefined;
    }

    if (options.grantType === "refresh_token") {
      const refreshed = await refreshUpstreamProps(env as Env, props);
      if (!refreshed) {
        throw new OAuthError("invalid_grant", { description: "MyMLH refresh token is no longer valid" });
      }
      return { newProps: refreshed, accessTokenTTL: refreshed.expiresIn };
    }
  },
});
