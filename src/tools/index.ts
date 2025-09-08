import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { makeMyMLHApi } from "../mymlh-api";
import type { Props, ToolContext } from "../types";
import { registerTokenTools } from "./tokens";
import { registerUserTools } from "./user";

export function registerAllTools(
  server: McpServer,
  deps: { env: Env; getProps: () => Props; updateProps: (next: Props) => Promise<void> },
): void {
  const api = makeMyMLHApi(deps.env, deps.getProps, deps.updateProps);
  const ctx: ToolContext = { env: deps.env, getProps: deps.getProps, ...api };

  registerUserTools(server, ctx);
  registerTokenTools(server, ctx);
}
