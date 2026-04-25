import { describe, expect, it } from "vitest";
import { buildSetCookie, COOKIE_NAME, readApprovedClients } from "../../src/oauth/approval/cookie";

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
