import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { name, version } from "../../package.json";
import type { Props } from "../types";
import { registerAllTools } from "./tools";

export class MyMCP extends McpAgent<Env, Record<string, never>, Props> {
  server = new McpServer({ name, version });

  async init() {
    registerAllTools(this.server, {
      env: this.env,
      getProps: () => {
        if (!this.props) throw new Error("MyMCP.props is unavailable; auth flow did not populate context");
        return this.props;
      },
      updateProps: (next: Props) => this.updateProps(next),
    });
  }
}
