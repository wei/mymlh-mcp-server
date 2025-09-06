# Deploying Your Own Instance

This guide provides instructions for deploying your own instance of the MyMLH MCP Server to Cloudflare Workers.

## Prerequisites

- A [Cloudflare account](https://dash.cloudflare.com/sign-up)
- A [MyMLH developer account](https://my.mlh.io/developers)
- [Node.js](https://nodejs.org/) (latest LTS version recommended)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) installed and authenticated

## 1. Set Up Your MyMLH Application

First, you need to create a new MyMLH Application in the [MLH developer portal](https://my.mlh.io/developers) to get your API credentials.

- **Homepage URL**: `https://<your-worker>.<your-subdomain>.workers.dev`
- **Authorization callback URL**: `https://<your-worker>.<your-subdomain>.workers.dev/callback`

Replace `<your-worker>` and `<your-subdomain>` with the names you plan to use for your Cloudflare Worker. After creating the application, take note of your **Client ID** and **Client Secret**.

## 2. Configure Your Environment

Next, you need to set your MyMLH credentials and a cookie encryption key as secrets in your Cloudflare environment using Wrangler.

Run the following commands in your terminal:

```bash
wrangler secret put MYMLH_CLIENT_ID
# Paste your MyMLH Client ID when prompted

wrangler secret put MYMLH_CLIENT_SECRET
# Paste your MyMLH Client Secret when prompted

wrangler secret put COOKIE_ENCRYPTION_KEY
# Generate a random key, e.g., by running: openssl rand -hex 32
```

> [!IMPORTANT]
> When you create the first secret, Wrangler may ask if you want to create a new Worker. Submit "Y" to create a new Worker and save the secret.

## 3. Set Up KV Namespace

The server uses a Cloudflare KV namespace to store OAuth state. Create one by running:

```bash
wrangler kv:namespace create "OAUTH_KV"
```

This command will output an ID. You need to add this to your `wrangler.jsonc` file. Open `wrangler.jsonc` and add or update the `kv_namespaces` section like this:

```json
{
  "kv_namespaces": [
    {
      "binding": "OAUTH_KV",
      "id": "paste_your_kv_id_here"
    }
  ]
}
```

## 4. Deploy the Server

With your configuration in place, you can now deploy the MCP server to your Cloudflare account.

```bash
wrangler deploy
```

Once the deployment is complete, your MCP server will be available at the URL you configured in the first step (`https://<your-worker>.<your-subdomain>.workers.dev`).

## 5. Test Your Deployment

You can test your newly deployed server using the [Model Context Protocol Inspector](https://modelcontextprotocol.io/docs/tools/inspector).

Run the Inspector from your terminal:
```bash
npx @modelcontextprotocol/inspector@latest
```

In the Inspector, enter the URL to your server's MCP endpoint: `https://<your-worker>.<your-subdomain>.workers.dev/mcp` and click "Connect".

You will be guided through the MyMLH authentication flow. Once authenticated, you should see the available tools in the Inspector, confirming that your server is working correctly.
