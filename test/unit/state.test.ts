import { describe, expect, it } from "vitest";
import { signState, verifyState } from "../../src/oauth/approval/cookie";

const SECRET = "test-secret-key";

describe("signState / verifyState", () => {
  it("round-trips correctly", async () => {
    const payload = JSON.stringify({ clientId: "abc", scope: ["public"] });
    const token = await signState(payload, SECRET);
    const result = await verifyState(token, SECRET);
    expect(result).toBe(payload);
  });

  it("returns null when signature is tampered", async () => {
    const payload = JSON.stringify({ clientId: "abc" });
    const token = await signState(payload, SECRET);
    // Flip last char of sig hex (before the dot)
    const dotIdx = token.indexOf(".");
    const tamperedSig = token.slice(0, dotIdx - 1) + (token[dotIdx - 1] === "a" ? "b" : "a");
    const tampered = tamperedSig + token.slice(dotIdx);
    const result = await verifyState(tampered, SECRET);
    expect(result).toBeNull();
  });

  it("returns null when payload is tampered", async () => {
    const payload = JSON.stringify({ clientId: "abc" });
    const token = await signState(payload, SECRET);
    const dotIdx = token.indexOf(".");
    // Replace b64 payload with different content
    const tamperedB64 = btoa(JSON.stringify({ clientId: "evil" }));
    const tampered = token.slice(0, dotIdx + 1) + tamperedB64;
    const result = await verifyState(tampered, SECRET);
    expect(result).toBeNull();
  });

  it("returns null when wrong secret is used", async () => {
    const payload = JSON.stringify({ clientId: "abc" });
    const token = await signState(payload, SECRET);
    const result = await verifyState(token, "wrong-secret");
    expect(result).toBeNull();
  });

  it("returns null for malformed token (no dot)", async () => {
    const result = await verifyState("nodothere", SECRET);
    expect(result).toBeNull();
  });

  it("returns null for empty string", async () => {
    const result = await verifyState("", SECRET);
    expect(result).toBeNull();
  });
});
