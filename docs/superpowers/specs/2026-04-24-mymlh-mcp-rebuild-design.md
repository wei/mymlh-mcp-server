# MyMLH MCP Server Rebuild — Design

**Date:** 2026-04-24
**Branch:** `rebuild/from-scratch`
**Scope:** Full code-level rebuild of `mymlh-mcp-server` on Cloudflare Workers, preserving all external behavior, OAuth flow, deployment environments, KV, routes, DO class name, and user-visible experience. Internal layout, test coverage, CI, and dependency versions modernized.

## 1. Goals and Non-Goals

**Goals**
- Rewrite `src/` from scratch with a clean module layout.
- Upgrade all dependencies to current majors.
- Add `@cloudflare/vitest-pool-workers` test suite with unit + integration coverage.
- Add GitHub Actions CI running `type-check`, `lint`, `test`.
- Preserve external surface: routes, OAuth flow, KV bindings, DO class name, custom domains, secrets, deployment commands.

**Non-Goals**
- No change to public endpoints (`/mcp`, `/sse`, `/authorize`, `/callback`, `/token`, `/register`).
- No change to the 3 existing tools (`mymlh_get_user`, `mymlh_get_token`, `mymlh_refresh_token`).
- No change to `wrangler.jsonc` environment names, KV IDs, route patterns, DO class name (`MyMCP`), or migration tag (`v1`).
- No visible change to the OAuth approval dialog fields or behavior.
- No new MCP tools, no new features beyond light hygiene (liveness route, Zod schemas, dead-dep pruning).

## 2. External Surface (Unchanged)

- **Routes per env:** `mymlh-mcp.git.ci` (production), `mymlh-mcp-alt.git.ci` (alt), `mymlh-mcp-fallback.git.ci` (fallback), `http://localhost:8788` (local).
- **Endpoints:** `GET/POST /authorize`, `GET /callback`, `POST /token`, `POST /register`, `GET /mcp` (Streamable-HTTP), `GET /sse` (deprecated SSE).
- **Secrets per env:** `MYMLH_CLIENT_ID`, `MYMLH_CLIENT_SECRET`, `COOKIE_ENCRYPTION_KEY`.
- **Bindings per env:** `OAUTH_KV` (KV namespace), `MCP_OBJECT` (DO binding → class `MyMCP`).
- **DO migrations:** tag `v1`, `new_sqlite_classes: ["MyMCP"]`.
- **OAuth flow:** PKCE via `@cloudflare/workers-oauth-provider`; upstream MyMLH OAuth 2.0 (`https://my.mlh.io/oauth/authorize`, `https://my.mlh.io/oauth/token`); `prompt=consent`; approval cookie `mcp-approved-clients` (HMAC-SHA256, 1-year by default, 5-second on re-approval to force re-prompt); refresh-token TTL 24h; auto-refresh ~60s before expiry; single 401 retry; clears tokens on second 401.
- **Tools:** `mymlh_get_user`, `mymlh_get_token`, `mymlh_refresh_token` — same names, descriptions, input shapes, output shapes.

## 3. Architecture

Stack (unchanged):
- `@cloudflare/workers-oauth-provider` wrapping the worker, handling `/register`, `/token`, PKCE, token introspection.
- `McpAgent` from `agents/mcp`, backing the `MyMCP` Durable Object (sqlite-class), for session-scoped `props` + MCP transport handling.
- `@modelcontextprotocol/sdk` `McpServer` for tool registration with Zod input schemas.
- `hono` for the `MyMLHHandler` default handler (`/authorize`, `/callback`, optional `/` liveness).

Module boundaries:

```
src/
├── index.ts                  # OAuthProvider wiring; exports { default, MyMCP }
├── mcp/
│   ├── agent.ts              # MyMCP extends McpAgent<Env, {}, Props>; init() builds ToolContext, calls registerAllTools
│   └── tools/
│       ├── index.ts          # registerAllTools(server, { env, getProps, updateProps })
│       ├── user.ts           # mymlh_get_user
│       └── tokens.ts         # mymlh_get_token, mymlh_refresh_token
├── oauth/
│   ├── handler.ts            # Hono<{ Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers } }> — GET/POST /authorize, GET /callback, GET / liveness
│   ├── upstream.ts           # getUpstreamAuthorizeUrl + requestUpstreamToken (auth_code | refresh_token) + fetchUpstreamAuthToken thin wrapper
│   └── approval/
│       ├── cookie.ts         # importKey, signPayload, verifyPayload, readApprovedClients, buildSetCookie
│       ├── dialog.ts         # html`...` tagged-template helper with auto-escape; renderApprovalDialog(request, options): Response
│       └── index.ts          # clientIdAlreadyApproved(request, clientId, secret); parseRedirectApproval(request, secret, cookieMaxAgeSeconds?)
├── mymlh/
│   ├── api.ts                # makeMyMLHApi(env, getProps, updateProps) → { refreshUpstreamToken, fetchMyMLHWithAutoRefresh }
│   └── scopes.ts             # MYMLH_AUTH_URL, MYMLH_TOKEN_URL, MYMLH_API_BASE, DEFAULT_MYMLH_SCOPES, ALL_MYMLH_SCOPES
└── types.ts                  # Props, MyMLHUser (+ Profile/Education/Employment/Address), MyMLHTokenResponse, ToolContext
```

