# Deploying Your Own Instance

This guide provides instructions for deploying your own instance of the MyMLH MCP Server to Cloudflare Workers. The project supports multiple environments for different deployment scenarios.

## Available Environments

The project is configured with the following environments in `wrangler.jsonc`:

- **production** — Main production deployment
- **alt** — Alternative/staging environment
- **fallback** — Fallback environment
- **local** — Local development environment

Each environment can have its own configuration, secrets, and resources.

## Prerequisites

- A [Cloudflare account](https://dash.cloudflare.com/sign-up)
- A [MyMLH developer account](https://my.mlh.io/developers)
- [Node.js](https://nodejs.org/) (latest LTS version recommended)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) installed and authenticated

## 1. Set Up Your MyMLH Application

First, you need to create a new MyMLH Application in the [MLH developer portal](https://my.mlh.io/developers) to get your API credentials.

- **Callback URLs**: `https://<your-worker>.<your-subdomain>.workers.dev/callback`

Replace `<your-worker>` and `<your-subdomain>` with the names you plan to use for your Cloudflare Worker. After creating the application, take note of your **Client ID** and **Client Secret**.

## 2. Configure Your Environment

You need to set your MyMLH credentials and a cookie encryption key as secrets in your Cloudflare environment using Wrangler. Since the project uses multiple environments, you'll need to set secrets for each environment you plan to use.

### For Production Environment

```bash
wrangler secret put MYMLH_CLIENT_ID -e production
# Paste your MyMLH Client ID when prompted

wrangler secret put MYMLH_CLIENT_SECRET -e production
# Paste your MyMLH Client Secret when prompted

wrangler secret put COOKIE_ENCRYPTION_KEY -e production
# Generate a random key, e.g., by running: openssl rand -hex 32
```

### For Alt/Staging Environment

```bash
wrangler secret put MYMLH_CLIENT_ID -e alt
wrangler secret put MYMLH_CLIENT_SECRET -e alt
wrangler secret put COOKIE_ENCRYPTION_KEY -e alt
```

### For Fallback Environment

```bash
wrangler secret put MYMLH_CLIENT_ID -e fallback
wrangler secret put MYMLH_CLIENT_SECRET -e fallback
wrangler secret put COOKIE_ENCRYPTION_KEY -e fallback
```

> [!IMPORTANT]
> When you create the first secret, Wrangler may ask if you want to create a new Worker. Submit "Y" to create a new Worker and save the secret.

## 3. Set Up KV Namespace

The server uses Cloudflare KV namespaces to store OAuth state. You can either use the same KV namespace across environments or create separate ones for isolation.

### Option A: Shared KV Namespace (Simple)

Create one KV namespace to share across all environments:

```bash
wrangler kv:namespace create "OAUTH_KV"
```

This command will output an ID. The current `wrangler.jsonc` already includes this binding in each environment. Update the `id` field in each environment's `kv_namespaces` section with your KV namespace ID.

### Option B: Separate KV Namespaces (Recommended for Production)

Create separate KV namespaces for each environment for better isolation:

```bash
wrangler kv:namespace create "OAUTH_KV" -e production
wrangler kv:namespace create "OAUTH_KV" -e alt
wrangler kv:namespace create "OAUTH_KV" -e fallback
```

Update the `id` field in each environment's `kv_namespaces` section in `wrangler.jsonc` with the respective IDs.

## 4. (Optional) Configure Custom Domains

The project is pre-configured with custom domains for each environment:

- **Production**: `mymlh-mcp.git.ci`
- **Alt**: `mymlh-mcp-alt.git.ci`
- **Fallback**: `mymlh-mcp-fallback.git.ci`

If you want to use your own custom domains:

1. Verify your domain is added to Cloudflare.
2. Update the `pattern` field in each environment's `routes` section in `wrangler.jsonc`:

```jsonc
{
  "env": {
    "production": {
      "routes": [
        {
          "pattern": "your-production-domain.example",
          "custom_domain": true
        }
      ]
    }
  }
}
```

3. Add the callback URLs to your MyMLH application:
   - `https://your-production-domain.example/callback`
   - `https://your-alt-domain.example/callback`
   - `https://your-fallback-domain.example/callback`

## 5. Deploy the Server

With your configuration in place, you can now deploy to specific environments:

### Deploy to Production
```bash
npm run deploy:production
```

### Deploy to Alt Environment
```bash
npm run deploy:alt
```

### Deploy to Fallback Environment
```bash
npm run deploy:fallback
```

Once deployment is complete, your MCP server will be available at the configured domain for each environment.

## 6. Test Your Deployment

You can test your newly deployed server using the [Model Context Protocol Inspector](https://modelcontextprotocol.io/docs/tools/inspector).

Run the Inspector from your terminal:
```bash
npx @modelcontextprotocol/inspector@latest
```

In the Inspector, enter the URL to your server's MCP endpoint for the environment you deployed:

- **Production**: `https://mymlh-mcp.git.ci/mcp` (or your custom domain)
- **Alt**: `https://mymlh-mcp-alt.git.ci/mcp` (or your custom domain)
- **Fallback**: `https://mymlh-mcp-fallback.git.ci/mcp` (or your custom domain)

Click "Connect" and follow the authentication flow. Once authenticated, you should see the available tools in the Inspector, confirming that your server is working correctly.

## Environment-Specific Builds (CI/CD)

For automatic deployments, you can configure Cloudflare Workers builds to deploy different environments from different Git branches:

- **Production environment**: Deploy from `main` branch using `npm run deploy:production`
- **Alt environment**: Deploy from `staging` branch using `npm run deploy:alt`
- **Fallback environment**: Deploy from `fallback` branch using `npm run deploy:fallback`

Configure these in your Cloudflare dashboard under **Workers & Pages** > **Settings** > **Builds** for each Worker.
