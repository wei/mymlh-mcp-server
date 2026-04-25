import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { name, version } from "../../package.json";
import type { Props } from "../types";
import { registerAllTools } from "./tools";

export class MyMCP extends McpAgent<Env, Record<string, never>, Props> {
  server = new McpServer({ name, version });

  async init() {
    await registerAllTools(this.server, {
      env: this.env,
      getProps: () => this.props || ({} as Props),
      updateProps: async (next: Props) => {
        await this.updateProps(next);
      },
    });
  }
}
