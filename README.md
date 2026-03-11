# cookiecloud-client

[CookieCloud](https://github.com/easychen/CookieCloud) 的 Node.js 客户端 — 获取并解密通过 CookieCloud 浏览器扩展同步的 Cookie。

零外部依赖。支持 ESM 和 CJS。使用 TypeScript 编写，完整导出类型定义。

## 前置条件

1. 运行中的 **CookieCloud 服务器**（自建或公共服务器）
2. 已安装并配置好的 **CookieCloud 浏览器扩展**，将 Cookie 同步到你的服务器
3. 你的 CookieCloud **UUID** 和 **密码**（在浏览器扩展中设置）

## 安装

```bash
# npm
npm install cookiecloud-client

# pnpm
pnpm add cookiecloud-client

# yarn
yarn add cookiecloud-client
```

## 快速开始

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

## API 参考

### `new CookieCloudClient(config)`

创建新的客户端实例。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `config.server` | `string` | 是 | CookieCloud 服务器地址（如 `https://cookie.example.com`） |
| `config.uuid` | `string` | 是 | CookieCloud UUID |
| `config.password` | `string` | 是 | CookieCloud 加密密码 |

**异常：** 如果任何字段为空，抛出 `Error`，消息为 `"CookieCloud config requires server, uuid, and password"`。

```typescript
const client = new CookieCloudClient({
  server: 'https://cookie.example.com',
  uuid: 'my-uuid',
  password: 'my-password',
});
```

---

### `CookieCloudClient.fromEnv()`

从环境变量创建客户端的静态工厂方法。

**环境变量：**

| 变量 | 说明 |
|------|------|
| `COOKIE_CLOUD_SERVER` | CookieCloud 服务器地址 |
| `COOKIE_CLOUD_UUID` | UUID |
| `COOKIE_CLOUD_PASSWORD` | 加密密码 |

**异常：** 缺少任何环境变量时抛出 `Error`。

```typescript
// 先设置环境变量：
// COOKIE_CLOUD_SERVER=https://cookie.example.com
// COOKIE_CLOUD_UUID=my-uuid
// COOKIE_CLOUD_PASSWORD=my-password

const client = CookieCloudClient.fromEnv();
```

---

### `client.getCookies(options?)`

从 CookieCloud 服务器获取加密 Cookie，解密后返回解析的 Cookie 对象数组。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `options` | `GetCookiesOptions` | 否 | 可选过滤条件 |
| `options.domain` | `string` | 否 | 按域名后缀过滤（当前实现通常可匹配主域名和子域名） |

**返回值：** `Promise<Cookie[]>`

**异常：**
- `"CookieCloud request failed: {status} {statusText}"` — HTTP 请求失败
- `"CookieCloud response missing encrypted data"` — 服务器返回格式异常
- 解密或 JSON 解析失败（密码错误或数据损坏）

```typescript
// 获取所有 Cookie
const allCookies = await client.getCookies();

// 按域名后缀过滤（通常匹配 .example.com 和 sub.example.com）
const filtered = await client.getCookies({ domain: 'example.com' });
```

## 类型定义

```typescript
import type { Cookie, CookieCloudConfig, GetCookiesOptions } from 'cookiecloud-client';
```

### `Cookie`

```typescript
type Cookie = {
  name: string;        // Cookie 名称
  value: string;       // Cookie 值
  domain: string;      // 域名（如 ".example.com"）
  path: string;        // 路径（如 "/"）
  expires: number;     // 过期时间戳（秒），未设置则为 -1
  httpOnly: boolean;   // HttpOnly 标志
  secure: boolean;     // Secure 标志
  sameSite: 'Lax' | 'Strict' | 'None';  // SameSite 属性（无法识别时默认为 'Lax'）
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
  domain?: string;  // 按域名过滤
};
```

## 集成示例

### 基本用法

```typescript
import { CookieCloudClient } from 'cookiecloud-client';

const client = new CookieCloudClient({
  server: 'https://cookie.example.com',
  uuid: 'my-uuid',
  password: 'my-password',
});

const cookies = await client.getCookies();
```

### 配合 Playwright — 注入浏览器 Cookie

```typescript
import { chromium } from 'playwright';
import { CookieCloudClient } from 'cookiecloud-client';

const client = CookieCloudClient.fromEnv();
const cookies = await client.getCookies({ domain: 'example.com' });

const browser = await chromium.launch();
const context = await browser.newContext();

// 将 Cookie 注入浏览器上下文
await context.addCookies(cookies);

const page = await context.newPage();
await page.goto('https://example.com/dashboard');
// 页面加载时已带有认证 Cookie
```

### 配合 HTTP 请求 — 添加 Cookie 请求头

```typescript
import { CookieCloudClient } from 'cookiecloud-client';

const client = CookieCloudClient.fromEnv();
const cookies = await client.getCookies({ domain: 'api.example.com' });

// 构建 Cookie 请求头字符串
const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');

const response = await fetch('https://api.example.com/data', {
  headers: { Cookie: cookieHeader },
});
```

### 轮询刷新 Cookie

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
      // 失败时重试
    }
  }
  throw new Error('等待 Cookie 刷新超时');
}
```

### 错误处理

```typescript
import { CookieCloudClient } from 'cookiecloud-client';

try {
  const client = CookieCloudClient.fromEnv();
  const cookies = await client.getCookies();
  console.log(`获取到 ${cookies.length} 个 Cookie`);
} catch (error) {
  if (error instanceof Error) {
    if (error.message.includes('Missing environment variables')) {
      console.error('请配置 COOKIE_CLOUD_SERVER、COOKIE_CLOUD_UUID、COOKIE_CLOUD_PASSWORD');
    } else if (error.message.includes('request failed')) {
      console.error('CookieCloud 服务器不可达或返回错误');
    } else if (error.message.includes('missing encrypted data')) {
      console.error('服务器响应缺少 encrypted 字段 — 请检查 UUID、服务端接口和响应格式');
    } else {
      console.error('解密失败 — 请检查密码:', error.message);
    }
  }
}
```

## 常见问题

**Q: CookieCloud 使用什么加密方式？**
A: 取 `MD5(uuid + "-" + password)` 十六进制字符串的前 16 位作为 passphrase。当加密数据包含 OpenSSL `Salted__` 前缀时，使用 AES-256-CBC + EVP_BytesToKey（MD5）从 passphrase 和 salt 派生 32 字节密钥和 16 字节 IV；无盐前缀时回退到 AES-128-CBC（passphrase 直接作为密钥，IV 全零）。

**Q: 可以在浏览器中使用吗？**
A: 不可以。本包使用 Node.js `crypto` 模块，仅支持服务端/CLI 使用。

**Q: 支持哪些 Node.js 版本？**
A: Node.js 18 及以上（需要原生 `fetch` 支持）。

**Q: 域名过滤如何工作？**
A: 当前实现使用双向后缀匹配。`getCookies({ domain: 'example.com' })` 通常会匹配 `.example.com`、`sub.example.com` 这类域名；但也可能匹配 `fakeexample.com` 这类共享相同后缀、却不是子域名的域名。

## 许可证

MIT
