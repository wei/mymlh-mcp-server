# Repository Guidelines

This repository implements an OAuth-enabled MCP remote HTTP server for MyMLH on Cloudflare Workers using TypeScript and Hono.

## Project Structure & Module Organization
- `src/index.ts` — entry; wires `OAuthProvider` to `MyMCP` and the MyMLH handler.
- `src/types.ts` — centralized types (`Props`, `MyMLH*`, `ToolContext`).
- `src/oauth/handler.ts` — Hono app for `/`, `/authorize` (GET/POST), `/callback`.
- `src/oauth/upstream.ts` — `getUpstreamAuthorizeUrl`, `requestUpstreamToken` (generic auth_code + refresh).
- `src/oauth/approval/` — approval dialog module:
  - `cookie.ts` — HMAC-SHA256 sign/verify, approved-clients cookie helpers, and `signState`/`verifyState` for OAuth state integrity.
  - `dialog.ts` — auto-escaping `renderApprovalDialog`.
  - `index.ts` — `clientIdAlreadyApproved`, `parseRedirectApproval`.
- `src/mymlh/api.ts` — `makeMyMLHApi(env, getProps, updateProps)` returning `fetchMyMLHWithAutoRefresh` (uses an internal `refreshUpstreamToken` for proactive/reactive refresh).
- `src/mymlh/scopes.ts` — `MYMLH_AUTH_URL`, `MYMLH_TOKEN_URL`, `MYMLH_API_BASE`, `DEFAULT_MYMLH_SCOPES`, `ALL_MYMLH_SCOPES`.
- `src/mcp/agent.ts` — `MyMCP extends McpAgent<Env, {}, Props>`; `init()` registers tools.
- `src/mcp/tools/index.ts` — `registerAllTools(server, { env, getProps, updateProps })`.
  - `src/mcp/tools/user.ts` — registers `mymlh_get_user`.
- `test/unit/` — pure-helper tests (cookie, dialog, approval, upstream, api).
- `test/integration/` — workerd-runtime tests via `SELF.fetch` (unauthorized, authorize, callback, tools).
- Config: `wrangler.jsonc`, `tsconfig.json`, `biome.json`, `vitest.config.mts`, `.dev.vars(.example)`, `.github/workflows/ci.yml`.

## Build, Test, and Development Commands
- `npm run dev` (alias `npm start`) — run locally via Wrangler with `local` environment at `http://localhost:8788`.
- `npm run deploy:all` — deploy to all environments (production, alt, fallback).
- `npm run deploy:production` — deploy to `production` environment (mymlh-mcp.git.ci).
- `npm run deploy:alt` — deploy to `alt` environment (mymlh-mcp-alt.git.ci).
- `npm run deploy:fallback` — deploy to `fallback` environment (mymlh-mcp-fallback.git.ci).
- `npm run type-check` — TypeScript project type safety.
- `npm run lint` / `npm run lint:fix` — Biome lint/format (check or write).
- `npm run cf-typegen` — generate Cloudflare bindings types. Run if `wrangler.jsonc` changes.
- `npm test` / `npm run test:watch` — run Vitest in workerd via `@cloudflare/vitest-pool-workers`.

Environment Setup:
- Set local env: copy `.dev.vars.example` to `.dev.vars` and fill values.
- Set Cloudflare secrets per environment: `npx wrangler secret put MYMLH_CLIENT_ID -e production` (repeat for `MYMLH_CLIENT_SECRET`, `COOKIE_ENCRYPTION_KEY` and other environments: `alt`, `fallback`).

## Coding Style & Naming Conventions
- Language: TypeScript (strict). Indent 2 spaces, line width 120, double quotes (Biome enforced).
- Filenames: kebab-case (e.g., `oauth/handler.ts`, `mymlh/api.ts`).
- Symbols: camelCase for vars/functions; PascalCase for types/classes (e.g., `MyMCP`, `MyMLHUser`); snake_case for constants and MCP tool names.
- Run `npm run lint` before committing; Lefthook runs Biome on staged files (pre-commit) and full project (pre-push).

## Testing Guidelines
- `npm test` runs the Vitest suite (unit + integration) in workerd via `@cloudflare/vitest-pool-workers`. CI runs the same.
- Unit tests live under `test/unit/` and cover pure helpers (cookie HMAC, upstream URL/token, approval, MyMLH API auto-refresh).
- Integration tests live under `test/integration/` and hit the worker via `SELF.fetch` (`/`, `/mcp`, `/authorize`, `/callback`).
- Outbound mocks: `vi.stubGlobal("fetch", ...)` works for unit tests; SELF.fetch flows do not currently support outbound mocking, so success-path OAuth assertions are covered via unit tests on the underlying helpers.
- Manual: run `npm run dev` and exercise tools via MCP Inspector (`npx @modelcontextprotocol/inspector`) at `http://localhost:8788/mcp`.
- Environment testing: deploy to `alt` or `fallback` via `npm run deploy:alt` / `deploy:fallback` for staging.

### Adding a new tool (pattern)
- Create a file in `src/mcp/tools/` and export `registerX(server, ctx)` that calls `server.tool(...)`. You may group related tools in one module (e.g., `user.ts`).
- Use the `ToolContext` from `src/types.ts`: access `env`, `getProps()`, and the MyMLH API helpers.
- Import and call your registrar(s) from `src/mcp/tools/index.ts` inside `registerAllTools`.
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
  - HTML approval dialog behavior or parameters in `src/oauth/approval/dialog.ts`.
- Prefer small, surgical doc updates alongside code changes over catch‑up edits later.
