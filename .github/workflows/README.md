# GitHub Actions CI/CD Pipeline

This document explains the automated build, test, and publishing workflow for the FlixBridge MCP Server.

## Workflow Overview

The CI/CD pipeline consists of three main workflows:

### 1. Build and Publish (`build-and-publish.yml`)

**Triggers:**
- Push to `main` branch (triggers full pipeline including publishing)
- Pull requests to `main` branch (runs tests only, no publishing)
- Manual dispatch via GitHub Actions UI

**Jobs:**

#### Test Job
- **Matrix Testing**: Runs across Node.js versions 18.x, 20.x, and 22.x
- **Steps**:
  1. Checkout code
  2. Setup Node.js with caching
  3. Install dependencies (`npm ci`)
  4. Lint code (`npm run lint`)
  5. Build project (`npm run build`)
  6. Check TypeScript compilation (`npx tsc --noEmit`)
  7. Run smoke tests (`npm run smoke`) with debug logging

#### Security Job
- Runs npm security audit (`npm audit --audit-level=moderate`)
- Fails the pipeline if moderate or higher security vulnerabilities are found

#### Publish Job (main branch only)
- **Dependency**: Requires `test` and `security` jobs to pass
- **Change Detection**: Skips publishing if no meaningful changes detected
- **Version Bumping**: Automatic semantic versioning based on commit messages
- **Steps**:
  1. Determine version bump type from commit messages
  2. Update `package.json` version
  3. Generate/update `CHANGELOG.md`
  4. Commit changes with `[skip ci]` flag
  5. Create git tag
  6. Push changes and tags
  7. Publish to npm with public access
  8. Create GitHub release

#### Discord Notification Job
- Sends release notification to Discord (if webhook configured)
- Only runs after successful publishing

## Semantic Versioning

The workflow automatically determines version bumps based on commit message patterns:

| Commit Message Pattern | Version Bump | Example |
|----------------------|--------------|---------|
| Contains "BREAKING", "breaking", or "major" | **Major** (1.0.0 → 2.0.0) | `feat: add new API BREAKING CHANGE` |
| Contains "feat", "feature", or "minor" | **Minor** (1.0.0 → 1.1.0) | `feat: add queue diagnostics` |
| All other changes | **Patch** (1.0.0 → 1.0.1) | `fix: resolve connection timeout` |

### Recommended Commit Message Format

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

**Examples:**
```bash
feat: add SABnzbd downloader integration
fix: resolve timeout issues in queue operations
docs: update installation instructions
chore: bump dependencies to latest versions
feat!: redesign API endpoints (BREAKING CHANGE)
```

## Required Secrets

### NPM_TOKEN (Required for Publishing)
1. Log into npm: `npm login`
2. Create automation token: `npm token create --type=automation --scope=@thesammykins`
3. Add token to GitHub repository secrets as `NPM_TOKEN`

**Setting up the secret:**
1. Go to your GitHub repository
2. Settings → Secrets and variables → Actions
3. Click "New repository secret"
4. Name: `NPM_TOKEN`
5. Value: Your npm automation token

### DISCORD_WEBHOOK_URL (Optional)
- Discord webhook URL for release notifications
- Set up a webhook in your Discord server
- Add the webhook URL as a repository secret

## Workflow Behavior

### Feature Branch Development
1. Create feature branch: `git checkout -b feature/my-feature`
2. Make changes and commit with semantic messages
3. Push to GitHub: `git push origin feature/my-feature`
4. Create pull request to `main`
5. GitHub Actions runs test and security jobs
6. Merge after approval and passing tests

### Publishing Process
1. Merge PR to `main` or push directly
2. GitHub Actions automatically:
   - Runs full test suite across Node.js versions
   - Performs security audit
   - Determines version bump from commit messages
   - Updates `package.json` and `CHANGELOG.md`
   - Publishes to npm registry
   - Creates GitHub release
   - Sends Discord notification (if configured)

### Manual Publishing
You can manually trigger the workflow:
1. Go to Actions tab in GitHub
2. Select "Build and Publish"
3. Click "Run workflow"
4. Select branch (usually `main`)
5. Click "Run workflow"

## Package Information

- **Package Name**: `@thesammykins/flixbridge`
- **Registry**: https://www.npmjs.com/package/@thesammykins/flixbridge
- **Install Command**: `npm install @thesammykins/flixbridge`
- **Scope**: `@thesammykins` (public access)

## Troubleshooting

### Build Failures

**Common Issues:**
- **TypeScript Compilation Errors**: Check `npm run build` locally
- **Linting Failures**: Run `npm run lint` and fix issues
- **Smoke Test Failures**: Ensure configuration files are valid
- **Security Vulnerabilities**: Run `npm audit` and update dependencies

**Debug Steps:**
1. Check the Actions tab for detailed logs
2. Run the failing command locally: `npm run build`, `npm run lint`, `npm run smoke`
3. Enable debug mode: `FLIX_BRIDGE_DEBUG=1 npm run smoke`

### Publishing Issues

**Common Issues:**
- **NPM_TOKEN Invalid**: Regenerate and update the secret
- **Version Already Exists**: The workflow should handle this, but manual intervention may be needed
- **Scope Permissions**: Ensure the npm token has publish rights for `@thesammykins` scope

**Debug Steps:**
1. Verify npm token: `npm whoami` (locally)
2. Check package exists: `npm view @thesammykins/flixbridge`
3. Verify scope permissions in npm account settings

### Skip Publishing

To push changes to `main` without triggering a release:
- Include `[skip ci]` in commit message
- Or ensure no meaningful code changes (documentation-only changes)

## Manual Operations

### Local Version Bump
```bash
# Patch version
npm version patch

# Minor version  
npm version minor

# Major version
npm version major

# Push tags
git push origin main --follow-tags
```

### Manual Publish
```bash
npm run build
npm publish --access public
```

### Local Testing
```bash
# Test the build process
npm ci
npm run lint
npm run build
npm run smoke

# Test with debug logging
FLIX_BRIDGE_DEBUG=1 npm run smoke

# Test across Node.js versions (requires nvm)
nvm use 18 && npm ci && npm run build && npm run smoke
nvm use 20 && npm ci && npm run build && npm run smoke  
nvm use 22 && npm ci && npm run build && npm run smoke
```
