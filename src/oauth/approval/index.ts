import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import { buildSetCookie, readApprovedClients } from "./cookie";

export type { ApprovalDialogOptions } from "./dialog";
export { renderApprovalDialog } from "./dialog";

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
