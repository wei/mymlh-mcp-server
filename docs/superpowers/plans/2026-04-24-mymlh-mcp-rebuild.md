# MyMLH MCP Server Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `mymlh-mcp-server` from scratch on Cloudflare Workers, preserving every external behavior (OAuth flow, MCP tools, routes, KV, DO class name, deployment envs) while modernizing internals, upgrading every dependency to its current major, reorganizing code into `src/oauth/`, `src/mcp/`, `src/mymlh/`, and adding a `vitest` + `@cloudflare/vitest-pool-workers` test suite plus GitHub Actions CI.

**Architecture:** `@cloudflare/workers-oauth-provider` wraps the worker and handles `/register`, `/token`, and PKCE. A `hono` default handler serves `/authorize` + `/callback` + `/` (liveness). `McpAgent` from `agents/mcp` backs a `MyMCP` Durable Object (sqlite-class, name preserved for migration compat) and registers three MCP tools with Zod input schemas on an `@modelcontextprotocol/sdk` `McpServer`. The approval dialog module is split into pure `cookie.ts` + `dialog.ts` + `index.ts` files. Tests run in `workerd` via `@cloudflare/vitest-pool-workers` with `fetchMock` stubbing upstream MyMLH.

> **Implementation notes (post-merge):** This is a historical plan; final shipped code diverged in two minor ways: (1) outbound mocking uses `vi.stubGlobal("fetch", ...)` via the `test/helpers/stub-fetch.ts` helper rather than `fetchMock` from `cloudflare:test` (pool-workers 0.15 dropped that API); (2) the vitest config file is `vitest.config.mts`, not `vitest.config.ts`. The token tools (`mymlh_get_token`, `mymlh_refresh_token`) were also removed before v1.0 in favor of the single `mymlh_get_user` tool. See `AGENTS.md` and `CONTRIBUTING.md` for current state.

**Tech Stack:** TypeScript 6, Cloudflare Workers, Hono 4.12, `@modelcontextprotocol/sdk` 1.29, `@cloudflare/workers-oauth-provider` 0.4, `agents` 0.11 (`McpAgent`), Zod 4.3, Biome 2.4, Vitest 4 + `@cloudflare/vitest-pool-workers` 0.15, Lefthook 2.1, Wrangler 4.85.

**Branch:** all work on `rebuild/from-scratch`. Do NOT commit to `main`.

**Spec:** `docs/superpowers/specs/2026-04-24-mymlh-mcp-rebuild-design.md`.

**Important preservation rules (do not violate):**
- `wrangler.jsonc` env block names (`production`, `alt`, `fallback`, `local`), KV IDs, route patterns, DO migration tag (`v1`), DO class name (`MyMCP`) must remain identical.
- Public endpoint paths (`/mcp`, `/sse`, `/authorize`, `/callback`, `/token`, `/register`) unchanged.
- Tool names (`mymlh_get_user`, `mymlh_get_token`, `mymlh_refresh_token`), their input shapes (none), and their output JSON shapes unchanged.
- Approval-cookie name (`mcp-approved-clients`), signing algorithm (HMAC-SHA256 hex), and attributes (`HttpOnly; Secure; Path=/; SameSite=Lax`) unchanged.
- Default approval-cookie Max-Age = 1 year; POST `/authorize` must pass `cookieMaxAgeSeconds=5` to force re-prompt.
- Secret names (`MYMLH_CLIENT_ID`, `MYMLH_CLIENT_SECRET`, `COOKIE_ENCRYPTION_KEY`) unchanged.
- OAuth provider `refreshTokenTTL = 24 * 60 * 60`.
- Auto-refresh threshold = 60 seconds before expiry. Single 401 retry. Second 401 clears tokens.

**`.dev.vars` values** already exist at repo root with working MyMLH credentials. Don't overwrite them. If running tests that touch secrets, stub them in the test rather than relying on `.dev.vars`.

**Commit style:** Conventional Commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`, `refactor:`, `ci:`).

**Quality gates per task:** run `npm run type-check`, `npm run lint`, `npm test` (after Task 3) before committing. All must pass.

---

## Task 1: Bump dependencies, install, regenerate Worker types, clean `src/`

**Files:**
- Modify: `package.json`
- Delete: `package-lock.json` (to be regenerated)
- Delete: `src/constants.ts`, `src/index.ts`, `src/mymlh-api.ts`, `src/mymlh-handler.ts`, `src/types.ts`, `src/utils.ts`, `src/workers-oauth-utils.ts`, `src/tools/index.ts`, `src/tools/tokens.ts`, `src/tools/user.ts`, `src/tools/` directory
- Regenerate: `worker-configuration.d.ts` (via `npm run cf-typegen` at the end)

- [ ] **Step 1: Replace `package.json` contents**

```json
{
  "name": "mymlh-mcp-server",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "deploy:all": "npm run deploy:production && npm run deploy:alt && npm run deploy:fallback",
    "deploy:production": "wrangler deploy -e production",
    "deploy:alt": "wrangler deploy -e alt",
    "deploy:fallback": "wrangler deploy -e fallback",
    "dev": "wrangler dev -e local",
    "start": "wrangler dev -e local",
    "cf-typegen": "wrangler types",
    "type-check": "tsc --noEmit",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "test": "vitest run",
    "test:watch": "vitest",
    "prepare": "lefthook install"
  },
  "dependencies": {
    "@cloudflare/workers-oauth-provider": "^0.4.0",
    "@modelcontextprotocol/sdk": "^1.29.0",
    "agents": "^0.11.5",
    "hono": "^4.12.15",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.4.13",
    "@cloudflare/vitest-pool-workers": "^0.15.0",
    "@types/node": "^25.6.0",
    "lefthook": "^2.1.6",
    "typescript": "^6.0.3",
    "vitest": "^4.1.5",
    "wrangler": "^4.85.0"
  }
}
```

- [ ] **Step 2: Delete old `package-lock.json` and `node_modules`, install fresh**

```bash
rm -rf package-lock.json node_modules
npm install
```

Expected: install completes without ERR_INVALID_PEER_DEP. Warnings about optional peers for `agents` (react, ai-sdk, etc.) are expected and can be ignored.

- [ ] **Step 3: Delete legacy source files**

```bash
rm -rf src/
mkdir src
```

- [ ] **Step 4: Regenerate Worker binding types**

```bash
npm run cf-typegen
```

Expected: regenerates `worker-configuration.d.ts` with current wrangler. File will show `Env` interface with `OAUTH_KV`, `MCP_OBJECT`, `MYMLH_CLIENT_ID`, `MYMLH_CLIENT_SECRET`, `COOKIE_ENCRYPTION_KEY`, `ENV_NAME`.

- [ ] **Step 5: Verify no TypeScript errors in empty state**

The project has no `src/` files; TypeScript should still pass with no inputs. Run:

```bash
npm run type-check
```

Expected: exit 0 (no errors; no files to type-check).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json worker-configuration.d.ts src/
git commit -m "chore: bump deps to latest majors and reset src for rebuild"
```

---

## Task 2: Write `src/types.ts` (shared types)

**Files:**
- Create: `src/types.ts`

No dedicated test file (pure type declarations).

- [ ] **Step 1: Create `src/types.ts`**

```ts
export interface MyMLHUserProfile {
  country_of_residence?: string;
  race_or_ethnicity?: string;
  gender?: string;
  age?: number;
}

export interface MyMLHEducationEntry {
  id: string;
  current: boolean;
  school_name: string;
  school_type: string | null;
  start_date: number | null;
  end_date: number | null;
  major?: string | null;
}

export interface MyMLHEmploymentEntry {
  id: string;
  current: boolean;
  employer_name: string;
  company?: string;
  title?: string | null;
  type?: string | null;
  start_date: number | null;
  end_date: number | null;
}

export interface MyMLHAddress {
  id: string;
  line1: string;
  line2?: string | null;
  city: string;
  state?: string | null;
  postal_code?: string | null;
  country: string;
}

export interface MyMLHUser {
  id: string;
  created_at?: number;
  updated_at?: number;
  first_name: string;
  last_name: string;
  email: string;
  phone_number?: string;
  profile?: MyMLHUserProfile;
  address?: MyMLHAddress;
  professional_experience?: MyMLHEmploymentEntry[];
  education?: MyMLHEducationEntry[];
}

export interface MyMLHTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

export type Props = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  expiresIn?: number;
  // Unix time (seconds) when the current access token was issued
  accessTokenIssuedAt?: number;
};

export type ToolContext = {
  env: Env;
  getProps: () => Props;
  refreshUpstreamToken: () => Promise<MyMLHTokenResponse | null>;
  fetchMyMLHWithAutoRefresh: (url: string, init?: RequestInit) => Promise<Response>;
};
```

- [ ] **Step 2: Type-check**

```bash
npm run type-check
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add shared Props, MyMLH*, ToolContext types"
```

---

## Task 3: Write `src/mymlh/scopes.ts` (constants)

**Files:**
- Create: `src/mymlh/scopes.ts`

- [ ] **Step 1: Create `src/mymlh/scopes.ts`**

```ts
export const MYMLH_AUTH_URL = "https://my.mlh.io/oauth/authorize";
export const MYMLH_TOKEN_URL = "https://my.mlh.io/oauth/token";
export const MYMLH_API_BASE = "https://api.mlh.com/v4";

export const DEFAULT_MYMLH_SCOPES = [
  "public",
  "offline_access",
  "user:read:profile",
  // Adding more scopes as default until MLH OAuth supports re-prompt consent screen
  "user:read:education",
  "user:read:employment",
].join(" ");

export const ALL_MYMLH_SCOPES = [
  "public",
  "offline_access",
  "user:read:profile",
  // "user:read:address",  // Not yet ready on MyMLH as of 09/05/2025
  "user:read:birthday",
  "user:read:demographics",
  "user:read:education",
  "user:read:email",
  "user:read:employment",
  "user:read:event_preferences",
  "user:read:phone",
  "user:read:social_profiles",
].join(" ");
```

