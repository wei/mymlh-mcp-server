import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { name, version } from "../package.json";
import { MyMLHHandler } from "./mymlh-handler";
import { registerAllTools } from "./tools";
import type { Props } from "./types";

export class MyMCP extends McpAgent<Env, Record<string, never>, Props> {
  server = new McpServer({
    name,
    version,
  });

  async init() {
    await registerAllTools(this.server, {
      env: this.env,
      getProps: () => this.props,
      updateProps: async (next: Props) => {
        await this.updateProps(next);
      },
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