Each module has one clear purpose and a narrow, well-typed public surface. `src/oauth/approval/` replaces the 637-line monolithic `workers-oauth-utils.ts`. Tool modules depend only on `ToolContext`, making them trivial to unit-test.

## 4. OAuth + MCP Request Flow (Unchanged)

1. MCP client → `GET /mcp` (or `/sse`). `OAuthProvider` checks `Authorization: Bearer`. If missing/invalid, responds with `WWW-Authenticate` per MCP spec 2025-06-18 so the client discovers `/register`, `/authorize`, `/token`.
2. Client → `POST /register` (RFC 7591 dynamic client registration), handled by `OAuthProvider`, persisted in `OAUTH_KV`.
3. Client → `GET /authorize?...` → `MyMLHHandler`:
   - `OAUTH_PROVIDER.parseAuthRequest(request)` → if `clientIdAlreadyApproved` (signed cookie), 302 to MyMLH with `prompt=consent`, `state = btoa(JSON.stringify(oauthReqInfo))`.
   - Else render approval dialog. POST `/authorize` validates state via `parseRedirectApproval`, writes 5-second approval cookie, 302 to MyMLH.
4. MyMLH → `GET /callback?code=...&state=...`:
   - Decode state, call `requestUpstreamToken({ grant_type: "authorization_code", ... })` against `MYMLH_TOKEN_URL`.
   - Fetch `${MYMLH_API_BASE}/users/me` with the access token.
   - `OAUTH_PROVIDER.completeAuthorization({ metadata, props, request: oauthReqInfo, scope, userId })` → 302 to client's `redirect_uri` with our authorization code.
5. Client → `POST /token` (PKCE code exchange) → `OAuthProvider` issues MCP access token backed by `props`.
6. `MyMCP` DO hydrated with `props` per session. `init()` builds `ToolContext` via `makeMyMLHApi(env, () => this.props, next => this.updateProps(next))` and calls `registerAllTools(this.server, { env, getProps, updateProps })`.
7. Tool invocations use `ctx.fetchMyMLHWithAutoRefresh(url)`:
   - Proactive refresh if `now >= issuedAt + expiresIn - 60`.
   - On 401 after call, one refresh + retry; on second 401, clear tokens and surface an auth-expired error.
   - Successful refresh persists via `updateProps`.

## 5. Approval Dialog Module

Split the vendored `workers-oauth-utils.ts` into three focused files under `src/oauth/approval/`.

**`cookie.ts`** — pure crypto/cookie logic, no HTTP/DOM coupling.
- `importKey(secret: string): Promise<CryptoKey>`
- `signPayload(key, payload): Promise<string>` — returns hex-encoded HMAC-SHA256.
- `verifyPayload(key, signatureHex, payload): Promise<boolean>`
- `readApprovedClients(cookieHeader: string | null, secret: string): Promise<string[] | null>`
- `buildSetCookie(clientIds: string[], secret: string, maxAgeSeconds: number): Promise<string>`

**`dialog.ts`** — pure templating.
- `html` tagged-template helper that escapes all interpolations (replaces ad-hoc `sanitizeHtml` calls).
- `renderApprovalDialog(request: Request, options: ApprovalDialogOptions): Response` — same DOM structure, same CSS variables, same Approve/Cancel form POSTing to same pathname. Accessibility: `aria-label` on logo image, `type="button"` on Cancel.

**`index.ts`** — public API preserved.
- `clientIdAlreadyApproved(request, clientId, secret): Promise<boolean>` — delegates to `readApprovedClients`.
- `parseRedirectApproval(request, secret, cookieMaxAgeSeconds?): Promise<{ state, headers }>` — extracts `oauthReqInfo.clientId` from encoded state, dedups into approved set, returns `Set-Cookie` header.

Cookie name `mcp-approved-clients`, format `hex(sig).base64(json)`, attributes `HttpOnly; Secure; Path=/; SameSite=Lax`. `Max-Age` defaults to 1 year (31 536 000 s); `parseRedirectApproval` is invoked with `cookieMaxAgeSeconds = 5` from the POST `/authorize` handler so re-approvals force a near-immediate re-prompt, matching current behavior.

