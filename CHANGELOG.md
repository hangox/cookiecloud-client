# Changelog

## [1.0.0] - 2026-03-11

### Added
- `CookieCloudClient` class with constructor and `fromEnv()` static factory
- `getCookies()` method with optional domain filtering
- Full TypeScript type exports (`Cookie`, `CookieCloudConfig`, `GetCookiesOptions`)
- Zero external dependencies — uses Node.js native `crypto` module
- ESM and CJS dual format support
