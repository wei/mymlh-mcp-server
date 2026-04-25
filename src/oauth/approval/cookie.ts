export const COOKIE_NAME = "mcp-approved-clients";
const ONE_YEAR_IN_SECONDS = 31536000;

const enc = new TextEncoder();
const keyCache = new Map<string, Promise<CryptoKey>>();

function getKey(secret: string): Promise<CryptoKey> {
  if (!secret) {
    throw new Error("COOKIE_ENCRYPTION_KEY is not defined. A secret key is required for signing cookies.");
  }
  let cached = keyCache.get(secret);
  if (!cached) {
    cached = crypto.subtle.importKey("raw", enc.encode(secret), { hash: "SHA-256", name: "HMAC" }, false, [
      "sign",
      "verify",
    ]);
    keyCache.set(secret, cached);
  }
  return cached;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) return null;
    out[i] = byte;
  }
  return out;
}

async function signPayload(key: CryptoKey, data: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return bytesToHex(new Uint8Array(sig));
}

async function verifySignature(key: CryptoKey, signatureHex: string, data: string): Promise<boolean> {
  const bytes = hexToBytes(signatureHex);
  if (!bytes) return false;
  try {
    return await crypto.subtle.verify("HMAC", key, bytes, enc.encode(data));
  } catch (e) {
    console.error("Error verifying signature:", e);
    return false;
  }
}

export async function signState(payload: string, secret: string): Promise<string> {
  const key = await getKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  const sigHex = bytesToHex(new Uint8Array(sig));
  return `${sigHex}.${btoa(payload)}`;
}

export async function verifyState(token: string, secret: string): Promise<string | null> {
  const [sigHex, b64] = token.split(".");
  if (!sigHex || !b64) return null;
  let payload: string;
  try {
    payload = atob(b64);
  } catch {
    return null;
  }
  const key = await getKey(secret);
  const bytes = hexToBytes(sigHex);
  if (!bytes) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", key, bytes, enc.encode(payload));
    return ok ? payload : null;
  } catch {
    return null;
  }
}

export async function readApprovedClients(cookieHeader: string | null, secret: string): Promise<string[] | null> {
  if (!cookieHeader) return null;
  const target = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE_NAME}=`));
  if (!target) return null;

  const [signatureHex, base64Payload] = target.substring(COOKIE_NAME.length + 1).split(".");
  if (!signatureHex || !base64Payload) return null;

  let payload: string;
  try {
    payload = atob(base64Payload);
  } catch {
    return null;
  }

  const key = await getKey(secret);
  if (!(await verifySignature(key, signatureHex, payload))) return null;

  try {
    const parsed = JSON.parse(payload);
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) return null;
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
  const key = await getKey(secret);
  const signature = await signPayload(key, payload);
  const value = `${signature}.${btoa(payload)}`;
  return `${COOKIE_NAME}=${value}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}