## 6. Dependency Versions

All latest as of 2026-04-24.

| Package | Version |
|---|---|
| `@cloudflare/workers-oauth-provider` | 0.4.0 |
| `@modelcontextprotocol/sdk` | 1.29.0 |
| `agents` | 0.11.5 |
| `hono` | 4.12.15 |
| `zod` | 4.3.6 |
| `wrangler` | 4.85.0 |
| `@biomejs/biome` | 2.4.13 |
| `typescript` | 6.0.3 |
| `@types/node` | 25.6.0 |
| `lefthook` | 2.1.6 |
| `@cloudflare/vitest-pool-workers` | 0.15.0 |
| `vitest` | 4.1.5 |

Dropped: `just-pick`, `workers-mcp` (unused).

Peer compatibility verified:
- `@cloudflare/vitest-pool-workers@0.15.0` requires `vitest@^4.1.0`.
- `@modelcontextprotocol/sdk@1.29.0` accepts `zod@^3.25 || ^4.0`.
- `agents@0.11.5` requires `zod@^4.0.0` (server-only usage, other peer deps are optional).
- `agents@0.11.5` still exports `./mcp` (i.e., `import { McpAgent } from "agents/mcp"` remains valid).

**Named adaptation steps** in implementation (for breaking-change exposure):
1. `agents` 0.2 → 0.11: review current `McpAgent` generics, `init()`, `this.props`, `this.updateProps`, `serve()` / `serveSSE()` signatures against this repo's usage and adapt.
2. `@cloudflare/workers-oauth-provider` 0.1 → 0.4: confirm `OAuthProvider({ apiHandlers, authorizeEndpoint, tokenEndpoint, clientRegistrationEndpoint, defaultHandler, refreshTokenTTL })` shape and `OAUTH_PROVIDER.parseAuthRequest` / `lookupClient` / `completeAuthorization` helper signatures.
3. `typescript` 5.9 → 6.0: trial compile, resolve any new strictness errors.

## 7. Tests

**Framework.** `vitest@4` with `@cloudflare/vitest-pool-workers@0.15` plugin.

**`vitest.config.ts`** uses the `cloudflareTest` plugin with `wrangler.jsonc` (env `local`):

```ts
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: { compatibilityFlags: ["nodejs_compat"] },
    }),
  ],
});
```

All tests run in the workers pool via the `cloudflareTest` plugin; no separate Node pool is configured.

**Unit tests** (pure helpers, workerd runtime, no binding I/O):
- `test/unit/cookie.test.ts` — sign/verify round-trip; tamper detection; malformed cookie returns `null`; dedup in `buildSetCookie`.
- `test/unit/upstream.test.ts` — `getUpstreamAuthorizeUrl` produces correct query (`response_type=code`, `prompt=consent`, `scope`, `state`); `requestUpstreamToken` formats `application/x-www-form-urlencoded` body for both grants; handles non-2xx and network-error paths.
- `test/unit/api.test.ts` — proactive refresh triggers ~60s before expiry; single 401 triggers refresh+retry; double 401 clears tokens; `updateProps` called with merged token fields on success.
- `test/unit/dialog.test.ts` — `renderApprovalDialog` returns `text/html; charset=utf-8`; escapes `<script>` from `clientName`; includes fields when present; omits sections when absent.

**Integration tests** (workerd via pool-workers; outbound HTTP mocked with miniflare `fetchMock`):
- `/mcp` without `Authorization` → 401 with `WWW-Authenticate` header.
- `GET /authorize` missing params → 400.
- `GET /authorize` with valid params + no approval cookie → HTML approval dialog.
- `POST /authorize` with valid encoded state → 302 to `my.mlh.io/oauth/authorize` with correct params; approval cookie set.
- `GET /callback` with mocked upstream (`my.mlh.io/oauth/token` + `api.mlh.com/v4/users/me`) → 302 to client `redirect_uri`; subsequent `POST /token` issues access token whose `props` include expected MyMLH user fields.
- `POST /mcp` with authorization → `tools/list` returns 3 tools; `tools/call mymlh_get_user` with mocked `/users/me` returns expected payload.

Test imports use the canonical pattern:

```ts
import { exports, env } from "cloudflare:workers";
```

## 8. CI

`.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 24 # accepts 'lts/*' as a more conservative alternative
          cache: npm
      - run: npm ci
      - run: npm run type-check
      - run: npm run lint
      - run: npm test
```

No deploy step; `wrangler deploy` stays manual. Dependabot (`.github/dependabot.yml`) retained as-is.