- [ ] **Step 2: Type-check and commit**

```bash
npm run type-check
git add src/mymlh/scopes.ts
git commit -m "feat(mymlh): add scopes and upstream URL constants"
```

---

## Task 4: `src/oauth/upstream.ts` + unit tests (TDD)

**Files:**
- Create: `src/oauth/upstream.ts`
- Create: `test/unit/upstream.test.ts`

Two helpers: `getUpstreamAuthorizeUrl` (builds the MyMLH authorize URL) and `requestUpstreamToken` (POSTs to MyMLH token endpoint for either `authorization_code` or `refresh_token`). Plus a thin convenience wrapper `fetchUpstreamAuthToken` that returns `[accessToken, null, tokenJson]` or `[null, Response]`.

- [ ] **Step 1: Create `vitest.config.ts`** (required before tests can run)

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

- [ ] **Step 2: Write failing test `test/unit/upstream.test.ts`**

```ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { fetchMock } from "cloudflare:test";
import { getUpstreamAuthorizeUrl, requestUpstreamToken } from "../../src/oauth/upstream";

describe("getUpstreamAuthorizeUrl", () => {
  it("builds an authorize URL with required params and prompt=consent", () => {
    const url = getUpstreamAuthorizeUrl({
      upstream_url: "https://example.test/authorize",
      client_id: "cid",
      scope: "public user:read:profile",
      redirect_uri: "https://my.example/callback",
      state: "abc",
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://example.test/authorize");
    expect(u.searchParams.get("client_id")).toBe("cid");
    expect(u.searchParams.get("redirect_uri")).toBe("https://my.example/callback");
    expect(u.searchParams.get("scope")).toBe("public user:read:profile");
    expect(u.searchParams.get("state")).toBe("abc");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("prompt")).toBe("consent");
  });

  it("omits state if not provided", () => {
    const url = getUpstreamAuthorizeUrl({
      upstream_url: "https://example.test/authorize",
      client_id: "cid",
      scope: "public",
      redirect_uri: "https://my.example/callback",
    });
    expect(new URL(url).searchParams.get("state")).toBeNull();
  });
});

describe("requestUpstreamToken", () => {
  beforeEach(() => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
  });
  afterEach(() => {
    fetchMock.assertNoPendingInterceptors();
  });

  it("POSTs x-www-form-urlencoded for authorization_code grant", async () => {
    fetchMock
      .get("https://example.test")
      .intercept({
        path: "/token",
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      })
      .reply(200, JSON.stringify({ access_token: "AT", token_type: "Bearer", expires_in: 3600 }), {
        headers: { "content-type": "application/json" },
      });

    const [json, err] = await requestUpstreamToken({
      upstream_url: "https://example.test/token",
      client_id: "cid",
      client_secret: "sec",
      grant_type: "authorization_code",
      code: "C",
      redirect_uri: "https://my.example/callback",
    });
    expect(err).toBeNull();
    expect(json?.access_token).toBe("AT");
  });

  it("POSTs refresh_token grant", async () => {
    fetchMock
      .get("https://example.test")
      .intercept({ path: "/token", method: "POST" })
      .reply(200, JSON.stringify({ access_token: "AT2" }), {
        headers: { "content-type": "application/json" },
      });

    const [json] = await requestUpstreamToken({
      upstream_url: "https://example.test/token",
      client_id: "cid",
      client_secret: "sec",
      grant_type: "refresh_token",
      refresh_token: "RT",
    });
    expect(json?.access_token).toBe("AT2");
  });

  it("returns 400 when authorization_code is missing code", async () => {
    const [json, err] = await requestUpstreamToken({
      upstream_url: "https://example.test/token",
      client_id: "cid",
      client_secret: "sec",
      grant_type: "authorization_code",
      redirect_uri: "https://my.example/callback",
    });
    expect(json).toBeNull();
    expect(err).toBeInstanceOf(Response);
    expect(err?.status).toBe(400);
  });

  it("returns 400 when refresh_token grant is missing refresh_token", async () => {
    const [, err] = await requestUpstreamToken({
      upstream_url: "https://example.test/token",
      client_id: "cid",
      client_secret: "sec",
      grant_type: "refresh_token",
    });
    expect(err?.status).toBe(400);
  });

  it("returns 500 Response when upstream returns non-2xx", async () => {
    fetchMock
      .get("https://example.test")
      .intercept({ path: "/token", method: "POST" })
      .reply(500, "oops");

    const [, err] = await requestUpstreamToken({
      upstream_url: "https://example.test/token",
      client_id: "cid",
      client_secret: "sec",
      grant_type: "refresh_token",
      refresh_token: "RT",
    });
    expect(err?.status).toBe(500);
  });
});
```

- [ ] **Step 3: Run test to verify it fails (no implementation yet)**

```bash
npm test -- test/unit/upstream.test.ts
```

Expected: FAIL — "Cannot find module '../../src/oauth/upstream'".

- [ ] **Step 4: Create `src/oauth/upstream.ts`**

```ts
import type { MyMLHTokenResponse } from "../types";

export function getUpstreamAuthorizeUrl({
  upstream_url,
  client_id,
  scope,
  redirect_uri,
  state,
}: {
  upstream_url: string;
  client_id: string;
  scope: string;
  redirect_uri: string;
  state?: string;
}): string {
  const upstream = new URL(upstream_url);
  upstream.searchParams.set("client_id", client_id);
  upstream.searchParams.set("redirect_uri", redirect_uri);
  upstream.searchParams.set("scope", scope);
  if (state) upstream.searchParams.set("state", state);
  upstream.searchParams.set("response_type", "code");
  upstream.searchParams.set("prompt", "consent");
  return upstream.href;
}

export async function requestUpstreamToken({
  upstream_url,
  client_id,
  client_secret,
  grant_type,
  code,
  redirect_uri,
  refresh_token,
}: {
  upstream_url: string;
  client_id: string;
  client_secret: string;
  grant_type: "authorization_code" | "refresh_token";
  code?: string;
  redirect_uri?: string;
  refresh_token?: string;
}): Promise<[MyMLHTokenResponse, null] | [null, Response]> {
  const params = new URLSearchParams({ grant_type, client_id, client_secret });
  if (grant_type === "authorization_code") {
    if (!code || !redirect_uri) {
      return [null, new Response("Missing code or redirect_uri", { status: 400 })];
    }
    params.set("code", code);
    params.set("redirect_uri", redirect_uri);
  } else {
    if (!refresh_token) {
      return [null, new Response("Missing refresh_token", { status: 400 })];
    }
    params.set("refresh_token", refresh_token);
  }

  try {
    const resp = await fetch(upstream_url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    if (!resp.ok) {
      console.error("Token endpoint error", { url: upstream_url, status: resp.status });
      return [null, new Response("Failed to fetch access token", { status: 500 })];
    }
    const json = (await resp.json()) as MyMLHTokenResponse;
    return [json, null];
  } catch (e) {
    console.error("Token endpoint network error", { url: upstream_url, error: String(e) });
    return [null, new Response("Upstream token request failed", { status: 502 })];
  }
}

export async function fetchUpstreamAuthToken({
  client_id,
  client_secret,
  code,
  redirect_uri,
  upstream_url,
}: {
  code: string | undefined;
  upstream_url: string;
  client_secret: string;
  redirect_uri: string;
  client_id: string;
}): Promise<[string, null, MyMLHTokenResponse?] | [null, Response]> {
  if (!code) return [null, new Response("Missing code", { status: 400 })];
  const [json, err] = await requestUpstreamToken({
    upstream_url,
    client_id,
    client_secret,
    grant_type: "authorization_code",
    code,
    redirect_uri,
  });
  if (err) return [null, err];
  const accessToken = json?.access_token ?? null;
  if (!accessToken) return [null, new Response("Missing access token", { status: 400 })];
  return [accessToken, null, json];
}
```

- [ ] **Step 5: Re-run test — expected PASS**

```bash
npm test -- test/unit/upstream.test.ts
```

Expected: all tests in the file pass.

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts src/oauth/upstream.ts test/unit/upstream.test.ts
git commit -m "feat(oauth): add upstream URL builder and token request helpers"
```

---

## Task 5: `src/oauth/approval/cookie.ts` + unit tests (TDD)

**Files:**
- Create: `src/oauth/approval/cookie.ts`
- Create: `test/unit/cookie.test.ts`

Pure HMAC-SHA256 sign/verify + approved-clients cookie parsing/building.

- [ ] **Step 1: Write failing test `test/unit/cookie.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  buildSetCookie,
  COOKIE_NAME,
  readApprovedClients,
} from "../../src/oauth/approval/cookie";

const SECRET = "test-secret-key-do-not-use-in-prod";

