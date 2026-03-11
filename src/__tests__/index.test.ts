import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createHash, createCipheriv, randomBytes } from 'node:crypto';
import { CookieCloudClient } from '../index.js';

// Helper: encrypt data the same way CookieCloud does (OpenSSL compatible)
function encryptForTest(data: string, uuid: string, password: string): string {
  const passKey = createHash('md5').update(`${uuid}-${password}`).digest().subarray(0, 16);
  const salt = randomBytes(8);

  // EVP_BytesToKey
  const totalLen = 32; // 16 key + 16 iv
  const result: Buffer[] = [];
  let resultLen = 0;
  let prev = Buffer.alloc(0);
  while (resultLen < totalLen) {
    const hash = createHash('md5');
    if (prev.length > 0) hash.update(prev);
    hash.update(passKey);
    hash.update(salt);
    prev = hash.digest();
    result.push(prev);
    resultLen += prev.length;
  }
  const combined = Buffer.concat(result);
  const derivedKey = combined.subarray(0, 16);
  const iv = combined.subarray(16, 32);

  const cipher = createCipheriv('aes-128-cbc', derivedKey, iv);
  const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
  const output = Buffer.concat([Buffer.from('Salted__'), salt, encrypted]);
  return output.toString('base64');
}

const TEST_UUID = 'test-uuid-123';
const TEST_PASSWORD = 'test-password-456';
const TEST_SERVER = 'https://cookie.example.com';

const SAMPLE_COOKIE_DATA = {
  cookie_data: {
    '.example.com': [
      {
        name: 'session',
        value: 'abc123',
        domain: '.example.com',
        path: '/',
        expirationDate: 1700000000,
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
    ],
    '.other.com': [
      {
        name: 'token',
        value: 'xyz789',
        domain: '.other.com',
        path: '/',
        expires: 1700000000,
        httpOnly: false,
        secure: false,
        sameSite: 'no_restriction',
      },
    ],
  },
};

describe('CookieCloudClient', () => {
  describe('constructor', () => {
    it('creates client with valid config', () => {
      const client = new CookieCloudClient({
        server: TEST_SERVER,
        uuid: TEST_UUID,
        password: TEST_PASSWORD,
      });
      expect(client).toBeInstanceOf(CookieCloudClient);
    });

    it('strips trailing slashes from server', () => {
      const client = new CookieCloudClient({
        server: 'https://cookie.example.com///',
        uuid: TEST_UUID,
        password: TEST_PASSWORD,
      });
      expect(client).toBeInstanceOf(CookieCloudClient);
    });

    it('throws on missing config fields', () => {
      expect(() => new CookieCloudClient({ server: '', uuid: TEST_UUID, password: TEST_PASSWORD }))
        .toThrow('requires server, uuid, and password');
      expect(() => new CookieCloudClient({ server: TEST_SERVER, uuid: '', password: TEST_PASSWORD }))
        .toThrow('requires server, uuid, and password');
      expect(() => new CookieCloudClient({ server: TEST_SERVER, uuid: TEST_UUID, password: '' }))
        .toThrow('requires server, uuid, and password');
    });
  });

  describe('fromEnv', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('creates client from environment variables', () => {
      process.env.COOKIE_CLOUD_SERVER = TEST_SERVER;
      process.env.COOKIE_CLOUD_UUID = TEST_UUID;
      process.env.COOKIE_CLOUD_PASSWORD = TEST_PASSWORD;

      const client = CookieCloudClient.fromEnv();
      expect(client).toBeInstanceOf(CookieCloudClient);
    });

    it('throws when environment variables are missing', () => {
      delete process.env.COOKIE_CLOUD_SERVER;
      delete process.env.COOKIE_CLOUD_UUID;
      delete process.env.COOKIE_CLOUD_PASSWORD;

      expect(() => CookieCloudClient.fromEnv()).toThrow('Missing environment variables');
    });
  });

  describe('getCookies', () => {
    let client: CookieCloudClient;

    beforeEach(() => {
      client = new CookieCloudClient({
        server: TEST_SERVER,
        uuid: TEST_UUID,
        password: TEST_PASSWORD,
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('fetches and decrypts cookies', async () => {
      const encrypted = encryptForTest(JSON.stringify(SAMPLE_COOKIE_DATA), TEST_UUID, TEST_PASSWORD);

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ encrypted }), { status: 200 }),
      );

      const cookies = await client.getCookies();
      expect(cookies).toHaveLength(2);
      expect(cookies[0]).toMatchObject({
        name: 'session',
        value: 'abc123',
        domain: '.example.com',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      });
      expect(cookies[1]).toMatchObject({
        name: 'token',
        value: 'xyz789',
        domain: '.other.com',
        sameSite: 'None',
      });
    });

    it('filters cookies by domain', async () => {
      const encrypted = encryptForTest(JSON.stringify(SAMPLE_COOKIE_DATA), TEST_UUID, TEST_PASSWORD);

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ encrypted }), { status: 200 }),
      );

      const cookies = await client.getCookies({ domain: 'example.com' });
      expect(cookies).toHaveLength(1);
      expect(cookies[0].name).toBe('session');
    });

    it('throws on HTTP error', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Not Found', { status: 404, statusText: 'Not Found' }),
      );

      await expect(client.getCookies()).rejects.toThrow('request failed: 404');
    });

    it('throws when response has no encrypted field', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({}), { status: 200 }),
      );

      await expect(client.getCookies()).rejects.toThrow('missing encrypted data');
    });

    it('handles empty cookie_data', async () => {
      const encrypted = encryptForTest(JSON.stringify({ cookie_data: {} }), TEST_UUID, TEST_PASSWORD);

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ encrypted }), { status: 200 }),
      );

      const cookies = await client.getCookies();
      expect(cookies).toHaveLength(0);
    });

    it('parses sameSite variants correctly', async () => {
      const data = {
        cookie_data: {
          '.test.com': [
            { name: 'a', value: '1', domain: '.test.com', sameSite: 'strict' },
            { name: 'b', value: '2', domain: '.test.com', sameSite: 'none' },
            { name: 'c', value: '3', domain: '.test.com', sameSite: 'no_restriction' },
            { name: 'd', value: '4', domain: '.test.com', sameSite: 'lax' },
            { name: 'e', value: '5', domain: '.test.com', sameSite: '' },
          ],
        },
      };
      const encrypted = encryptForTest(JSON.stringify(data), TEST_UUID, TEST_PASSWORD);

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ encrypted }), { status: 200 }),
      );

      const cookies = await client.getCookies();
      expect(cookies.map((c) => c.sameSite)).toEqual(['Strict', 'None', 'None', 'Lax', 'Lax']);
    });
  });
});
