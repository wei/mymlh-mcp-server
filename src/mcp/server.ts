import { McpServer } from "@modelcontextprotocol/server";
import { getMcpAuthContext } from "agents/mcp/server";
import { name, version } from "../../package.json";
import type { Props } from "../types";
import { registerAllTools } from "./tools";

/**
 * Per-request server factory. The 2026-07-28 spec is stateless, so a fresh
 * server is built for each request and props come from the OAuth-verified
 * auth context rather than Durable Object state.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({ name, version });

  registerAllTools(server, {
    getProps: () => {
      const props = getMcpAuthContext()?.props as Props | undefined;
      if (!props?.accessToken) throw new Error("MCP auth context is unavailable; auth flow did not populate props");
      return props;
    },
  });

  return server;
}
