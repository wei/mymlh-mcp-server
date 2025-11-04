import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MYMLH_API_BASE } from "../constants";
import type { MyMLHUser, ToolContext } from "../types";

export function registerUserTools(server: McpServer, ctx: ToolContext): void {
  server.tool("mymlh_get_user", "Fetch current MyMLH user profile", {}, async () => {
    const { scope } = ctx.getProps();

    const url = new URL(`${MYMLH_API_BASE}/users/me`);
    if (scope?.includes("user:read:education")) url.searchParams.append("expand[]", "education");
    if (scope?.includes("user:read:employment")) url.searchParams.append("expand[]", "professional_experience");
    if (scope?.includes("user:read:address")) url.searchParams.append("expand[]", "address");

    const resp = await ctx.fetchMyMLHWithAutoRefresh(url.toString());
    if (!resp.ok) {
      if (resp.status === 401) {
        return {
          content: [
            {
              type: "text",
              text: "Authentication with MyMLH expired or revoked. Please re-authenticate by reconnecting to the MCP server.",
            },
          ],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: `Failed: ${resp.status}` }], isError: true };
    }
    const full: MyMLHUser = (await resp.json()) as MyMLHUser;
    return { content: [{ type: "text", text: JSON.stringify(full) }] };
  });
}
