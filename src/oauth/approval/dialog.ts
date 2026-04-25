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

// Restrict embedded URLs to http(s) so attacker-registered clientUri/policyUri/tosUri
// values like `javascript:` or `data:text/html,...` cannot execute when rendered as
// `<a href>` / `<img src>` on the consent page.
function safeHttpUrl(value: string): string | null {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
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

const STYLE_BLOCK = `<style>
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
    </style>`;

export function renderApprovalDialog(request: Request, options: ApprovalDialogOptions): Response {
  const { client, server, state } = options;
  const encodedState = btoa(JSON.stringify(state));
  const serverName = server.name;
  const clientName = client?.clientName ?? "Unknown MCP Client";
  const serverDescription = server.description ?? "";
  const logoUrl = server.logo ? (safeHttpUrl(server.logo) ?? "") : "";
  const clientUri = client?.clientUri ? (safeHttpUrl(client.clientUri) ?? "") : "";
  const policyUri = client?.policyUri ? (safeHttpUrl(client.policyUri) ?? "") : "";
  const tosUri = client?.tosUri ? (safeHttpUrl(client.tosUri) ?? "") : "";
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
  const redirectBlock =
    redirectUris.length > 0
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
    ${raw(STYLE_BLOCK)}
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
