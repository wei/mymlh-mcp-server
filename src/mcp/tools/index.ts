import type { McpServer } from "@modelcontextprotocol/server";
import { makeMyMLHApi } from "../../mymlh/api";
import type { Props, ToolContext } from "../../types";
import { registerUserTools } from "./user";

export function registerAllTools(server: McpServer, deps: { getProps: () => Props }): void {
  const api = makeMyMLHApi(deps.getProps);
  const ctx: ToolContext = {
    getProps: deps.getProps,
    fetchMyMLH: api.fetchMyMLH,
  };

  registerUserTools(server, ctx);
}
