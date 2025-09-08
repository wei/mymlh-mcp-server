import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MYMLH_API_BASE } from "../constants";
import type { MyMLHUser, ToolContext } from "../types";

export function registerUserTools(server: McpServer, ctx: ToolContext): void {
  server.tool("mymlh_get_user", "Fetch current MyMLH user profile", {}, async () => {
    const url = `${MYMLH_API_BASE}/users/me?expand[]=education&expand[]=professional_experience&expand[]=address`;
    const resp = await ctx.fetchMyMLHWithAutoRefresh(url);
    if (!resp.ok) {
      if (resp.status === 401) {
        return {
          content: [
            {
              type: "text",
              text: "Authentication with MyMLH expired or revoked. Re-auth via /authorize.",
            },
          ],
        };
      }
      return { content: [{ type: "text", text: `Failed: ${resp.status}` }] };
    }
    const full: MyMLHUser = (await resp.json()) as MyMLHUser;
    return { content: [{ type: "text", text: JSON.stringify(full) }] };
  });
}
