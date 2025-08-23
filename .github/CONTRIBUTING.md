# Contributing to FlixBridge

Thank you for your interest in contributing to FlixBridge! This document outlines the development process, coding standards, and contribution guidelines.

## Development Setup

### Prerequisites

- **Node.js**: Version 20 or higher (recommended LTS version)
- **npm**: Version 8 or higher (comes with Node.js)
- **Git**: Latest version

### Getting Started

1. **Fork and Clone**
   ```bash
   git clone https://github.com/yourusername/arr_mcp.git
   cd arr_mcp
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Build and Test**
   ```bash
   npm run build
   npm run lint
   npm run smoke  # Requires configuration - see below
   ```

4. **Configuration Setup**
   ```bash
   # Copy sample configuration
   cp config.sample.json config.json
   
   # Edit with your actual API keys and service URLs
   # See README.md for detailed configuration instructions
   ```

## Development Workflow

### Branch Strategy

- **`main`**: Production-ready code, protected branch
- **Feature branches**: `feature/your-feature-name`
- **Bug fixes**: `fix/issue-description`
- **Documentation**: `docs/what-youre-updating`

### Making Changes

1. **Create Feature Branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make Changes**
   - Follow the existing code patterns and architecture
   - Update tests if applicable
   - Update documentation as needed

3. **Test Locally**
   ```bash
   npm run lint        # Check code style
   npm run build       # Ensure TypeScript compiles
   npm run smoke       # Run integration tests (requires config)
   ```

4. **Commit Changes** (see commit message guidelines below)

5. **Push and Create PR**
   ```bash
   git push origin feature/your-feature-name
   ```

## Commit Message Guidelines

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification for automatic semantic versioning and changelog generation.

### Format

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### Types

- **feat**: New features (triggers minor version bump)
- **fix**: Bug fixes (triggers patch version bump)
- **docs**: Documentation changes
- **style**: Code style changes (formatting, etc.)
- **refactor**: Code refactoring without functionality changes
- **test**: Adding or updating tests
- **chore**: Maintenance tasks, dependency updates
- **perf**: Performance improvements
- **ci**: CI/CD pipeline changes

### Breaking Changes

For breaking changes (triggers major version bump):
- Add `BREAKING CHANGE:` in the footer, OR
- Add `!` after the type: `feat!: redesign API`

### Examples

```bash
# Feature addition (minor version bump)
feat: add SABnzbd downloader integration

# Bug fix (patch version bump)  
fix: resolve timeout issues in queue operations

# Breaking change (major version bump)
feat!: redesign service configuration format

BREAKING CHANGE: Configuration format has changed from array to object structure

# Documentation update (no version bump)
docs: update installation instructions

# Dependency update (patch version bump)
chore: bump @modelcontextprotocol/sdk to v0.5.0
```

### Scope Examples

- `feat(api)`: API-related features
- `fix(queue)`: Queue operation fixes  
- `docs(readme)`: README updates
- `chore(deps)`: Dependency updates

## Code Standards

### TypeScript

- **Strict Mode**: All TypeScript strict settings enabled
- **No `any` Types**: Use proper typing throughout
- **Interfaces**: Prefer interfaces over types for object shapes
- **Zod Schemas**: Use Zod for runtime validation of external API responses

### Code Style

- **ESLint**: Follow the configured ESLint rules
- **Naming**: Use descriptive, camelCase variable names
- **Comments**: Document complex logic and API interactions
- **Error Handling**: Use the established error handling patterns

### Architecture Guidelines

- **Service Abstraction**: Follow the existing service pattern (BaseArrService → SonarrService/RadarrService)
- **Single HTTP Helper**: All external requests through `fetchJson()` function
- **MCP Tool Registration**: New operations require both service implementation and MCP tool registration
- **Response Format**: Maintain consistent `{ ok, data?, error? }` response structure

## Project Constraints

⚠️ **Important**: This project follows specific architectural constraints (see AGENTS.md):

- **Minimal Dependencies**: Only essential packages allowed
- **No Heavy Frameworks**: Prefer native Node.js APIs
- **Inheritance Pattern**: Use abstract BaseArrService for shared functionality
- **Single Entry Point**: All HTTP requests through centralized helper

## Testing

### Test Types

1. **Linting**: `npm run lint`
2. **Type Checking**: `npm run build`
3. **Integration Tests**: `npm run smoke` (requires valid configuration)
4. **Debug Testing**: `FLIX_BRIDGE_DEBUG=1 npm run smoke`

### Configuration for Testing

Create a test configuration file for local development:

```bash
# Create test configuration
cp config.sample.json config.test.json

# Edit with test/development service URLs
# Use non-production instances when possible
```

## Pull Request Process

### Before Submitting

- [ ] Code follows project standards and conventions
- [ ] TypeScript compiles without errors (`npm run build`)
- [ ] ESLint passes without errors (`npm run lint`)
- [ ] Smoke tests pass (if configuration available)
- [ ] Documentation updated (if applicable)
- [ ] Commit messages follow conventional format

### PR Description Template

```markdown
## Description
Brief description of changes and motivation.

## Type of Change
- [ ] Bug fix (non-breaking change fixing an issue)
- [ ] New feature (non-breaking change adding functionality)
- [ ] Breaking change (fix or feature causing existing functionality to not work as expected)
- [ ] Documentation update
- [ ] Performance improvement
- [ ] Code refactoring

## Testing
Describe how you tested these changes:
- [ ] Local testing completed
- [ ] Smoke tests pass
- [ ] Cross-platform testing (if applicable)

## Checklist
- [ ] Code follows project style guidelines
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] No new warnings introduced
```

## Release Process

Releases are automated through GitHub Actions:

1. **Automatic**: Merging to `main` triggers automated versioning and publishing
2. **Manual**: Can be triggered manually through GitHub Actions UI
3. **Version Determination**: Based on commit messages since last release
4. **Changelog**: Automatically generated from commit messages

## Getting Help

- **Issues**: Check existing issues or create new ones
- **Discussions**: Use GitHub Discussions for questions
- **Documentation**: Refer to README.md and WARP.md for project details

## Code of Conduct

- Be respectful and inclusive
- Focus on constructive feedback
- Follow project guidelines and conventions
- Help maintain a welcoming environment for all contributors

Thank you for contributing to FlixBridge! 🚀
