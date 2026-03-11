# cookiecloud-client

Node.js client for [CookieCloud](https://github.com/easychen/CookieCloud) — fetch and decrypt browser cookies synced via the CookieCloud browser extension.

Zero external dependencies. ESM and CJS supported. Written in TypeScript with full type exports.

## Prerequisites

1. A running **CookieCloud server** (self-hosted or public)
2. The **CookieCloud browser extension** installed and configured to sync cookies to your server
3. Your CookieCloud **UUID** and **password** (set in the browser extension)

## Install

```bash
# npm
npm install cookiecloud-client

# pnpm
pnpm add cookiecloud-client

# yarn
yarn add cookiecloud-client
```

## Quick Start

```typescript
import { CookieCloudClient } from 'cookiecloud-client';

const client = new CookieCloudClient({
  server: 'https://your-cookiecloud-server.com',
  uuid: 'your-uuid',
  password: 'your-password',
});

const cookies = await client.getCookies();
console.log(cookies);
// [{ name: 'session', value: 'abc123', domain: '.example.com', ... }, ...]
```

## API Reference

### `new CookieCloudClient(config)`

Creates a new client instance.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `config.server` | `string` | Yes | CookieCloud server URL (e.g. `https://cookie.example.com`) |
| `config.uuid` | `string` | Yes | Your CookieCloud UUID |
| `config.password` | `string` | Yes | Your CookieCloud encryption password |

**Throws:** `Error` with message `"CookieCloud config requires server, uuid, and password"` if any field is empty.

```typescript
const client = new CookieCloudClient({
  server: 'https://cookie.example.com',
  uuid: 'my-uuid',
  password: 'my-password',
});
```

---

### `CookieCloudClient.fromEnv()`

Static factory that creates a client from environment variables.

**Environment variables:**

| Variable | Description |
|----------|-------------|
| `COOKIE_CLOUD_SERVER` | CookieCloud server URL |
| `COOKIE_CLOUD_UUID` | Your UUID |
| `COOKIE_CLOUD_PASSWORD` | Your encryption password |

**Throws:** `Error` if any environment variable is missing.

```typescript
// Set env vars first:
// COOKIE_CLOUD_SERVER=https://cookie.example.com
// COOKIE_CLOUD_UUID=my-uuid
// COOKIE_CLOUD_PASSWORD=my-password

const client = CookieCloudClient.fromEnv();
```

---

### `client.getCookies(options?)`

Fetches encrypted cookies from the CookieCloud server, decrypts them, and returns parsed cookie objects.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `options` | `GetCookiesOptions` | No | Optional filtering |
| `options.domain` | `string` | No | Filter cookies by domain (matches subdomains too) |

**Returns:** `Promise<Cookie[]>`

**Throws:**
- `Error` with message `"CookieCloud request failed: {status} {statusText}"` — HTTP request failed
- `Error` with message `"CookieCloud response missing encrypted data"` — server returned unexpected format
- `Error` — decryption or JSON parsing failed (wrong password or corrupted data)

```typescript
// Get all cookies
const allCookies = await client.getCookies();

// Filter by domain (matches .example.com and sub.example.com)
const filtered = await client.getCookies({ domain: 'example.com' });
```

## Types

```typescript
import type { Cookie, CookieCloudConfig, GetCookiesOptions } from 'cookiecloud-client';
```

### `Cookie`

```typescript
type Cookie = {
  name: string;        // Cookie name
  value: string;       // Cookie value
  domain: string;      // Domain (e.g. ".example.com")
  path: string;        // Path (e.g. "/")
  expires: number;     // Expiration timestamp (seconds), -1 if not set
  httpOnly: boolean;   // HttpOnly flag
  secure: boolean;     // Secure flag
  sameSite: 'Lax' | 'Strict' | 'None';  // SameSite attribute (defaults to 'Lax' if unrecognized)
};
```

### `CookieCloudConfig`

```typescript
type CookieCloudConfig = {
  server: string;
  uuid: string;
  password: string;
};
```

### `GetCookiesOptions`

```typescript
type GetCookiesOptions = {
  domain?: string;  // Filter by domain
};
```

## Integration Examples

### Basic Usage

```typescript
import { CookieCloudClient } from 'cookiecloud-client';

const client = new CookieCloudClient({
  server: 'https://cookie.example.com',
  uuid: 'my-uuid',
  password: 'my-password',
});

const cookies = await client.getCookies();
```

### With Playwright — Inject Browser Cookies

```typescript
import { chromium } from 'playwright';
import { CookieCloudClient } from 'cookiecloud-client';

const client = CookieCloudClient.fromEnv();
const cookies = await client.getCookies({ domain: 'example.com' });

const browser = await chromium.launch();
const context = await browser.newContext();

// Inject cookies into the browser context
await context.addCookies(cookies);

const page = await context.newPage();
await page.goto('https://example.com/dashboard');
// Page loads with authentication cookies already set
```

### With HTTP Requests — Add Cookie Header

```typescript
import { CookieCloudClient } from 'cookiecloud-client';

const client = CookieCloudClient.fromEnv();
const cookies = await client.getCookies({ domain: 'api.example.com' });

// Build cookie header string
const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');

const response = await fetch('https://api.example.com/data', {
  headers: { Cookie: cookieHeader },
});
```

### Polling for Cookie Refresh

```typescript
import { CookieCloudClient } from 'cookiecloud-client';

const client = CookieCloudClient.fromEnv();

async function waitForCookieRefresh(
  domain: string,
  oldCookies: Awaited<ReturnType<typeof client.getCookies>>,
  maxWaitMs = 120_000,
  pollIntervalMs = 3_000,
) {
  const oldValues = new Set(
    oldCookies.map((c) => `${c.name}=${c.value}`),
  );

  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    try {
      const fresh = await client.getCookies({ domain });
      const hasChange = fresh.some((c) => !oldValues.has(`${c.name}=${c.value}`));
      if (hasChange) return fresh;
    } catch {
      // retry on failure
    }
  }
  throw new Error('Timed out waiting for cookie refresh');
}
```

### Error Handling

```typescript
import { CookieCloudClient } from 'cookiecloud-client';

try {
  const client = CookieCloudClient.fromEnv();
  const cookies = await client.getCookies();
  console.log(`Fetched ${cookies.length} cookies`);
} catch (error) {
  if (error instanceof Error) {
    if (error.message.includes('Missing environment variables')) {
      console.error('Configure COOKIE_CLOUD_SERVER, COOKIE_CLOUD_UUID, COOKIE_CLOUD_PASSWORD');
    } else if (error.message.includes('request failed')) {
      console.error('CookieCloud server unreachable or returned an error');
    } else if (error.message.includes('missing encrypted data')) {
      console.error('Server response format unexpected — check UUID');
    } else {
      console.error('Decryption failed — check password:', error.message);
    }
  }
}
```

## FAQ

**Q: What encryption does CookieCloud use?**
A: AES-128-CBC with OpenSSL-compatible key derivation (EVP_BytesToKey). The password for key derivation is `MD5(uuid + "-" + password)` (16 bytes). When the encrypted data contains an OpenSSL `Salted__` prefix, salt is extracted and used with EVP_BytesToKey to derive the actual AES key and IV.

**Q: Does this work in the browser?**
A: No. This package uses Node.js `crypto` module and is designed for server-side / CLI usage.

**Q: What Node.js versions are supported?**
A: Node.js 18 and above (requires native `fetch` support).

**Q: How does domain filtering work?**
A: `getCookies({ domain: 'example.com' })` matches cookies whose domain ends with `example.com` (including `.example.com`, `sub.example.com`), and vice versa.

## License

MIT