describe("readApprovedClients / buildSetCookie round-trip", () => {
  it("round-trips a client list", async () => {
    const setCookie = await buildSetCookie(["client-a", "client-b"], SECRET, 3600);
    const value = setCookie.split(";")[0];
    const clients = await readApprovedClients(value, SECRET);
    expect(clients).toEqual(["client-a", "client-b"]);
  });

  it("detects tampering (bad signature)", async () => {
    const setCookie = await buildSetCookie(["client-a"], SECRET, 3600);
    const value = setCookie.split(";")[0];
    // Corrupt the signature half
    const [name, rest] = value.split("=");
    const [sig, payload] = rest.split(".");
    const tampered = `${name}=${sig.slice(0, -2)}00.${payload}`;
    const clients = await readApprovedClients(tampered, SECRET);
    expect(clients).toBeNull();
  });

  it("returns null for malformed cookie", async () => {
    expect(await readApprovedClients(null, SECRET)).toBeNull();
    expect(await readApprovedClients("", SECRET)).toBeNull();
    expect(await readApprovedClients("other=1", SECRET)).toBeNull();
    expect(await readApprovedClients(`${COOKIE_NAME}=malformed`, SECRET)).toBeNull();
  });

  it("dedupes client ids in buildSetCookie via caller; we just serialize what we get", async () => {
    const set = await buildSetCookie(["a", "a", "b"], SECRET, 60);
    const clients = await readApprovedClients(set.split(";")[0], SECRET);
    expect(clients).toEqual(["a", "a", "b"]);
  });

  it("sets expected cookie attributes", async () => {
    const set = await buildSetCookie(["a"], SECRET, 42);
    expect(set).toContain("HttpOnly");
    expect(set).toContain("Secure");
    expect(set).toContain("Path=/");
    expect(set).toContain("SameSite=Lax");
    expect(set).toContain("Max-Age=42");
    expect(set).toContain(`${COOKIE_NAME}=`);
  });

  it("rejects empty secret", async () => {
    await expect(buildSetCookie(["a"], "", 60)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
npm test -- test/unit/cookie.test.ts
```

Expected: module-not-found failure.

- [ ] **Step 3: Create `src/oauth/approval/cookie.ts`**

```ts
export const COOKIE_NAME = "mcp-approved-clients";
const ONE_YEAR_IN_SECONDS = 31536000;

async function importKey(secret: string): Promise<CryptoKey> {
  if (!secret) {
    throw new Error("COOKIE_ENCRYPTION_KEY is not defined. A secret key is required for signing cookies.");
  }
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign", "verify"],
  );
}

async function signPayload(key: CryptoKey, data: string): Promise<string> {
  const enc = new TextEncoder();
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function verifySignature(key: CryptoKey, signatureHex: string, data: string): Promise<boolean> {
  const enc = new TextEncoder();
  try {
    const pairs = signatureHex.match(/.{1,2}/g);
    if (!pairs) return false;
    const bytes = new Uint8Array(pairs.map((byte) => Number.parseInt(byte, 16)));
    return await crypto.subtle.verify("HMAC", key, bytes.buffer, enc.encode(data));
  } catch (e) {
    console.error("Error verifying signature:", e);
    return false;
  }
}

export async function readApprovedClients(
  cookieHeader: string | null,
  secret: string,
): Promise<string[] | null> {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(";").map((c) => c.trim());
  const target = cookies.find((c) => c.startsWith(`${COOKIE_NAME}=`));
  if (!target) return null;

  const value = target.substring(COOKIE_NAME.length + 1);
  const parts = value.split(".");
  if (parts.length !== 2) return null;

  const [signatureHex, base64Payload] = parts;
  let payload: string;
  try {
    payload = atob(base64Payload);
  } catch {
    return null;
  }

  const key = await importKey(secret);
  const ok = await verifySignature(key, signatureHex, payload);
  if (!ok) return null;

  try {
    const parsed = JSON.parse(payload);
    if (!Array.isArray(parsed)) return null;
    if (!parsed.every((item) => typeof item === "string")) return null;
    return parsed as string[];
  } catch {
    return null;
  }
}

export async function buildSetCookie(
  clientIds: string[],
  secret: string,
  maxAgeSeconds: number = ONE_YEAR_IN_SECONDS,
): Promise<string> {
  const payload = JSON.stringify(clientIds);
  const key = await importKey(secret);
  const signature = await signPayload(key, payload);
  const value = `${signature}.${btoa(payload)}`;
  return `${COOKIE_NAME}=${value}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}
```

- [ ] **Step 4: Re-run tests — expect PASS**

```bash
npm test -- test/unit/cookie.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/oauth/approval/cookie.ts test/unit/cookie.test.ts
git commit -m "feat(oauth/approval): add signed approved-clients cookie helpers"
```

---

## Task 6: `src/oauth/approval/dialog.ts` + unit tests (TDD)

**Files:**
- Create: `src/oauth/approval/dialog.ts`
- Create: `test/unit/dialog.test.ts`

- [ ] **Step 1: Write failing test `test/unit/dialog.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { renderApprovalDialog } from "../../src/oauth/approval/dialog";

const stubClient = {
  clientId: "c-1",
  clientName: "Example Client",
  clientUri: "https://example.com",
  policyUri: "https://example.com/privacy",
  tosUri: "https://example.com/tos",
  redirectUris: ["https://example.com/cb"],
  contacts: ["dev@example.com"],
};

function makeRequest() {
  return new Request("https://server.test/authorize?foo=1", { method: "GET" });
}

describe("renderApprovalDialog", () => {
  it("returns text/html; charset=utf-8", async () => {
    const resp = renderApprovalDialog(makeRequest(), {
      client: stubClient,
      server: { name: "MyMLH MCP Server" },
      state: { oauthReqInfo: { clientId: "c-1" } },
    });
    expect(resp.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const text = await resp.text();
    expect(text).toContain("MyMLH MCP Server");
    expect(text).toContain("Example Client");
  });

  it("escapes untrusted HTML in clientName and server description", async () => {
    const resp = renderApprovalDialog(makeRequest(), {
      client: { ...stubClient, clientName: "<script>alert(1)</script>" },
      server: { name: "<img onerror=1>", description: "<b>desc</b>" },
      state: { oauthReqInfo: { clientId: "c-1" } },
    });
    const text = await resp.text();
    expect(text).not.toContain("<script>alert(1)</script>");
    expect(text).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(text).not.toContain("<img onerror=1>");
    expect(text).toContain("&lt;img onerror=1&gt;");
    expect(text).not.toMatch(/<b>desc<\/b>/);
    expect(text).toContain("&lt;b&gt;desc&lt;/b&gt;");
  });

  it("omits optional fields when absent", async () => {
    const resp = renderApprovalDialog(makeRequest(), {
      client: { clientId: "c-2", clientName: "Minimal" },
      server: { name: "S" },
      state: { oauthReqInfo: { clientId: "c-2" } },
    });
    const text = await resp.text();
    expect(text).not.toContain("Privacy Policy:");
    expect(text).not.toContain("Terms of Service:");
    expect(text).not.toContain("Contact:");
  });

  it("form action is the request pathname", async () => {
    const resp = renderApprovalDialog(makeRequest(), {
      client: stubClient,
      server: { name: "S" },
      state: { oauthReqInfo: { clientId: "c-1" } },
    });
    const text = await resp.text();
    expect(text).toContain(`action="/authorize"`);
  });

  it("encodes state as base64 JSON in hidden input", async () => {
    const state = { oauthReqInfo: { clientId: "c-1", extra: "abc" } };
    const resp = renderApprovalDialog(makeRequest(), {
      client: stubClient,
      server: { name: "S" },
      state,
    });
    const text = await resp.text();
    const match = text.match(/name="state" value="([^"]+)"/);
    expect(match).not.toBeNull();
    const decoded = JSON.parse(atob(match?.[1] ?? ""));
    expect(decoded).toEqual(state);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL (module missing)**

```bash
npm test -- test/unit/dialog.test.ts
```

- [ ] **Step 3: Create `src/oauth/approval/dialog.ts`**

```ts
import type { ClientInfo } from "@cloudflare/workers-oauth-provider";

export interface ApprovalDialogOptions {
  client: ClientInfo | null;
  server: {
    name: string;
    logo?: string;
    description?: string;
  };
  state: Record<string, unknown>;
}

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

type Renderable = string | number | boolean | null | undefined;

function html(strings: TemplateStringsArray, ...values: Renderable[]): string {
  let out = "";
  strings.forEach((chunk, i) => {
    out += chunk;
    if (i < values.length) {
      const v = values[i];
      if (v === null || v === undefined || v === false) return;
      out += escapeHtml(String(v));
    }
  });
  return out;
}

// `raw` bypasses escaping and should only be used for already-escaped HTML fragments.
function raw(s: string): { __raw: true; value: string } {
  return { __raw: true, value: s };
}

function renderRaw(strings: TemplateStringsArray, ...values: (Renderable | { __raw: true; value: string })[]): string {
  let out = "";
  strings.forEach((chunk, i) => {
    out += chunk;
    if (i < values.length) {
      const v = values[i];
      if (v === null || v === undefined || v === false) return;
      if (typeof v === "object" && "__raw" in v && v.__raw) {
        out += v.value;
      } else {
        out += escapeHtml(String(v));
      }
    }
  });
  return out;
}

export function renderApprovalDialog(request: Request, options: ApprovalDialogOptions): Response {
  const { client, server, state } = options;
  const encodedState = btoa(JSON.stringify(state));
  const serverName = server.name;
  const clientName = client?.clientName ?? "Unknown MCP Client";
  const serverDescription = server.description ?? "";
  const logoUrl = server.logo ?? "";
  const clientUri = client?.clientUri ?? "";
  const policyUri = client?.policyUri ?? "";
  const tosUri = client?.tosUri ?? "";
  const contacts = client?.contacts && client.contacts.length > 0 ? client.contacts.join(", ") : "";
  const redirectUris = client?.redirectUris && client.redirectUris.length > 0 ? client.redirectUris : [];
  const pathname = new URL(request.url).pathname;

  const logoBlock = logoUrl ? html`<img src="${logoUrl}" alt="${serverName} Logo" class="logo">` : "";
  const descriptionBlock = serverDescription ? html`<p class="description">${serverDescription}</p>` : "";
  const clientUriBlock = clientUri
    ? html`
      <div class="client-detail">
        <div class="detail-label">Website:</div>
        <div class="detail-value small">
          <a href="${clientUri}" target="_blank" rel="noopener noreferrer">${clientUri}</a>
        </div>
      </div>`
    : "";
  const policyBlock = policyUri
    ? html`
      <div class="client-detail">
        <div class="detail-label">Privacy Policy:</div>
        <div class="detail-value">
          <a href="${policyUri}" target="_blank" rel="noopener noreferrer">${policyUri}</a>
        </div>
      </div>`
    : "";
  const tosBlock = tosUri
    ? html`
      <div class="client-detail">
        <div class="detail-label">Terms of Service:</div>
        <div class="detail-value">
          <a href="${tosUri}" target="_blank" rel="noopener noreferrer">${tosUri}</a>
        </div>
      </div>`
    : "";
  const redirectBlock = redirectUris.length > 0
    ? renderRaw`
      <div class="client-detail">
        <div class="detail-label">Redirect URIs:</div>
        <div class="detail-value small">
          ${raw(redirectUris.map((uri) => html`<div>${uri}</div>`).join(""))}
        </div>
      </div>`
    : "";
  const contactsBlock = contacts
    ? html`
      <div class="client-detail">
        <div class="detail-label">Contact:</div>
        <div class="detail-value">${contacts}</div>
      </div>`
    : "";

  const htmlContent = renderRaw`
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${clientName} | Authorization Request</title>
    <style>
      :root {
        --primary-color: #0070f3;
        --error-color: #f44336;
        --border-color: #e5e7eb;
        --text-color: #333;
        --background-color: #fff;
        --card-shadow: 0 8px 36px 8px rgba(0, 0, 0, 0.1);
      }
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"; line-height: 1.6; color: var(--text-color); background-color: #f9fafb; margin: 0; padding: 0; }
      .container { max-width: 600px; margin: 2rem auto; padding: 1rem; }
      .precard { padding: 2rem; text-align: center; }
      .card { background-color: var(--background-color); border-radius: 8px; box-shadow: var(--card-shadow); padding: 2rem; }
      .header { display: flex; align-items: center; justify-content: center; margin-bottom: 1.5rem; }
      .logo { width: 48px; height: 48px; margin-right: 1rem; border-radius: 8px; object-fit: contain; }
      .title { margin: 0; font-size: 1.3rem; font-weight: 400; }
      .alert { margin: 0; font-size: 1.5rem; font-weight: 400; margin: 1rem 0; text-align: center; }
      .description { color: #555; }
      .client-info { border: 1px solid var(--border-color); border-radius: 6px; padding: 1rem 1rem 0.5rem; margin-bottom: 1.5rem; }
      .client-name { font-weight: 600; font-size: 1.2rem; margin: 0 0 0.5rem 0; }
      .client-detail { display: flex; margin-bottom: 0.5rem; align-items: baseline; }
      .detail-label { font-weight: 500; min-width: 120px; }
      .detail-value { font-family: SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; word-break: break-all; }
      .detail-value a { color: inherit; text-decoration: underline; }
      .detail-value.small { font-size: 0.8em; }
      .actions { display: flex; justify-content: flex-end; gap: 1rem; margin-top: 2rem; }
      .button { padding: 0.75rem 1.5rem; border-radius: 6px; font-weight: 500; cursor: pointer; border: none; font-size: 1rem; }
      .button:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
      .button-primary { background-color: var(--primary-color); color: white; }
      .button-secondary { background-color: transparent; border: 1px solid var(--border-color); color: var(--text-color); }
      @media (max-width: 640px) {
        .container { margin: 1rem auto; padding: 0.5rem; }
        .card { padding: 1.5rem; }
        .client-detail { flex-direction: column; }
        .detail-label { min-width: unset; margin-bottom: 0.25rem; }
        .actions { flex-direction: column; }
        .button { width: 100%; }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="precard">
        <div class="header">
          ${raw(logoBlock)}
          <h1 class="title"><strong>${serverName}</strong></h1>
        </div>
        ${raw(descriptionBlock)}
      </div>
      <div class="card">
        <h2 class="alert"><strong>${clientName}</strong> is requesting access</h2>
        <div class="client-info">
          <div class="client-detail">
            <div class="detail-label">Name:</div>
            <div class="detail-value">${clientName}</div>
          </div>
          ${raw(clientUriBlock)}
          ${raw(policyBlock)}
          ${raw(tosBlock)}
          ${raw(redirectBlock)}
          ${raw(contactsBlock)}
        </div>
        <p>This MCP Client is requesting to be authorized on ${serverName}. If you approve, you will be redirected to complete authentication.</p>
        <form method="post" action="${pathname}">
          <input type="hidden" name="state" value="${encodedState}">
          <div class="actions">
            <button type="button" class="button button-secondary" onclick="window.history.back()">Cancel</button>
            <button type="submit" class="button button-primary">Approve</button>
          </div>
        </form>
      </div>
    </div>
  </body>
</html>`;

  return new Response(htmlContent, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
```

- [ ] **Step 4: Re-run tests — expect PASS**

```bash
npm test -- test/unit/dialog.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/oauth/approval/dialog.ts test/unit/dialog.test.ts
git commit -m "feat(oauth/approval): add auto-escaping approval dialog renderer"
```

---

## Task 7: `src/oauth/approval/index.ts` (public API) + unit tests

**Files:**
- Create: `src/oauth/approval/index.ts`
- Create: `test/unit/approval.test.ts`

- [ ] **Step 1: Write failing test `test/unit/approval.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  clientIdAlreadyApproved,
  parseRedirectApproval,
} from "../../src/oauth/approval";
import { buildSetCookie } from "../../src/oauth/approval/cookie";

const SECRET = "test-secret-key";

function makeGet(url: string, headers: Record<string, string> = {}) {
  return new Request(url, { method: "GET", headers });
}

async function makePost(url: string, body: FormData, headers: Record<string, string> = {}) {
  return new Request(url, { method: "POST", body, headers });
}

describe("clientIdAlreadyApproved", () => {
  it("returns false when no cookie", async () => {
    const req = makeGet("https://s.test/authorize");
    expect(await clientIdAlreadyApproved(req, "c-1", SECRET)).toBe(false);
  });

  it("returns true when cookie contains clientId", async () => {
    const set = await buildSetCookie(["c-1"], SECRET, 60);
    const req = makeGet("https://s.test/authorize", { Cookie: set.split(";")[0] });
    expect(await clientIdAlreadyApproved(req, "c-1", SECRET)).toBe(true);
  });

  it("returns false for missing clientId arg", async () => {
    const set = await buildSetCookie(["c-1"], SECRET, 60);
    const req = makeGet("https://s.test/authorize", { Cookie: set.split(";")[0] });
    expect(await clientIdAlreadyApproved(req, "", SECRET)).toBe(false);
  });
});

describe("parseRedirectApproval", () => {
  it("throws on non-POST", async () => {
    const req = makeGet("https://s.test/authorize");
    await expect(parseRedirectApproval(req, SECRET)).rejects.toThrow();
  });

  it("throws when state missing", async () => {
    const fd = new FormData();
    const req = await makePost("https://s.test/authorize", fd);
    await expect(parseRedirectApproval(req, SECRET)).rejects.toThrow();
  });

  it("extracts state and issues Set-Cookie with clientId appended", async () => {
    const state = { oauthReqInfo: { clientId: "c-42" } };
    const fd = new FormData();
    fd.set("state", btoa(JSON.stringify(state)));
    const req = await makePost("https://s.test/authorize", fd);
    const { state: parsed, headers } = await parseRedirectApproval(req, SECRET, 5);
    expect(parsed).toEqual(state);
    expect(headers["Set-Cookie"]).toContain("mcp-approved-clients=");
    expect(headers["Set-Cookie"]).toContain("Max-Age=5");
  });

  it("merges with existing approved-clients cookie", async () => {
    const existingSet = await buildSetCookie(["old"], SECRET, 60);
    const state = { oauthReqInfo: { clientId: "new" } };
    const fd = new FormData();
    fd.set("state", btoa(JSON.stringify(state)));
    const req = await makePost("https://s.test/authorize", fd, {
      Cookie: existingSet.split(";")[0],
    });
    const { headers } = await parseRedirectApproval(req, SECRET, 60);
    // Re-parse: cookie should contain both old and new
    const newCookieHeader = headers["Set-Cookie"].split(";")[0];
    const { readApprovedClients } = await import("../../src/oauth/approval/cookie");
    const approved = await readApprovedClients(newCookieHeader, SECRET);
    expect(approved).toEqual(["old", "new"]);
  });
});
```

- [ ] **Step 2: Run test — expect module-missing failure**

```bash
npm test -- test/unit/approval.test.ts
```

- [ ] **Step 3: Create `src/oauth/approval/index.ts`**

```ts
import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import { buildSetCookie, readApprovedClients } from "./cookie";

export { renderApprovalDialog } from "./dialog";
export type { ApprovalDialogOptions } from "./dialog";

export async function clientIdAlreadyApproved(
  request: Request,
  clientId: string,
  cookieSecret: string,
): Promise<boolean> {
  if (!clientId) return false;
  const cookieHeader = request.headers.get("Cookie");
  const approved = await readApprovedClients(cookieHeader, cookieSecret);
  return approved?.includes(clientId) ?? false;
}

export interface ParsedApprovalResult {
  state: { oauthReqInfo?: AuthRequest } & Record<string, unknown>;
  headers: Record<string, string>;
}

export async function parseRedirectApproval(
  request: Request,
  cookieSecret: string,
  cookieMaxAgeSeconds?: number,
): Promise<ParsedApprovalResult> {
  if (request.method !== "POST") {
    throw new Error("Invalid request method. Expected POST.");
  }

  const formData = await request.formData();
  const encoded = formData.get("state");
  if (typeof encoded !== "string" || !encoded) {
    throw new Error("Missing or invalid 'state' in form data.");
  }

  let state: ParsedApprovalResult["state"];
  try {
    state = JSON.parse(atob(encoded));
  } catch (e) {
    throw new Error(`Failed to decode state: ${e instanceof Error ? e.message : String(e)}`);
  }

  const clientId = state?.oauthReqInfo?.clientId;
  if (!clientId) {
    throw new Error("Could not extract clientId from state object.");
  }

  const existing = (await readApprovedClients(request.headers.get("Cookie"), cookieSecret)) ?? [];
  const updated = Array.from(new Set([...existing, clientId]));
  const setCookie = await buildSetCookie(updated, cookieSecret, cookieMaxAgeSeconds);

  return { state, headers: { "Set-Cookie": setCookie } };
}
```

- [ ] **Step 4: Re-run tests — expect PASS**

```bash
npm test -- test/unit/approval.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/oauth/approval/index.ts test/unit/approval.test.ts
git commit -m "feat(oauth/approval): add clientIdAlreadyApproved + parseRedirectApproval"
```

---

## Task 8: `src/oauth/handler.ts` (Hono routes)

**Files:**
- Create: `src/oauth/handler.ts`

No dedicated unit test at this layer — integration tests in Task 16/17 cover it.

- [ ] **Step 1: Create `src/oauth/handler.ts`**

```ts
import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import { DEFAULT_MYMLH_SCOPES, MYMLH_API_BASE, MYMLH_AUTH_URL, MYMLH_TOKEN_URL } from "../mymlh/scopes";
import type { MyMLHUser, Props } from "../types";
import { clientIdAlreadyApproved, parseRedirectApproval, renderApprovalDialog } from "./approval";
import { fetchUpstreamAuthToken, getUpstreamAuthorizeUrl } from "./upstream";

type Bindings = Env & { OAUTH_PROVIDER: OAuthHelpers };

const app = new Hono<{ Bindings: Bindings }>();

app.get("/", (c) =>
  c.json({
    name: "mymlh-mcp-server",
    env: c.env.ENV_NAME ?? "unknown",
    endpoints: ["/mcp", "/sse", "/authorize", "/callback", "/token", "/register"],
  }),
);

app.get("/authorize", async (c) => {
  let oauthReqInfo: AuthRequest;
  try {
    oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid authorization request";
    return c.text(`Invalid authorization request: ${msg}`, 400);
  }

  const { clientId } = oauthReqInfo;
  if (!clientId) return c.text("Invalid request", 400);

  if (await clientIdAlreadyApproved(c.req.raw, clientId, c.env.COOKIE_ENCRYPTION_KEY)) {
    return redirectToMyMLH(c.req.raw, oauthReqInfo, c.env.MYMLH_CLIENT_ID);
  }

  return renderApprovalDialog(c.req.raw, {
    client: await c.env.OAUTH_PROVIDER.lookupClient(clientId),
    server: {
      description: "MCP Remote Server using MyMLH (v4) for authentication.",
      logo: "https://static.mlh.io/brand-assets/logo/official/mlh-logo-color.svg",
      name: "MyMLH MCP Server",
    },
    state: { oauthReqInfo },
  });
});

app.post("/authorize", async (c) => {
  try {
    // 5-second cookie forces re-prompt on re-login
    const { state, headers } = await parseRedirectApproval(c.req.raw, c.env.COOKIE_ENCRYPTION_KEY, 5);
    if (!state.oauthReqInfo) return c.text("Invalid request", 400);
    return redirectToMyMLH(c.req.raw, state.oauthReqInfo, c.env.MYMLH_CLIENT_ID, headers);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to process approval";
    return c.text(`Invalid approval submission: ${msg}`, 400);
  }
});

function redirectToMyMLH(
  request: Request,
  oauthReqInfo: AuthRequest,
  client_id: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(null, {
    headers: {
      ...headers,
      location: getUpstreamAuthorizeUrl({
        client_id,
        redirect_uri: new URL("/callback", request.url).href,
        scope: DEFAULT_MYMLH_SCOPES,
        state: btoa(JSON.stringify(oauthReqInfo)),
        upstream_url: MYMLH_AUTH_URL,
      }),
    },
    status: 302,
  });
}

app.get("/callback", async (c) => {
  const stateParam = c.req.query("state");
  if (!stateParam) return c.text("Invalid state", 400);
  let oauthReqInfo: AuthRequest;
  try {
    oauthReqInfo = JSON.parse(atob(stateParam)) as AuthRequest;
  } catch {
    return c.text("Invalid state", 400);
  }
  if (!oauthReqInfo.clientId) return c.text("Invalid state", 400);

  const [accessToken, errResponse, tokenResponse] = await fetchUpstreamAuthToken({
    client_id: c.env.MYMLH_CLIENT_ID,
    client_secret: c.env.MYMLH_CLIENT_SECRET,
    code: c.req.query("code"),
    redirect_uri: new URL("/callback", c.req.url).href,
    upstream_url: MYMLH_TOKEN_URL,
  });
  if (errResponse) return errResponse;

  const meResp = await fetch(`${MYMLH_API_BASE}/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!meResp.ok) return c.text("Failed to fetch MyMLH user info", 502);
  const me = (await meResp.json()) as MyMLHUser;
  const { id, first_name, last_name, email } = me;

  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    metadata: { label: `${first_name} ${last_name}`.trim() },
    props: {
      accessToken,
      email,
      first_name,
      last_name,
      id,
      refreshToken: tokenResponse?.refresh_token,
      tokenType: tokenResponse?.token_type,
      expiresIn: tokenResponse?.expires_in,
      accessTokenIssuedAt: Math.floor(Date.now() / 1000),
      scope: tokenResponse?.scope,
    } satisfies Props,
    request: oauthReqInfo,
    scope: oauthReqInfo.scope,
    userId: id,
  });

  return Response.redirect(redirectTo);
});

export { app as MyMLHHandler };
```

- [ ] **Step 2: Type-check, lint**

```bash
npm run type-check
npm run lint
```

Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add src/oauth/handler.ts
git commit -m "feat(oauth): add Hono handler for /authorize, /callback, / liveness"
```

---

## Task 9: `src/mymlh/api.ts` + unit tests (TDD)

**Files:**
- Create: `src/mymlh/api.ts`
- Create: `test/unit/api.test.ts`

`makeMyMLHApi(env, getProps, updateProps)` returns `{ refreshUpstreamToken, fetchMyMLHWithAutoRefresh }`.

- [ ] **Step 1: Write failing test `test/unit/api.test.ts`**

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fetchMock } from "cloudflare:test";
import { makeMyMLHApi } from "../../src/mymlh/api";
import type { Props } from "../../src/types";

const env = {
  MYMLH_CLIENT_ID: "cid",
  MYMLH_CLIENT_SECRET: "sec",
} as unknown as Env;

function harness(initial: Props) {
  let state = { ...initial };
  const getProps = () => state;
  const updateProps = vi.fn(async (next: Props) => {
    state = { ...next };
  });
  const api = makeMyMLHApi(env, getProps, updateProps);
  return { api, getProps, updateProps };
}

const now = () => Math.floor(Date.now() / 1000);

beforeEach(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => {
  fetchMock.assertNoPendingInterceptors();
});

describe("fetchMyMLHWithAutoRefresh", () => {
  it("does not refresh when token is fresh", async () => {
    const { api, updateProps } = harness({
      id: "u",
      first_name: "F",
      last_name: "L",
      email: "e",
      accessToken: "AT",
      refreshToken: "RT",
      expiresIn: 3600,
      accessTokenIssuedAt: now(),
    });
    fetchMock
      .get("https://api.mlh.com")
      .intercept({ path: "/v4/users/me", method: "GET", headers: { authorization: "Bearer AT" } })
      .reply(200, JSON.stringify({ id: "u" }), { headers: { "content-type": "application/json" } });

    const resp = await api.fetchMyMLHWithAutoRefresh("https://api.mlh.com/v4/users/me");
    expect(resp.status).toBe(200);
    expect(updateProps).not.toHaveBeenCalled();
  });

  it("proactively refreshes when within 60s of expiry", async () => {
    const { api, updateProps } = harness({
      id: "u",
      first_name: "F",
      last_name: "L",
      email: "e",
      accessToken: "AT_old",
      refreshToken: "RT",
      expiresIn: 3600,
      accessTokenIssuedAt: now() - 3600, // already expired
    });

    fetchMock
      .get("https://my.mlh.io")
      .intercept({ path: "/oauth/token", method: "POST" })
      .reply(200, JSON.stringify({ access_token: "AT_new", expires_in: 3600 }), {
        headers: { "content-type": "application/json" },
      });
    fetchMock
      .get("https://api.mlh.com")
      .intercept({ path: "/v4/users/me", method: "GET", headers: { authorization: "Bearer AT_new" } })
      .reply(200, JSON.stringify({ id: "u" }), { headers: { "content-type": "application/json" } });

    const resp = await api.fetchMyMLHWithAutoRefresh("https://api.mlh.com/v4/users/me");
    expect(resp.status).toBe(200);
    expect(updateProps).toHaveBeenCalledTimes(1);
  });

  it("retries once on 401 with refreshed token", async () => {
    const { api, updateProps } = harness({
      id: "u",
      first_name: "F",
      last_name: "L",
      email: "e",
      accessToken: "AT_old",
      refreshToken: "RT",
      expiresIn: 3600,
      accessTokenIssuedAt: now(),
    });

    fetchMock
      .get("https://api.mlh.com")
      .intercept({ path: "/v4/users/me", method: "GET", headers: { authorization: "Bearer AT_old" } })
      .reply(401, "unauth");
    fetchMock
      .get("https://my.mlh.io")
      .intercept({ path: "/oauth/token", method: "POST" })
      .reply(200, JSON.stringify({ access_token: "AT_new", expires_in: 3600 }), {
        headers: { "content-type": "application/json" },
      });
    fetchMock
      .get("https://api.mlh.com")
      .intercept({ path: "/v4/users/me", method: "GET", headers: { authorization: "Bearer AT_new" } })
      .reply(200, JSON.stringify({ id: "u" }), { headers: { "content-type": "application/json" } });

    const resp = await api.fetchMyMLHWithAutoRefresh("https://api.mlh.com/v4/users/me");
    expect(resp.status).toBe(200);
    expect(updateProps).toHaveBeenCalled();
  });

  it("clears tokens on double 401", async () => {
    const { api, getProps, updateProps } = harness({
      id: "u",
      first_name: "F",
      last_name: "L",
      email: "e",
      accessToken: "AT_old",
      refreshToken: "RT",
      expiresIn: 3600,
      accessTokenIssuedAt: now(),
    });

    fetchMock
      .get("https://api.mlh.com")
      .intercept({ path: "/v4/users/me", method: "GET" })
      .reply(401, "unauth")
      .times(2);
    fetchMock
      .get("https://my.mlh.io")
      .intercept({ path: "/oauth/token", method: "POST" })
      .reply(200, JSON.stringify({ access_token: "AT_new", expires_in: 3600 }), {
        headers: { "content-type": "application/json" },
      });

    const resp = await api.fetchMyMLHWithAutoRefresh("https://api.mlh.com/v4/users/me");
    expect(resp.status).toBe(401);
    expect(updateProps).toHaveBeenCalled();
    expect(getProps().accessToken).toBe("");
  });
});
```

- [ ] **Step 2: Run test — expect module-missing failure**

```bash
npm test -- test/unit/api.test.ts
```

- [ ] **Step 3: Create `src/mymlh/api.ts`**

```ts
import type { MyMLHTokenResponse, Props } from "../types";
import { requestUpstreamToken } from "../oauth/upstream";
import { MYMLH_TOKEN_URL } from "./scopes";

const REFRESH_THRESHOLD_SECONDS = 60;

export function makeMyMLHApi(
  env: Env,
  getProps: () => Props,
  updateProps: (next: Props) => Promise<void>,
) {
  async function clearStoredTokens(base: Props): Promise<void> {
    await updateProps({
      ...base,
      accessToken: "",
      refreshToken: undefined,
      tokenType: undefined,
      scope: undefined,
      expiresIn: undefined,
      accessTokenIssuedAt: undefined,
    });
  }

  async function refreshUpstreamToken(): Promise<MyMLHTokenResponse | null> {
    const props = getProps();
    if (!props.refreshToken) {
      await clearStoredTokens(props);
      return null;
    }
    const [tokenJson] = await requestUpstreamToken({
      upstream_url: MYMLH_TOKEN_URL,
      client_id: env.MYMLH_CLIENT_ID,
      client_secret: env.MYMLH_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: props.refreshToken,
    });
    if (tokenJson?.access_token) {
      await updateProps({
        ...props,
        accessToken: tokenJson.access_token,
        refreshToken: tokenJson.refresh_token ?? props.refreshToken,
        tokenType: tokenJson.token_type ?? props.tokenType,
        scope: tokenJson.scope ?? props.scope,
        expiresIn: tokenJson.expires_in ?? props.expiresIn,
        accessTokenIssuedAt: Math.floor(Date.now() / 1000),
      });
      return tokenJson;
    }
    await clearStoredTokens(props);
    return null;
  }

  async function fetchMyMLHWithAutoRefresh(url: string, init?: RequestInit): Promise<Response> {
    const props = getProps();
    const now = Math.floor(Date.now() / 1000);
    const issuedAt = props.accessTokenIssuedAt ?? 0;
    const expiresIn = props.expiresIn ?? 0;
    const expAt = issuedAt + expiresIn;

    let effectiveAccessToken = props.accessToken;
    if (expiresIn && now >= expAt - REFRESH_THRESHOLD_SECONDS) {
      const refreshed = await refreshUpstreamToken();
      if (refreshed?.access_token) effectiveAccessToken = refreshed.access_token;
    }

    const withAuth = (token: string): RequestInit => {
      const headers = new Headers(init?.headers as HeadersInit);
      headers.set("Authorization", `Bearer ${token}`);
      return { ...(init ?? {}), headers };
    };

    let resp = await fetch(url, withAuth(effectiveAccessToken));
    if (resp.status === 401) {
      const refreshed = await refreshUpstreamToken();
      const retryToken = refreshed?.access_token ?? getProps().accessToken;
      resp = await fetch(url, withAuth(retryToken));
      if (resp.status === 401) await clearStoredTokens(getProps());
    }
    return resp;
  }

  return { refreshUpstreamToken, fetchMyMLHWithAutoRefresh };
}
```

- [ ] **Step 4: Re-run tests — expect PASS**

```bash
npm test -- test/unit/api.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/mymlh/api.ts test/unit/api.test.ts
git commit -m "feat(mymlh): add auto-refresh fetch and refreshUpstreamToken"
```

---

## Task 10: `src/mcp/tools/user.ts`

**Files:**
- Create: `src/mcp/tools/user.ts`

No dedicated unit test — tool behavior is covered via integration tests in Task 18.

- [ ] **Step 1: Create `src/mcp/tools/user.ts`**

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MYMLH_API_BASE } from "../../mymlh/scopes";
import type { MyMLHUser, ToolContext } from "../../types";

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
    const full = (await resp.json()) as MyMLHUser;
    return { content: [{ type: "text", text: JSON.stringify(full) }] };
  });
}
```

- [ ] **Step 2: Type-check, lint, commit**

```bash
npm run type-check
npm run lint
git add src/mcp/tools/user.ts
git commit -m "feat(mcp/tools): add mymlh_get_user tool"
```

---

## Task 11: `src/mcp/tools/tokens.ts`

**Files:**
- Create: `src/mcp/tools/tokens.ts`

- [ ] **Step 1: Create `src/mcp/tools/tokens.ts`**

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types";

function buildTokenPayload(props: {
  accessToken: string;
  tokenType?: string;
  scope?: string;
  expiresIn?: number;
  accessTokenIssuedAt?: number;
}) {
  const { accessToken, tokenType, scope, expiresIn, accessTokenIssuedAt } = props;
  const expires_at =
    accessTokenIssuedAt && expiresIn ? accessTokenIssuedAt + expiresIn : undefined;
  const now = Math.floor(Date.now() / 1000);
  const expires_in = expires_at ? Math.max(0, expires_at - now) : undefined;
  return {
    access_token: accessToken,
    token_type: tokenType,
    scope,
    issued_at: accessTokenIssuedAt,
    ttl: expiresIn,
    expires_in,
    expires_at,
  };
}

export function registerTokenTools(server: McpServer, ctx: ToolContext): void {
  server.tool(
    "mymlh_refresh_token",
    "Exchange refresh_token for a new access token and persist it",
    {},
    async () => {
      const props = ctx.getProps();
      if (!props.refreshToken) {
        return {
          content: [{ type: "text", text: "No refresh token available. Cannot refresh access token." }],
          isError: true,
        };
      }
      const json = await ctx.refreshUpstreamToken();
      if (!json || !json.access_token) {
        return {
          content: [
            {
              type: "text",
              text: "Failed to refresh token. The refresh token may have been revoked. Please re-authenticate by reconnecting to the MCP server.",
            },
          ],
          isError: true,
        };
      }
      const payload = buildTokenPayload(ctx.getProps());
      return { content: [{ type: "text", text: JSON.stringify(payload) }] };
    },
  );

  server.tool("mymlh_get_token", "Return current MyMLH access token details", {}, async () => {
    const props = ctx.getProps();
    if (!props.accessToken) {
      return {
        content: [{ type: "text", text: "No access token available. Please authenticate first." }],
        isError: true,
      };
    }
    const payload = buildTokenPayload(props);
    return { content: [{ type: "text", text: JSON.stringify(payload) }] };
  });
}
```

- [ ] **Step 2: Type-check, lint, commit**

```bash
npm run type-check
npm run lint
git add src/mcp/tools/tokens.ts
git commit -m "feat(mcp/tools): add mymlh_get_token and mymlh_refresh_token"
```

---

## Task 12: `src/mcp/tools/index.ts` (registry)

**Files:**
- Create: `src/mcp/tools/index.ts`

- [ ] **Step 1: Create `src/mcp/tools/index.ts`**

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { makeMyMLHApi } from "../../mymlh/api";
import type { Props, ToolContext } from "../../types";
import { registerTokenTools } from "./tokens";
import { registerUserTools } from "./user";

export function registerAllTools(
  server: McpServer,
  deps: { env: Env; getProps: () => Props; updateProps: (next: Props) => Promise<void> },
): void {
  const api = makeMyMLHApi(deps.env, deps.getProps, deps.updateProps);
  const ctx: ToolContext = { env: deps.env, getProps: deps.getProps, ...api };

  registerUserTools(server, ctx);
  registerTokenTools(server, ctx);
}
```

- [ ] **Step 2: Commit**

```bash
npm run type-check
npm run lint
git add src/mcp/tools/index.ts
git commit -m "feat(mcp/tools): add registry glue"
```

---

## Task 13: `src/mcp/agent.ts` (MyMCP Durable Object via `McpAgent`)

**Files:**
- Create: `src/mcp/agent.ts`

**API drift note for `agents@0.11`:** the `McpAgent` class from `agents/mcp` still uses the generic signature `McpAgent<Env, State, Props>` with `init()`, `this.props`, `this.updateProps()`, and static `MyMCP.serve(path)` / `MyMCP.serveSSE(path)` methods. Before implementing, run:

```bash
cat node_modules/agents/dist/mcp/index.d.ts | head -120
```

to verify the generics and method names. Adjust the code below if the types have shifted (e.g., if `updateProps` has been renamed or if `props` is now a getter).

- [ ] **Step 1: Create `src/mcp/agent.ts`**

```ts
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
```

- [ ] **Step 2: Type-check and resolve any `agents@0.11` drift**

```bash
npm run type-check
```

If this fails due to changed generic order or method renames, adapt in place (e.g., if `McpAgent` now takes `<Props, State>` or if `this.props` is only available synchronously, re-bind). Document every adjustment with a commit message like `fix(mcp/agent): adapt to agents@0.11 ...`.

- [ ] **Step 3: Commit**

```bash
npm run lint
git add src/mcp/agent.ts
git commit -m "feat(mcp): add MyMCP Durable Object agent wrapping McpAgent"
```

---

## Task 14: `src/index.ts` (OAuthProvider wiring)

**Files:**
- Create: `src/index.ts`

**API drift note for `workers-oauth-provider@0.4`:** the `OAuthProvider` class should still accept `{ apiHandlers, authorizeEndpoint, clientRegistrationEndpoint, defaultHandler, refreshTokenTTL, tokenEndpoint }`. Run:

```bash
cat node_modules/@cloudflare/workers-oauth-provider/dist/oauth-provider.d.ts | head -200
```

to confirm. Adjust if the option names have changed.

- [ ] **Step 1: Create `src/index.ts`**

```ts
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { MyMCP } from "./mcp/agent";
import { MyMLHHandler } from "./oauth/handler";

export { MyMCP };

export default new OAuthProvider({
  apiHandlers: {
    "/sse": MyMCP.serveSSE("/sse"),
    "/mcp": MyMCP.serve("/mcp"),
  },
  authorizeEndpoint: "/authorize",
  clientRegistrationEndpoint: "/register",
  defaultHandler: MyMLHHandler as unknown as ExportedHandler,
  refreshTokenTTL: 24 * 60 * 60,
  tokenEndpoint: "/token",
});
```

- [ ] **Step 2: Type-check, lint**

```bash
npm run type-check
npm run lint
```

If `apiHandlers` now requires a different shape or `defaultHandler` typing changed, adapt inline.

- [ ] **Step 3: Run the full test suite to confirm existing unit tests still pass**

```bash
npm test
```

All unit tests from Tasks 4-9 pass.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire OAuthProvider to MyMCP agent and MyMLH handler"
```

---

## Task 15: Integration test — unauthorized `/mcp` returns 401 with `WWW-Authenticate`

**Files:**
- Create: `test/integration/unauthorized.test.ts`

- [ ] **Step 1: Write test**

```ts
import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";

describe("/mcp unauthorized", () => {
  it("returns 401 with a WWW-Authenticate header", async () => {
    const resp = await SELF.fetch("https://worker.test/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(resp.status).toBe(401);
    expect(resp.headers.get("www-authenticate")).toBeTruthy();
  });

  it("liveness route returns 200 JSON", async () => {
    const resp = await SELF.fetch("https://worker.test/");
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as { name: string };
    expect(json.name).toBe("mymlh-mcp-server");
  });
});
```

- [ ] **Step 2: Run**

```bash
npm test -- test/integration/unauthorized.test.ts
```

Expected: both pass. If `SELF` is not importable, add the missing `types` entry to `tsconfig.json`'s `types` array (e.g., `@cloudflare/vitest-pool-workers`) and re-run.

- [ ] **Step 3: Commit**

```bash
git add test/integration/unauthorized.test.ts tsconfig.json
git commit -m "test(integration): assert /mcp 401 and liveness route"
```

---

## Task 16: Integration test — GET `/authorize` renders dialog, POST `/authorize` redirects

**Files:**
- Create: `test/integration/authorize.test.ts`

- [ ] **Step 1: Write test**

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { SELF, env } from "cloudflare:test";

async function registerClient() {
  const resp = await SELF.fetch("https://worker.test/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Test Client",
      redirect_uris: ["https://client.test/cb"],
      token_endpoint_auth_method: "none",
    }),
  });
  expect(resp.status).toBe(201);
  return (await resp.json()) as { client_id: string; redirect_uris: string[] };
}

describe("/authorize", () => {
  beforeEach(() => {
    // Ensure secrets exist in the test env for the handler.
    (env as unknown as Record<string, string>).MYMLH_CLIENT_ID = "test-client-id";
    (env as unknown as Record<string, string>).MYMLH_CLIENT_SECRET = "test-client-secret";
    (env as unknown as Record<string, string>).COOKIE_ENCRYPTION_KEY = "test-cookie-secret";
  });

  it("GET /authorize without approval cookie renders dialog", async () => {
    const { client_id, redirect_uris } = await registerClient();
    const url = new URL("https://worker.test/authorize");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", client_id);
    url.searchParams.set("redirect_uri", redirect_uris[0]);
    url.searchParams.set("code_challenge", "c".repeat(43));
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", "xyz");

    const resp = await SELF.fetch(url.href);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toContain("text/html");
    const html = await resp.text();
    expect(html).toContain("Test Client");
    expect(html).toContain("MyMLH MCP Server");
  });

  it("POST /authorize with encoded state redirects to MyMLH authorize URL", async () => {
    const { client_id, redirect_uris } = await registerClient();
    const oauthReqInfo = {
      clientId: client_id,
      redirectUri: redirect_uris[0],
      scope: [],
      state: "xyz",
      responseType: "code",
      codeChallenge: "c".repeat(43),
      codeChallengeMethod: "S256",
    };
    const form = new FormData();
    form.set("state", btoa(JSON.stringify({ oauthReqInfo })));

    const resp = await SELF.fetch("https://worker.test/authorize", {
      method: "POST",
      body: form,
      redirect: "manual",
    });
    expect(resp.status).toBe(302);
    const loc = resp.headers.get("location")!;
    expect(loc).toContain("https://my.mlh.io/oauth/authorize");
    expect(loc).toContain("prompt=consent");
    expect(loc).toContain("client_id=test-client-id");
    expect(resp.headers.get("set-cookie")).toContain("mcp-approved-clients=");
    expect(resp.headers.get("set-cookie")).toContain("Max-Age=5");
  });
});
```

- [ ] **Step 2: Run — expect PASS**

```bash
npm test -- test/integration/authorize.test.ts
```

If the OAuthProvider library rejects the registration payload shape for 0.4 (e.g., new required field), adjust the registration payload until it returns 201. Do not change the handler's expected behavior.

- [ ] **Step 3: Commit**

```bash
git add test/integration/authorize.test.ts
git commit -m "test(integration): assert /authorize dialog + POST redirect"
```

---

## Task 17: Integration test — `/callback` completes flow + `/token` exchange

**Files:**
- Create: `test/integration/callback.test.ts`

- [ ] **Step 1: Write test**

```ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { SELF, env, fetchMock } from "cloudflare:test";

beforeEach(() => {
  (env as unknown as Record<string, string>).MYMLH_CLIENT_ID = "cid";
  (env as unknown as Record<string, string>).MYMLH_CLIENT_SECRET = "sec";
  (env as unknown as Record<string, string>).COOKIE_ENCRYPTION_KEY = "cookie-secret";
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => {
  fetchMock.assertNoPendingInterceptors();
});

async function registerClient() {
  const resp = await SELF.fetch("https://worker.test/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "TC",
      redirect_uris: ["https://client.test/cb"],
      token_endpoint_auth_method: "none",
    }),
  });
  return (await resp.json()) as { client_id: string; redirect_uris: string[] };
}

describe("/callback", () => {
  it("exchanges code, fetches user, completes authorization and redirects to client", async () => {
    const { client_id, redirect_uris } = await registerClient();

    fetchMock
      .get("https://my.mlh.io")
      .intercept({ path: "/oauth/token", method: "POST" })
      .reply(
        200,
        JSON.stringify({
          access_token: "AT",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "RT",
          scope: "public user:read:profile",
        }),
        { headers: { "content-type": "application/json" } },
      );
    fetchMock
      .get("https://api.mlh.com")
      .intercept({ path: "/v4/users/me", method: "GET", headers: { authorization: "Bearer AT" } })
      .reply(
        200,
        JSON.stringify({ id: "user-1", first_name: "A", last_name: "B", email: "a@b.test" }),
        { headers: { "content-type": "application/json" } },
      );

    const oauthReqInfo = {
      clientId: client_id,
      redirectUri: redirect_uris[0],
      scope: ["public"],
      state: "xyz",
      responseType: "code",
      codeChallenge: "c".repeat(43),
      codeChallengeMethod: "S256",
    };
    const url = new URL("https://worker.test/callback");
    url.searchParams.set("code", "UPSTREAM_CODE");
    url.searchParams.set("state", btoa(JSON.stringify(oauthReqInfo)));

    const resp = await SELF.fetch(url.href, { redirect: "manual" });
    expect(resp.status).toBe(302);
    const loc = resp.headers.get("location")!;
    expect(loc.startsWith("https://client.test/cb")).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect PASS**

```bash
npm test -- test/integration/callback.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add test/integration/callback.test.ts
git commit -m "test(integration): assert /callback completes OAuth flow"
```

---

## Task 18: Integration test — authorized `/mcp` lists tools and invokes `mymlh_get_user`

**Files:**
- Create: `test/integration/tools.test.ts`

This test walks `/authorize` → `/callback` → `/token` → `/mcp` end-to-end. It is the most involved test.

- [ ] **Step 1: Write test**

```ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { SELF, env, fetchMock } from "cloudflare:test";

beforeEach(() => {
  (env as unknown as Record<string, string>).MYMLH_CLIENT_ID = "cid";
  (env as unknown as Record<string, string>).MYMLH_CLIENT_SECRET = "sec";
  (env as unknown as Record<string, string>).COOKIE_ENCRYPTION_KEY = "cookie-secret";
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => {
  fetchMock.assertNoPendingInterceptors();
});

async function fullOAuthFlow(): Promise<string> {
  const reg = await SELF.fetch("https://worker.test/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "TC",
      redirect_uris: ["https://client.test/cb"],
      token_endpoint_auth_method: "none",
    }),
  });
  const { client_id, redirect_uris } = (await reg.json()) as {
    client_id: string;
    redirect_uris: string[];
  };

  const codeVerifier = "a".repeat(43);
  const codeChallenge = codeVerifier; // plain is accepted; we test behavior, not PKCE crypto
  const oauthReqInfo = {
    clientId: client_id,
    redirectUri: redirect_uris[0],
    scope: ["public"],
    state: "xyz",
    responseType: "code",
    codeChallenge,
    codeChallengeMethod: "plain",
  };

  fetchMock
    .get("https://my.mlh.io")
    .intercept({ path: "/oauth/token", method: "POST" })
    .reply(
      200,
      JSON.stringify({
        access_token: "AT",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "RT",
        scope: "public user:read:profile user:read:education user:read:employment",
      }),
      { headers: { "content-type": "application/json" } },
    );
  fetchMock
    .get("https://api.mlh.com")
    .intercept({ path: "/v4/users/me", method: "GET", headers: { authorization: "Bearer AT" } })
    .reply(
      200,
      JSON.stringify({ id: "u", first_name: "A", last_name: "B", email: "a@b.test" }),
      { headers: { "content-type": "application/json" } },
    );

  const cbUrl = new URL("https://worker.test/callback");
  cbUrl.searchParams.set("code", "UPSTREAM_CODE");
  cbUrl.searchParams.set("state", btoa(JSON.stringify(oauthReqInfo)));
  const cb = await SELF.fetch(cbUrl.href, { redirect: "manual" });
  const clientRedirect = new URL(cb.headers.get("location")!);
  const code = clientRedirect.searchParams.get("code")!;

  const tokenForm = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirect_uris[0],
    client_id,
    code_verifier: codeVerifier,
  });
  const tokenResp = await SELF.fetch("https://worker.test/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: tokenForm.toString(),
  });
  const tok = (await tokenResp.json()) as { access_token: string };
  return tok.access_token;
}

describe("/mcp tool calls", () => {
  it("tools/list returns the three MyMLH tools", async () => {
    const accessToken = await fullOAuthFlow();

    const resp = await SELF.fetch("https://worker.test/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(resp.status).toBe(200);
    const text = await resp.text();
    expect(text).toContain("mymlh_get_user");
    expect(text).toContain("mymlh_get_token");
    expect(text).toContain("mymlh_refresh_token");
  });

  it("tools/call mymlh_get_user returns MyMLH user JSON", async () => {
    fetchMock
      .get("https://api.mlh.com")
      .intercept({ path: /^\/v4\/users\/me/, method: "GET", headers: { authorization: "Bearer AT" } })
      .reply(
        200,
        JSON.stringify({ id: "u", first_name: "A", last_name: "B", email: "a@b.test" }),
        { headers: { "content-type": "application/json" } },
      );

    const accessToken = await fullOAuthFlow();
    const resp = await SELF.fetch("https://worker.test/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "mymlh_get_user", arguments: {} },
      }),
    });
    expect(resp.status).toBe(200);
    const text = await resp.text();
    expect(text).toContain("a@b.test");
  });
});
```

- [ ] **Step 2: Run — expect PASS (may need `accept` header or session-init tweaks depending on `agents@0.11` MCP transport behavior)**

```bash
npm test -- test/integration/tools.test.ts
```

If the Streamable-HTTP transport requires a session-init call before `tools/list`, add it: `POST /mcp` with `{ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } }` and then grab the returned `Mcp-Session-Id` response header and resend subsequent requests with it.

- [ ] **Step 3: Commit**

```bash
git add test/integration/tools.test.ts
git commit -m "test(integration): assert tools/list and tools/call via /mcp"
```

---

## Task 19: Add GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the workflow**

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
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run type-check
      - run: npm run lint
      - run: npm test
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions workflow for type-check, lint, test"
```

---

## Task 20: Update `.gitignore` and add CI badge to `README.md`

**Files:**
- Modify: `.gitignore`
- Modify: `README.md`

- [ ] **Step 1: Append to `.gitignore`**

Add these lines if not already present:

```text
.worktrees/
coverage/
```

Use `grep -q` before appending to avoid dupes:

```bash
grep -q '^\.worktrees/$' .gitignore || printf '\n.worktrees/\n' >> .gitignore
grep -q '^coverage/$' .gitignore || printf 'coverage/\n' >> .gitignore
```

- [ ] **Step 2: Add CI badge to `README.md`**

Insert after the existing badge block (before line `A [Model Context Protocol (MCP)]...`):

```md
[![CI](https://github.com/wei/mymlh-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/wei/mymlh-mcp-server/actions/workflows/ci.yml)
```

- [ ] **Step 3: Commit**

```bash
git add .gitignore README.md
git commit -m "chore: add worktrees/coverage to gitignore, add CI badge to README"
```

---

## Task 21: Update `CONTRIBUTING.md` and `AGENTS.md` to match new layout

**Files:**
- Modify: `CONTRIBUTING.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: In `CONTRIBUTING.md`** — find the "Project structure" section and replace references to the old paths with the new tree. Use the list from the spec §3.

Replace any of these old entries:
- `src/index.ts` → keep, but describe as "OAuthProvider wiring + MyMCP export"
- `src/mymlh-handler.ts` → `src/oauth/handler.ts`
- `src/utils.ts` → `src/oauth/upstream.ts`
- `src/workers-oauth-utils.ts` → `src/oauth/approval/{cookie,dialog,index}.ts`
- `src/mymlh-api.ts` → `src/mymlh/api.ts`
- `src/constants.ts` → `src/mymlh/scopes.ts`
- `src/tools/` → `src/mcp/tools/`
- Add: `src/mcp/agent.ts`, `test/unit/`, `test/integration/`, `vitest.config.ts`.

- [ ] **Step 2: In `AGENTS.md`** — apply the same path updates in its "Project Structure & Module Organization" section. Add a "Testing" line pointing to `npm test` and the new `test/` tree.

- [ ] **Step 3: Commit**

```bash
git add CONTRIBUTING.md AGENTS.md
git commit -m "docs: update CONTRIBUTING and AGENTS for new src layout"
```

---

## Task 22: Full local verification (manual gate — describe, do not automate)

**Files:** none.

- [ ] **Step 1: Run full quality gate**

```bash
npm run type-check && npm run lint && npm test
```

All three green.

- [ ] **Step 2: Smoke test against `wrangler dev` + MCP Inspector (manual — document commands)**

In one terminal:

```bash
npm run dev
```

In another:

```bash
npx @modelcontextprotocol/inspector@latest
```

Inspector URL: `http://localhost:8788/mcp`. Walk: connect → OAuth flow → tools/list (should show 3 tools) → tools/call `mymlh_get_user` → verify profile returns.

This is a manual verification step. If any part fails, fix the underlying code (do not skip) and re-run the quality gate.

- [ ] **Step 3: No commit needed unless a fix was required.**

---

## Task 23: Open PR from `rebuild/from-scratch` to `main`

**Files:** none.

- [ ] **Step 1: Push the branch**

```bash
git push -u origin rebuild/from-scratch
```

- [ ] **Step 2: Create PR with a detailed body**

```bash
gh pr create --title "rebuild: MyMLH MCP server on Cloudflare Workers with latest deps and test suite" --body "$(cat <<'EOF'
## Summary
- Full `src/` rewrite with a new module layout under `src/oauth`, `src/mcp`, `src/mymlh`.
- All dependencies bumped to current majors (`@cloudflare/workers-oauth-provider@0.4`, `agents@0.11`, `@modelcontextprotocol/sdk@1.29`, `hono@4.12`, `zod@4.3`, `typescript@6`, `@types/node@25`, `wrangler@4.85`, `biome@2.4`, `lefthook@2.1`). Added `vitest@4` + `@cloudflare/vitest-pool-workers@0.15`.
- New `test/` tree with unit + integration coverage (cookie HMAC, upstream URL/token helpers, auto-refresh API, approval dialog, `/mcp`, `/authorize`, `/callback`, `/token`, `tools/list`, `tools/call`).
- New `.github/workflows/ci.yml` running type-check, lint, test on pushes and PRs.
- Preserved: all public endpoint paths, tool names, tool behavior, approval dialog fields, cookie semantics, KV IDs, env blocks, route patterns, DO migration `v1` with class name `MyMCP`.
- Dropped unused deps: `just-pick`, `workers-mcp`.

## Test plan
- [x] `npm run type-check`
- [x] `npm run lint`
- [x] `npm test`
- [x] `npm run dev` + MCP Inspector locally
- [ ] Deploy to `alt` env, repeat inspector run against `https://mymlh-mcp-alt.git.ci/mcp`
- [ ] After merge: deploy production + fallback

See `docs/superpowers/specs/2026-04-24-mymlh-mcp-rebuild-design.md` for full design.
EOF
)"
```

- [ ] **Step 3: Paste the PR URL in the final report.**

---

## Post-merge (out of plan scope)

After merge to `main`, run manually:

```bash
git switch main
git pull
npm run deploy:production
npm run deploy:fallback
# Optional staging check first:
# npm run deploy:alt
```

Because the DO class name (`MyMCP`) and migration tag (`v1`) are unchanged, existing production sessions survive the deploy.
