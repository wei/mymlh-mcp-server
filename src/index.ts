import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { MyMCP } from "./mcp/agent";
import { MyMLHHandler } from "./oauth/handler";

export { MyMCP };

export default new OAuthProvider({
  apiHandlers: {
    "/sse": MyMCP.serveSSE("/sse"),
    "/mcp": MyMCP.serve("/mcp"),
  },
  authorizeEndpoint: "/authorize",
  clientRegistrationEndpoint: "/register",
  defaultHandler: MyMLHHandler as unknown as ExportedHandler,
  refreshTokenTTL: 24 * 60 * 60,
  tokenEndpoint: "/token",
});