## 9. Wrangler & Deployment (Unchanged)

- All four `env` blocks preserved verbatim: `production`, `alt`, `fallback`, `local`.
- KV IDs preserved.
- Route patterns preserved (`mymlh-mcp.git.ci`, `mymlh-mcp-alt.git.ci`, `mymlh-mcp-fallback.git.ci`).
- DO `migrations: [{ tag: "v1", new_sqlite_classes: ["MyMCP"] }]` preserved; class name `MyMCP` unchanged → no DO data migration required for production rollout.
- `compatibility_date` bumped to a current stable date as part of the wrangler upgrade; `compatibility_flags: ["nodejs_compat"]` retained.
- `observability.enabled: true` retained.
- `.dev.vars.example` unchanged.

Deploy commands unchanged: `deploy:production`, `deploy:alt`, `deploy:fallback`, `deploy:all`, `dev`, `start`, `cf-typegen`, `type-check`, `lint`, `lint:fix`, `prepare`. Added: `test`, `test:watch`.

## 10. Docs

- `README.md` — unchanged content. Optional: add CI status badge.
- `DEPLOYMENT.md` — unchanged (instructions still match).
- `CONTRIBUTING.md` — update "Project structure" section to match new `src/oauth/`, `src/mcp/`, `src/mymlh/` layout; update "Adding a new tool" paths.
- `AGENTS.md` — same structure updates as CONTRIBUTING.
- `CODE_OF_CONDUCT.md`, `server.json` — unchanged.
- `.gitignore` — add `.worktrees/` and `coverage/`.

## 11. Cutover Plan

1. Create branch `rebuild/from-scratch` off `main`.
2. Clear `src/`; keep `wrangler.jsonc`, `biome.json`, `lefthook.yml`, `tsconfig.json`, `server.json`, `.dev.vars.example`, all root Markdown.
3. Bump `package.json` dependencies to the versions in §6; add `test` scripts.
4. Scaffold new `src/` tree per §3.
5. Implement modules in this order (each step ends with `npm run type-check` + `npm run lint` green):
   1. `src/types.ts`
   2. `src/mymlh/scopes.ts`
   3. `src/oauth/upstream.ts`
   4. `src/oauth/approval/{cookie,dialog,index}.ts`
   5. `src/oauth/handler.ts`
   6. `src/mymlh/api.ts`
   7. `src/mcp/tools/{user,tokens,index}.ts`
   8. `src/mcp/agent.ts`
   9. `src/index.ts`
6. Adapt to API drift: `agents@0.11`, `workers-oauth-provider@0.4`, TypeScript 6. Named plan step.
7. Write tests in parallel with modules; integration tests last.
8. Add `.github/workflows/ci.yml`; push branch; verify first CI run green.
9. Local verification: `.dev.vars` set; `npm run dev`; MCP Inspector against `http://localhost:8788/mcp`; walk full OAuth flow + each tool.
10. Staging verification: `npm run deploy:alt` from the branch; MCP Inspector against `https://mymlh-mcp-alt.git.ci/mcp`; walk full OAuth flow + each tool.
11. Docs pass: `CONTRIBUTING.md`, `AGENTS.md`, `.gitignore`, CI badge in `README.md`.
12. Open PR to `main` with summary + test plan; manual review.
13. After merge: `npm run deploy:production` and `npm run deploy:fallback` from `main`.
14. Rollback: `git revert` the merge + `wrangler deploy -e production`, or roll back via Cloudflare dashboard to previous deployment.

## 12. Risks

| Risk | Mitigation |
|---|---|
| `agents@0.11` API drift breaks `MyMCP` | Named adaptation step; staging deploy gates production |
| `workers-oauth-provider@0.4` API drift | Same: adapt, verify full OAuth flow in staging |
| TypeScript 6 errors in patterns we rely on | Trial compile early; pin `@types/node` to a compatible major if needed |
| DO state incompatibility if migrations change | Class name and migration tag preserved — no migration required |
| Cookie encryption key mismatch across deploys | No change; same `COOKIE_ENCRYPTION_KEY` secret per env |
| Tests flaky due to `fetchMock` lifecycle | Use miniflare's `fetchMock` `MockAgent` per test; reset between tests |

## 13. Success Criteria

- All three deploy targets (`production`, `alt`, `fallback`) build and deploy cleanly.
- MCP Inspector completes OAuth flow and calls all 3 tools against local, alt, and production.
- `npm run type-check`, `npm run lint`, `npm test` all green on the branch and on CI.
- Zero change to public endpoints, tool names, approval-dialog fields, cookie semantics, or DO class name.
- Post-merge deploy carries existing sessions through without user impact.
