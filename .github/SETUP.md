# GitHub Actions Setup Instructions

This guide walks you through setting up the automated publishing workflow for FlixBridge.

## Prerequisites

Before the GitHub Actions workflow can publish to npm, you need to:

1. **npm Account**: Have an npm account with publishing permissions
2. **GitHub Repository**: Have admin access to the GitHub repository
3. **Scoped Package**: Permission to publish to the `@thesammykins` scope

## Step 1: npm Authentication Token

### Create npm Token

1. **Log into npm**:
   ```bash
   npm login
   ```

2. **Create an automation token**:
   ```bash
   npm token create --type=automation --scope=@thesammykins
   ```
   
   This will output a token starting with `npm_`. **Copy this token immediately** - you won't be able to see it again.

### Alternative: Web Interface

1. Go to [npmjs.com](https://www.npmjs.com) and log in
2. Click your avatar → "Access Tokens"
3. Click "Generate New Token"
4. Select "Automation" type
5. Copy the generated token

## Step 2: Add GitHub Repository Secret

1. **Go to your GitHub repository**
2. **Navigate to Settings** → **Secrets and variables** → **Actions**
3. **Click "New repository secret"**
4. **Add the following secret**:
   - **Name**: `NPM_TOKEN`
   - **Value**: The npm token from Step 1 (starts with `npm_`)
5. **Click "Add secret"**

## Step 3: Optional Discord Notifications

If you want release notifications in Discord:

1. **Create Discord Webhook**:
   - Go to your Discord server
   - Edit Channel → Integrations → Webhooks
   - Create New Webhook
   - Copy the webhook URL

2. **Add GitHub Secret**:
   - **Name**: `DISCORD_WEBHOOK_URL`
   - **Value**: Your Discord webhook URL

## Step 4: Verify npm Scope Permissions

Ensure you have permission to publish to the `@thesammykins` scope:

1. **Check scope access**:
   ```bash
   npm access ls-packages @thesammykins
   ```

2. **If you need to create the scope**:
   ```bash
   npm org create @thesammykins
   ```

3. **Grant publish permissions** (if needed):
   ```bash
   npm access grant read-write @thesammykins <your-npm-username>
   ```

## Step 5: Test the Setup

### Manual Workflow Trigger

1. **Go to your GitHub repository**
2. **Click Actions tab**
3. **Select "Build and Publish"**
4. **Click "Run workflow"**
5. **Select branch** (usually `main`)
6. **Click "Run workflow"**

### Check for Issues

**Common problems and solutions:**

- **NPM_TOKEN invalid**: Regenerate the token and update the secret
- **Scope permission denied**: Verify you have publish rights to `@thesammykins`
- **Version already exists**: The workflow handles this, but check npm registry
- **Build failures**: Check the Actions tab for detailed logs

## Step 6: Understanding the Workflow

### When Does it Run?

- **Automatic**: On every push to `main` branch
- **Manual**: Via GitHub Actions UI
- **Pull Requests**: Tests only (no publishing)

### Version Bumping

The workflow automatically determines version bumps based on commit messages:

| Commit Pattern | Version Bump | Example |
|---------------|--------------|---------|
| `feat:`, `feature:` | **Minor** (1.0.0 → 1.1.0) | `feat: add new diagnostics` |
| `fix:` | **Patch** (1.0.0 → 1.0.1) | `fix: resolve timeout issue` |
| `BREAKING` | **Major** (1.0.0 → 2.0.0) | `feat!: redesign API` |

### What Gets Published?

1. **npm Package**: `@thesammykins/flixbridge`
2. **GitHub Release**: With auto-generated changelog
3. **Git Tag**: Version tag (e.g., `v0.1.1`)
4. **Discord Notification**: If webhook configured

## Troubleshooting

### npm Authentication Issues

```bash
# Test your npm token locally
npm whoami

# Check package exists
npm view @thesammykins/flixbridge

# Test publish permissions (dry run)
npm publish --dry-run --access public
```

### GitHub Actions Debugging

1. **Check Actions tab** for detailed logs
2. **Look for red X** next to failed steps
3. **Common issues**:
   - Missing `NPM_TOKEN` secret
   - Invalid npm token
   - Scope permission issues
   - TypeScript compilation errors

### Local Testing

Before pushing to `main`, test locally:

```bash
# Install dependencies
npm ci

# Run linting
npm run lint

# Build TypeScript
npm run build

# Run smoke tests (requires configuration)
npm run smoke

# Test with debug logging
FLIX_BRIDGE_DEBUG=1 npm run smoke
```

## Security Notes

- **Never commit npm tokens** to the repository
- **Use automation tokens** (not classic tokens) for CI/CD
- **Scope tokens** to the minimum necessary permissions
- **Rotate tokens regularly** for security

## Questions?

If you encounter issues:

1. Check the [workflow documentation](.github/workflows/README.md)
2. Review the [troubleshooting guide](.github/workflows/README.md#troubleshooting)
3. Open an issue with detailed logs
4. Tag maintainers in the issue

---

Once setup is complete, the workflow will automatically handle versioning, publishing, and releases! 🚀
