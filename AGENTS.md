# Repository Guidelines

This repository implements an OAuth-enabled MCP remote HTTP server for MyMLH on Cloudflare Workers using TypeScript and Hono.

## Project Structure & Module Organization
- `src/index.ts` — entry; registers MCP tools and routes.
- `src/mymlh-handler.ts` — OAuth approval, callback, and redirects.
- `src/types.ts` — centralized types (`Props`, `MyMLH*`, `ToolContext`).
- `src/constants.ts` — Centralized constants (MyMLH API URLs, OAuth scopes).
- `src/utils.ts` — OAuth helpers (e.g., `getUpstreamAuthorizeUrl`, `requestOAuthToken` (generic token helper for auth code and refresh), and `fetchUpstreamAuthToken` (thin wrapper returning `[accessToken, null, raw]`).
- `src/workers-oauth-utils.ts` — signed-approval cookie + HTML dialog.
- `src/mymlh-api.ts` — shared MyMLH API helpers (token refresh via `requestOAuthToken` + auto-refresh fetch), typed.
- `src/tools/` — modular MCP tools and registry. Multiple related tools may live in one file.
- `src/tools/index.ts` — `registerAllTools(server, { env, getProps, updateProps })`.
  - `src/tools/user.ts` — registers `mymlh_get_user`.
  - `src/tools/tokens.ts` — registers token-related tools (`mymlh_refresh_token`, `mymlh_get_token`).
- Config: `wrangler.jsonc`, `tsconfig.json`, `biome.json`, `.dev.vars(.example)`.

## Build, Test, and Development Commands
- `npm run dev` (alias `npm start`) — run locally via Wrangler at `http://localhost:8788`.
- `npm run deploy` — deploy to Cloudflare Workers.
- `npm run type-check` — TypeScript project type safety.
- `npm run lint` / `npm run lint:fix` — Biome lint/format (check or write).
- `npm run cf-typegen` — generate Cloudflare bindings types. Run if `wrangler.jsonc` changes.

Examples:
- Set local env: copy `.dev.vars.example` to `.dev.vars` and fill values.
- Set Cloudflare secrets: `npx wrangler secret put MYMLH_CLIENT_ID` (repeat for `MYMLH_CLIENT_SECRET`, `COOKIE_ENCRYPTION_KEY`).

## Coding Style & Naming Conventions
- Language: TypeScript (strict). Indent 2 spaces, line width 120, double quotes (Biome enforced).
- Filenames: kebab-case (e.g., `mymlh-handler.ts`).
- Symbols: camelCase for vars/functions; PascalCase for types/classes (e.g., `MyMCP`, `MyMLHUser`); snake_case for constants and MCP tool names.
- Run `npm run lint` before committing; Lefthook runs Biome on staged files (pre-commit) and full project (pre-push).

## Testing Guidelines
- Primary: run `npm run dev`, then exercise tools with MCP Inspector (`npx @modelcontextprotocol/inspector`) against `http://localhost:8788/mcp`.
- Validate OAuth: visit `/authorize` flow; ensure redirect + token exchange completes and tools return data.
- There is no unit-test suite yet; keep changes small and test via Inspector and README flows.

### Adding a new tool (pattern)
- Create a file in `src/tools/` and export `registerX(server, ctx)` that calls `server.tool(...)`. You may group multiple related tools in one module (e.g., `tokens.ts`).
- Use the `ToolContext` from `src/types.ts`: access `env`, `getProps()`, and API helpers.
- Import and call your registrar(s) from `src/tools/index.ts` inside `registerAllTools`.
- Keep types strict (no `any`/`unknown`); extend `Props` or add precise interfaces if needed.

## Commit & Pull Request Guidelines
- Commits: use Conventional Commits (e.g., `feat: add token refresh`, `fix: handle 401 retry`).
- PRs must include: purpose/summary, linked issues, and notes on config/secrets if needed.
- Pre-PR checklist: `npm run type-check && npm run lint`, verify local OAuth + tool calls, update docs (e.g., `AGENTS.md`, `README.md`, `CONTRIBUTING.md`, `DEPLOYMENT.md`) if behavior or endpoints change.

## Security & Configuration Tips
- Never commit secrets. Use `.dev.vars` locally (gitignored) and Wrangler secrets in production.
- Required secrets: `MYMLH_CLIENT_ID`, `MYMLH_CLIENT_SECRET`, `COOKIE_ENCRYPTION_KEY`.

## Documentation Maintenance Policy
- Always update documentation when changing behavior, routes, tools, env vars, config, build commands, or UI.
- Keep all Markdown files consistent. At a minimum, review and update:
  - `AGENTS.md` — process, conventions, expectations for agents and contributors.
  - `README.md` — overview, setup, usage.
  - `CONTRIBUTING.md` — project structure, development setup, development workflow, commit style, branching, PR steps.
  - `DEPLOYMENT.md` — deployment instructions, wrangler commands, secrets, environment-specific notes.
  - `CODE_OF_CONDUCT.md` — only if policy or links change.
  - Any `*.md` and other repo Markdown (e.g., `SECURITY.md`, `CHANGELOG.md`).
- Synchronize examples and references when you rename or change any of the following:
  - Routes/endpoints (e.g., `/mcp`, `/authorize`, callback paths) and tool names.
  - Environment variables, secret names, or defaults in `.dev.vars(.example)` and Wrangler.
  - Commands in `package.json` and their documented usage.
  - HTML approval dialog behavior or parameters in `workers-oauth-utils.ts`.
- Prefer small, surgical doc updates alongside code changes over catch‑up edits later.
