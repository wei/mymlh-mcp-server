import { env } from "cloudflare:test";
import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import { describe, expect, it } from "vitest";
import { consumeUpstreamState, createUpstreamState } from "../../src/oauth/state";

const kv = (env as unknown as Env).OAUTH_KV;

const reqInfo = {
  responseType: "code",
  clientId: "https://vscode.dev/oauth/client-metadata.json",
  redirectUri: "https://vscode.dev/redirect",
  scope: [],
  state: "vscode://dynamicauthprovider/example/authorize?nonce%3Dabc%26windowId%3D4",
  codeChallenge: "c".repeat(43),
  codeChallengeMethod: "S256",
} as unknown as AuthRequest;

describe("upstream state via KV", () => {
  it("round-trips the auth request through a short token", async () => {
    const token = await createUpstreamState(kv, reqInfo);
    const restored = await consumeUpstreamState(kv, token);
    expect(restored).toEqual(reqInfo);
  });

  it("keeps the token far below MLH's ~370-char session-cookie-overflow threshold", async () => {
    const token = await createUpstreamState(kv, reqInfo);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("is single-use", async () => {
    const token = await createUpstreamState(kv, reqInfo);
    expect(await consumeUpstreamState(kv, token)).toEqual(reqInfo);
    expect(await consumeUpstreamState(kv, token)).toBeNull();
  });

  it("rejects unknown tokens", async () => {
    expect(await consumeUpstreamState(kv, "A".repeat(43))).toBeNull();
  });

  it("rejects malformed tokens", async () => {
    expect(await consumeUpstreamState(kv, "")).toBeNull();
    expect(await consumeUpstreamState(kv, "short")).toBeNull();
    expect(await consumeUpstreamState(kv, "!".repeat(43))).toBeNull();
    // Legacy signed-JSON state shape must not be accepted.
    expect(await consumeUpstreamState(kv, `${"ab".repeat(32)}.${btoa('{"clientId":"x"}')}`)).toBeNull();
  });
});
