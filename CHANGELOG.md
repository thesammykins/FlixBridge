# Changelog

## [Unreleased]

### Added
- `list_services` tool for discovering all configured services and downloaders
- Service discovery workflow that must be called before using other tools
- Enhanced documentation with service discovery requirements
- Test script for validating list_services functionality

### Updated
- All documentation now emphasizes calling `list_services` first
- API reference includes comprehensive service discovery section
- Usage guide updated with service discovery workflow

## [0.2.10] - 2025-08-23

- fix: support both flat and nested env mapping formats

## [0.2.9] - 2025-08-23

- fixing github actions AGAIN

## [0.2.8] - 2025-08-23

- fixing env vars not importing

## [0.2.7] - 2025-08-23

- fix: correct MCP server initialization and capabilities declaration
- fix: server now properly responds to initialize requests from MCP clients
- verify: both config.json and FLIX_BRIDGE_ENV_MAPPING configurations work correctly

## [0.2.6] - 2025-08-23

- docs: add global installation option and fix npx usage examples

## [0.2.5] - 2025-08-23

- fixing npm package lacking a  variable in it's json

## [0.2.4] - 2025-08-23

- docs: improve README with npm package links and usage examples

## [0.2.3] - 2025-08-23

- updating tool calls and documentation

## [0.2.2] - 2025-08-23

- Update README.md

## [0.2.1] - 2025-08-23

- Update README.md

## [0.2.0] - 2025-08-23

- feat: optimize npm package size and publish configuration

## [0.1.1] - 2025-08-23

- docs: Reorganize documentation and rebrand to Flix-Bridge
- Update files
- Update README and package.json, Setup Github Actions workflow to package automatically
- Fix smoke.ts failing when running tests in Actions

