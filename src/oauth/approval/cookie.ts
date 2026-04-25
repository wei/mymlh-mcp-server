export const COOKIE_NAME = "mcp-approved-clients";
const ONE_YEAR_IN_SECONDS = 31536000;

async function importKey(secret: string): Promise<CryptoKey> {
  if (!secret) {
    throw new Error("COOKIE_ENCRYPTION_KEY is not defined. A secret key is required for signing cookies.");
  }
  const enc = new TextEncoder();
  return crypto.subtle.importKey("raw", enc.encode(secret), { hash: "SHA-256", name: "HMAC" }, false, [
    "sign",
    "verify",
  ]);
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

export async function readApprovedClients(cookieHeader: string | null, secret: string): Promise<string[] | null> {
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
