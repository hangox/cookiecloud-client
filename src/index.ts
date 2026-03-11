import { createHash, createDecipheriv } from 'node:crypto';

export type CookieCloudConfig = {
  server: string;
  uuid: string;
  password: string;
};

export type Cookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Lax' | 'Strict' | 'None';
};

export type GetCookiesOptions = {
  domain?: string;
};

export class CookieCloudClient {
  private readonly config: CookieCloudConfig;

  constructor(config: CookieCloudConfig) {
    if (!config.server || !config.uuid || !config.password) {
      throw new Error('CookieCloud config requires server, uuid, and password');
    }
    this.config = {
      ...config,
      server: config.server.replace(/\/+$/, ''),
    };
  }

  static fromEnv(): CookieCloudClient {
    const server = process.env.COOKIE_CLOUD_SERVER;
    const uuid = process.env.COOKIE_CLOUD_UUID;
    const password = process.env.COOKIE_CLOUD_PASSWORD;

    if (!server || !uuid || !password) {
      throw new Error(
        'Missing environment variables: COOKIE_CLOUD_SERVER, COOKIE_CLOUD_UUID, COOKIE_CLOUD_PASSWORD',
      );
    }

    return new CookieCloudClient({ server, uuid, password });
  }

  async getCookies(options?: GetCookiesOptions): Promise<Cookie[]> {
    const { server, uuid, password } = this.config;

    const response = await fetch(`${server}/get/${uuid}`);
    if (!response.ok) {
      throw new Error(`CookieCloud request failed: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as { encrypted?: string };
    if (!payload.encrypted) {
      throw new Error('CookieCloud response missing encrypted data');
    }

    const decrypted = decrypt(payload.encrypted, uuid, password);
    const cookieData = JSON.parse(decrypted) as {
      cookie_data?: Record<string, Array<Record<string, unknown>>>;
    };

    const cookies = parseCookies(cookieData.cookie_data || {});

    if (options?.domain) {
      return filterByDomain(cookies, options.domain);
    }

    return cookies;
  }
}

function decrypt(encrypted: string, uuid: string, password: string): string {
  const key = createHash('md5')
    .update(`${uuid}-${password}`)
    .digest()
    .subarray(0, 16);

  // crypto-js AES.encrypt 默认使用 OpenSSL 格式:
  // Base64 decode → "Salted__" (8 bytes) + salt (8 bytes) + ciphertext
  const data = Buffer.from(encrypted, 'base64');

  const salted = data.subarray(0, 8).toString('utf8');
  if (salted !== 'Salted__') {
    // 无 salt 前缀，直接作为密文处理（key 作为 key，前 16 字节作为 IV）
    const iv = Buffer.alloc(16, 0);
    const decipher = createDecipheriv('aes-128-cbc', key, iv);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }

  // OpenSSL KDF: 从 password + salt 派生 key 和 iv
  const salt = data.subarray(8, 16);
  const ciphertext = data.subarray(16);

  const { derivedKey, iv } = evpBytesToKey(key, salt, 16, 16);
  const decipher = createDecipheriv('aes-128-cbc', derivedKey, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * OpenSSL EVP_BytesToKey KDF (MD5-based)
 * crypto-js uses this internally for password-based encryption
 */
function evpBytesToKey(
  password: Buffer,
  salt: Buffer,
  keyLen: number,
  ivLen: number,
): { derivedKey: Buffer; iv: Buffer } {
  const totalLen = keyLen + ivLen;
  const result: Buffer[] = [];
  let resultLen = 0;
  let prev = Buffer.alloc(0);

  while (resultLen < totalLen) {
    const hash = createHash('md5');
    if (prev.length > 0) hash.update(prev);
    hash.update(password);
    hash.update(salt);
    prev = hash.digest();
    result.push(prev);
    resultLen += prev.length;
  }

  const combined = Buffer.concat(result);
  return {
    derivedKey: combined.subarray(0, keyLen),
    iv: combined.subarray(keyLen, keyLen + ivLen),
  };
}

function parseSameSite(raw: unknown): Cookie['sameSite'] {
  const value = String(raw || '').toLowerCase();
  if (value === 'strict') return 'Strict';
  if (value === 'none' || value === 'no_restriction') return 'None';
  return 'Lax';
}

function parseCookies(cookieData: Record<string, Array<Record<string, unknown>>>): Cookie[] {
  const cookies: Cookie[] = [];
  for (const domainCookies of Object.values(cookieData)) {
    for (const cookie of domainCookies) {
      cookies.push({
        name: String(cookie.name || ''),
        value: String(cookie.value || ''),
        domain: String(cookie.domain || ''),
        path: String(cookie.path || '/'),
        expires: Number(cookie.expires || cookie.expirationDate || -1),
        httpOnly: Boolean(cookie.httpOnly),
        secure: Boolean(cookie.secure),
        sameSite: parseSameSite(cookie.sameSite),
      });
    }
  }
  return cookies;
}

function filterByDomain(cookies: Cookie[], domain: string): Cookie[] {
  return cookies.filter((c) => {
    const cookieDomain = c.domain.replace(/^\./, '');
    return domain.endsWith(cookieDomain) || cookieDomain.endsWith(domain);
  });
}
