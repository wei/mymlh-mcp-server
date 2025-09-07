# Contributing to MyMLH MCP Server

Thank you for your interest in contributing to the MyMLH MCP Server! We welcome contributions of all kinds, from bug fixes to new features and documentation improvements.

## Getting Started

Before you begin, please make sure you have the following installed:

- [Node.js](https://nodejs.org/) (latest LTS version recommended)
- [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/)
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) for testing and deployment
- A [MyMLH developer account](https://my.mlh.io/developers) to get API credentials

## Development Setup

1.  **Fork and Clone the Repository**

    Start by forking the repository to your own GitHub account, and then clone it to your local machine:

    ```bash
    git clone https://github.com/YOUR_USERNAME/mymlh-mcp-server.git
    cd mymlh-mcp-server
    ```

2.  **Install Dependencies**

    Install the project dependencies using npm:

    ```bash
    npm install
    ```

3.  **Set Up Local Environment Variables**

    For local development, you'll need a MyMLH application. Create one in the [MyMLH developer portal](https://my.mlh.io/developers) with the following settings:

    -   **Homepage URL**: `http://localhost:8788`
    -   **Authorization callback URL**: `http://localhost:8788/callback`

    Once created, copy the `.dev.vars.example` file to a new file named `.dev.vars` and fill in your development credentials:

    ```
    MYMLH_CLIENT_ID=your_dev_mylmh_client_id
    MYMLH_CLIENT_SECRET=your_dev_mylmh_client_secret
    COOKIE_ENCRYPTION_KEY=generate_a_random_32_byte_hex_string
    ```

    You can generate a `COOKIE_ENCRYPTION_KEY` by running `openssl rand -hex 32` in your terminal.

4.  **Run the Development Server**

    Start the local development server using Wrangler:

    ```bash
    wrangler dev
    ```

    Your server will be running at `http://localhost:8788`.

## Testing Your Changes

To test your changes locally, you can use the [Model Context Protocol Inspector](https://modelcontextprotocol.io/docs/tools/inspector):

```bash
npx @modelcontextprotocol/inspector@latest
```

Connect the Inspector to your local server at `http://localhost:8788/mcp`. You'll be redirected to MyMLH to authenticate, and then you can test the available tools.

## Contribution Guidelines

### Code Style

This project uses [Biome](https://biomejs.dev/) for code formatting and linting. Before committing your changes, please run the following command to ensure your code adheres to the project's style:

```bash
npm run lint
```

Git hooks are managed by [Lefthook](https://github.com/evilmartians/lefthook). Running `npm install` will install hooks via the `prepare` script. Hooks run Biome formatting + lint on staged files at pre-commit and a full Biome check at pre-push using the local Biome package (no `npx`).

### Commit Messages

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification. Please ensure your commit messages are descriptive and follow this format. This helps us automate releases and generate changelogs.

### Documentation Maintenance

Always keep documentation current with code changes. When you modify behavior, routes, tools, environment variables, config, build commands, or UI (approval dialog), update all relevant Markdown files in the same PR. At a minimum, review and update:

- `AGENTS.md` — process, conventions, and expectations.
- `README.md` — overview, setup, usage, endpoints.
- `CONTRIBUTING.md` — workflow and checklists.
- `DEPLOYMENT.md` — Wrangler commands, secrets, environments.
- `CODE_OF_CONDUCT.md` — only if policy/links change.
- Any `*.md` and other repo Markdown (e.g., `SECURITY.md`, `CHANGELOG.md`).

Also synchronize examples when renaming or changing:

- Routes/endpoints (e.g., `/mcp`, `/authorize`, callback paths) and tool names.
- Environment variables or secret names in `.dev.vars(.example)` and Wrangler.
- `package.json` scripts and documented usage.
- HTML approval dialog parameters/behavior in `workers-oauth-utils.ts`.

### Pull Request Process

1.  Create a new branch for your feature or bug fix:
    ```bash
    git checkout -b my-new-feature
    ```
2.  Make your changes and commit them with a clear message.
3.  Push your branch to your fork:
    ```bash
    git push origin my-new-feature
    ```
4.  Open a pull request from your fork to the main repository.
5.  In your pull request description, please explain the changes you've made and why.

#### Pre‑PR Checklist

- `npm run type-check && npm run lint` pass locally.
- Local OAuth flow verified (`/authorize` → callback → tools work via Inspector).
- Documentation updated as needed (e.g., `AGENTS.md`, `README.md`, `CONTRIBUTING.md`, `DEPLOYMENT.md`).
- Include a brief “Docs updated” note listing which docs changed and why.

## Code of Conduct

Please note that this project is released with a [Contributor Code of Conduct](CODE_OF_CONDUCT.md). By participating in this project you agree to abide by its terms.

## Questions?

If you have any questions, feel free to open an issue on GitHub.
