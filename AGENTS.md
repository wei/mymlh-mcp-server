# Repository Guidelines

This repository implements an OAuth-enabled MCP remote HTTP server for MyMLH on Cloudflare Workers using TypeScript and Hono.

## Project Structure & Module Organization
- `src/index.ts` — entry; registers MCP tools and routes.
- `src/mymlh-handler.ts` — OAuth approval, callback, and redirects.
- `src/utils.ts` — MyMLH types and OAuth helpers.
- `src/workers-oauth-utils.ts` — signed-approval cookie + HTML dialog.
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
- Run `npm run lint` before committing; Husky + lint-staged auto-format staged files.

## Testing Guidelines
- Primary: run `npm run dev`, then exercise tools with MCP Inspector (`npx @modelcontextprotocol/inspector`) against `http://localhost:8788/mcp`.
- Validate OAuth: visit `/authorize` flow; ensure redirect + token exchange completes and tools return data.
- There is no unit-test suite yet; keep changes small and test via Inspector and README flows.

## Commit & Pull Request Guidelines
- Commits: use Conventional Commits (e.g., `feat: add token refresh`, `fix: handle 401 retry`).
- PRs must include: purpose/summary, linked issues, screenshots/GIFs for UI changes (approval dialog), and notes on config/secrets if needed.
- Pre-PR checklist: `npm run type-check && npm run lint`, verify local OAuth + tool calls, update docs (e.g., `AGENTS.md`, `README.md`, `CONTRIBUTING.md`, `DEPLOYMENT.md`) if behavior or endpoints change.

## Security & Configuration Tips
- Never commit secrets. Use `.dev.vars` locally (gitignored) and Wrangler secrets in production.
- Required secrets: `MYMLH_CLIENT_ID`, `MYMLH_CLIENT_SECRET`, `COOKIE_ENCRYPTION_KEY`.

## Documentation Maintenance Policy
- Always update documentation when changing behavior, routes, tools, env vars, config, build commands, or UI.
- Keep all Markdown files consistent. At a minimum, review and update:
  - `AGENTS.md` — process, conventions, expectations for agents and contributors.
  - `README.md` — overview, setup, usage (MCP endpoint, local dev, examples).
  - `CONTRIBUTING.md` — development workflow, commit style, branching, PR steps.
  - `DEPLOYMENT.md` — Wrangler commands, secrets, environment-specific notes.
  - `CODE_OF_CONDUCT.md` — only if policy or links change.
  - Any `*.md` and other repo Markdown (e.g., `SECURITY.md`, `CHANGELOG.md`).
- Synchronize examples and references when you rename or change any of the following:
  - Routes/endpoints (e.g., `/mcp`, `/authorize`, callback paths) and tool names.
  - Environment variables, secret names, or defaults in `.dev.vars(.example)` and Wrangler.
  - Commands in `package.json` and their documented usage.
  - HTML approval dialog behavior or parameters in `workers-oauth-utils.ts`.
- PRs should include a short “Docs updated” note summarizing which files were touched and why.
- Prefer small, surgical doc updates alongside code changes over catch‑up edits later.
