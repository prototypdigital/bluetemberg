# Installation

Blueprint is published to the GitHub Packages npm registry under `@prototypdigital/blueprint`.

## Prerequisites

- Node.js >= 18
- npm, pnpm, or yarn
- GitHub account with access to the `prototypdigital` organization

## 1. Authenticate with GitHub Packages

Create or add to your project's `.npmrc`:

```
@prototypdigital:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Set the `GITHUB_TOKEN` environment variable to a personal access token (classic) with `read:packages` scope, or a fine-grained token with Packages read permission.

For CI environments, use the built-in `GITHUB_TOKEN` secret.

## 2. Install

### Option A: Run directly with npx

```bash
npx @prototypdigital/blueprint init
```

### Option B: Install as a dev dependency

```bash
npm install -D @prototypdigital/blueprint
# or
pnpm add -D @prototypdigital/blueprint
```

Then use via package scripts:

```bash
npx blueprint init
npx blueprint sync
```

## CI authentication

In GitHub Actions, add the registry setup to your workflow:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: '20'
    registry-url: 'https://npm.pkg.github.com'
    scope: '@prototypdigital'
  env:
    NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```
