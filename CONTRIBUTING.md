# Contributing to MyMLH MCP Server

Thank you for your interest in contributing to the MyMLH MCP Server! We welcome contributions of all kinds, from bug fixes to new features and documentation improvements.

## Getting Started

Before you begin, please make sure you have the following installed:

- [Node.js](https://nodejs.org/) (latest LTS version recommended)
- [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/)
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) for testing and deployment
- A [MyMLH developer account](https://my.mlh.io/developers) to get API credentials

## Development Setup

1.  **Fork and Clone the Repository**

    Start by forking the repository to your own GitHub account, and then clone it to your local machine:

    ```bash
    git clone https://github.com/YOUR_USERNAME/mymlh-mcp-server.git
    cd mymlh-mcp-server
    ```

2.  **Install Dependencies**

    Install the project dependencies using npm:

    ```bash
    npm install
    ```

3.  **Set Up Local Environment Variables**

    For local development, you'll need a MyMLH application. Create one in the [MyMLH developer portal](https://my.mlh.io/developers) with the following settings:

    -   **Homepage URL**: `http://localhost:8788`
    -   **Authorization callback URL**: `http://localhost:8788/callback`

    Once created, copy the `.dev.vars.example` file to a new file named `.dev.vars` and fill in your development credentials:

    ```
    MYMLH_CLIENT_ID=your_dev_mymlh_client_id
    MYMLH_CLIENT_SECRET=your_dev_mymlh_client_secret
    COOKIE_ENCRYPTION_KEY=generate_a_random_32_byte_hex_string
    ```

    You can generate a `COOKIE_ENCRYPTION_KEY` by running `openssl rand -hex 32` in your terminal.

4.  **Run the Development Server**

    Start the local development server using the npm script:

    ```bash
    npm run dev
    ```

    This will automatically use the `local` environment configuration. Your server will be running at `http://localhost:8788`.

### Project Structure

```
src/
├── index.ts                 # MCP entry; registers tools
├── mymlh-handler.ts         # OAuth approval, callback, redirects
├── types.ts                 # Centralized types: Props, MyMLH*, ToolContext
├── constants.ts             # Centralized constants (MyMLH API URLs, OAuth scopes)
├── utils.ts                 # OAuth helpers (authorize URL, token helpers)
├── workers-oauth-utils.ts   # Approval cookie + dialog helpers
├── mymlh-api.ts             # MyMLH API helpers (refresh + auto-refresh)
└── tools/
    ├── index.ts             # registerAllTools (uses ToolContext from src/types.ts)
    ├── user.ts              # mymlh_get_user
    └── tokens.ts            # mymlh_refresh_token, mymlh_get_token

```

## Testing Your Changes

To test your changes locally, you can use the [Model Context Protocol Inspector](https://modelcontextprotocol.io/docs/tools/inspector):

```bash
npx @modelcontextprotocol/inspector@latest
```

Connect the Inspector to your local server at `http://localhost:8788/mcp`. You'll be redirected to MyMLH to authenticate, and then you can test the available tools.

### Modular Tools Pattern

Tools are modular and live under `src/tools/`:

– Use `ToolContext` from `src/types.ts` for `env`, `getProps()`, and MyMLH API helpers.
- Add a registrar `registerX(server, ctx)` in a new file and import it in `src/tools/index.ts`. Multiple related tools can be colocated in a single module (e.g., `tokens.ts`) and registered via a group function (e.g., `registerTokenTools(server, ctx)`).
- Keep types strict (avoid `any`/`unknown`). If you need arguments, add a precise schema and types.

Shared MyMLH API helpers are in `src/mymlh-api.ts` (token refresh via the generic `requestOAuthToken` + `fetchMyMLHWithAutoRefresh`) to keep logic consistent across tools.

### Add a New Tool

1) Create a registrar in `src/tools/your-tool.ts`:

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types";

export function registerYourTool(server: McpServer, ctx: ToolContext): void {
  server.tool("your_tool_name", "Describe your tool", /* schema */ {}, async () => {
    const props = ctx.getProps();
    // Optionally call ctx.fetchMyMLHWithAutoRefresh or ctx.refreshUpstreamToken
    return { content: [{ type: "text", text: "ok" }] };
  });
}
```

2) Wire it up in `src/tools/index.ts`:

```ts
import { registerYourTool } from "./your-tool";
// ... inside registerAllTools(...)
registerYourTool(server, ctx);
```

3) Check types and lint:

```bash
npm run type-check && npm run lint
```

4) Test via Inspector on `http://localhost:8788/mcp`.

## Contribution Guidelines

### Code Style

This project uses [Biome](https://biomejs.dev/) for code formatting and linting. Before committing your changes, please run the following command to ensure your code adheres to the project's style:

```bash
npm run lint
```

Git hooks are managed by [Lefthook](https://github.com/evilmartians/lefthook). Running `npm install` will install hooks via the `prepare` script. Hooks run Biome formatting + lint on staged files at pre-commit and a full Biome check at pre-push using the local Biome package (no `npx`).

### Commit Messages

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification. Please ensure your commit messages are descriptive and follow this format. This helps us automate releases and generate changelogs.

### Documentation Maintenance

Always keep documentation current with code changes. When you modify behavior, routes, tools, environment variables, config, build commands, or UI (approval dialog), update all relevant Markdown files in the same PR. At a minimum, review and update:

- `AGENTS.md` — process, conventions, and expectations.
- `README.md` — overview, setup, usage, endpoints.
- `CONTRIBUTING.md` — workflow and checklists.
- `DEPLOYMENT.md` — Wrangler commands, secrets, environments.
- `CODE_OF_CONDUCT.md` — only if policy/links change.
- Any `*.md` and other repo Markdown (e.g., `SECURITY.md`, `CHANGELOG.md`).

Also synchronize examples when renaming or changing:

- Routes/endpoints (e.g., `/mcp`, `/authorize`, callback paths) and tool names.
- Environment variables or secret names in `.dev.vars(.example)` and Wrangler.
- `package.json` scripts and documented usage.
- HTML approval dialog parameters/behavior in `workers-oauth-utils.ts`.
- Project structure (e.g., new files in `src/tools/`, `src/mymlh-api.ts`).

### Pull Request Process

1.  Create a new branch for your feature or bug fix:
    ```bash
    git checkout -b my-new-feature
    ```
2.  Make your changes and commit them with a clear message.
3.  Push your branch to your fork:
    ```bash
    git push origin my-new-feature
    ```
4.  Open a pull request from your fork to the main repository.
5.  In your pull request description, please explain the changes you've made and why.

#### Pre‑PR Checklist

- `npm run type-check && npm run lint` pass locally.
- Local OAuth flow verified (`/authorize` → callback → tools work via Inspector).
- Documentation updated as needed (e.g., `AGENTS.md`, `README.md`, `CONTRIBUTING.md`, `DEPLOYMENT.md`).
- Include a brief “Docs updated” note listing which docs changed and why.
  - Example: "Docs updated: README (project structure, add-tool guide), AGENTS (tools folder), CONTRIBUTING (modular tools pattern)."

## Code of Conduct

Please note that this project is released with a [Contributor Code of Conduct](CODE_OF_CONDUCT.md). By participating in this project you agree to abide by its terms.

## Questions?

If you have any questions, feel free to open an issue on GitHub.
