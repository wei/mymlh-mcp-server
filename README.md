# Model Context Protocol (MCP) Server + MyMLH OAuth v4

This is a [Model Context Protocol (MCP)](https://modelcontextprotocol.io/introduction) server for Cloudflare Workers that supports remote MCP connections, with MyMLH OAuth v4 built-in.

You can deploy it to your own Cloudflare account and, after you create your MyMLH application, you'll have a fully functional remote MCP server. Users connect by signing in with their MyMLH account and granting scopes.

It uses the [`@cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider) library to implement the OAuth 2.0 server for MCP clients, and acts as an OAuth client to MyMLH.

The MCP server (powered by [Cloudflare Workers](https://developers.cloudflare.com/workers/)):

- Acts as OAuth _Server_ to your MCP clients
- Acts as OAuth _Client_ to your OAuth provider (MyMLH)

## Getting Started

Clone the repo directly & install dependencies: `npm install`.

This project is intended for production deployment.

### For Production

Create a new MyMLH Application in the MLH developer portal:

- Homepage URL: `https://<your-worker>.<your-subdomain>.workers.dev`
- Authorization callback URL: `https://<your-worker>.<your-subdomain>.workers.dev/callback`
- Note your Client ID and Client Secret.
- Set secrets via Wrangler:

```bash
wrangler secret put MYMLH_CLIENT_ID
wrangler secret put MYMLH_CLIENT_SECRET
wrangler secret put COOKIE_ENCRYPTION_KEY # e.g. openssl rand -hex 32
```

> [!IMPORTANT]
> When you create the first secret, Wrangler will ask if you want to create a new Worker. Submit "Y" to create a new Worker and save the secret.

#### Set up a KV namespace

- Create the KV namespace:
  `wrangler kv namespace create "OAUTH_KV"`
- Update the Wrangler file with the KV ID

#### Deploy & Test

Deploy the MCP server to make it available on your workers.dev domain
` wrangler deploy`

Test the server using [Inspector](https://modelcontextprotocol.io/docs/tools/inspector):

```
npx @modelcontextprotocol/inspector@latest
```

Enter `https://<your-worker>.<your-subdomain>.workers.dev/mcp` and hit connect. Once you go through the authentication flow, you'll see the tools working.

You now have a remote MCP server deployed!

### Access Control

This MCP server uses MyMLH OAuth for authentication. All authenticated users can access the MyMLH tools. You can restrict sensitive tools by adding user ids or emails to `ALLOWED_USERS` in `src/index.ts`.

### Access from MCP clients

Once the tools show up in the interface of your chosen MCP client, you can ask it to use them. For example: "Fetch my MyMLH user and include education and employment".

### For Local Development

To test locally, create a second MyMLH application with:

- Homepage URL: `http://localhost:8788`
- Authorization callback URL: `http://localhost:8788/callback`
- Create `.dev.vars` in your project root with:

```
MYMLH_CLIENT_ID=your_dev_mylmh_client_id
MYMLH_CLIENT_SECRET=your_dev_mylmh_client_secret
COOKIE_ENCRYPTION_KEY=your_cookie_key
```

#### Develop & Test

Run the server locally to make it available at `http://localhost:8788`
`wrangler dev`

To test the local server, enter `http://localhost:8788/mcp` into Inspector and hit connect. Once you follow the prompts, you'll be able to "List Tools".

#### MCP Clients

Consult your MCP client's documentation for how to connect to an HTTP MCP server endpoint at `/mcp`.

You can connect your MCP server to other MCP clients like Windsurf by opening the client's configuration file, adding the same JSON that was used for the Claude setup, and restarting the MCP client.

## How does it work?

#### OAuth Provider

The OAuth Provider library serves as a complete OAuth 2.1 server implementation for Cloudflare Workers. It handles the complexities of the OAuth flow, including token issuance, validation, and management. In this project, it plays the dual role of:

- Authenticating MCP clients that connect to your server
- Managing the connection to MyMLH's OAuth services
- Securely storing tokens and authentication state in KV storage

#### Durable MCP

Durable MCP extends the base MCP functionality with Cloudflare's Durable Objects, providing:

- Persistent state management for your MCP server
- Secure storage of authentication context between requests
- Access to authenticated user information via `this.props`
- Support for conditional tool availability based on user identity

#### MCP Remote

The MCP libraries enable your server to expose tools that can be invoked by MCP clients like the Inspector. It:

- Defines the protocol for communication between clients and your server
- Provides a structured way to define tools
- Handles serialization and deserialization of requests and responses
- Connects over the Streamable HTTP protocol at `/mcp`
