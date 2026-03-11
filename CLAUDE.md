# CookieCloud Client

## 项目概述
CookieCloud 的 Node.js 客户端库，用于从 CookieCloud 服务器获取并解密浏览器同步的 Cookie。

## 技术栈
- TypeScript + Node.js (>=18)
- 零外部依赖，使用 Node.js 内置 `crypto` 模块
- 构建工具: tsup (同时输出 ESM + CJS)
- 测试: vitest + @vitest/coverage-v8
- 类型检查: tsc --noEmit

## 项目结构
- `src/index.ts` — 主模块，包含 `CookieCloudClient` 类和类型导出
- `src/__tests__/index.test.ts` — 测试文件
- `dist/` — 构建产物

## 常用命令
- `pnpm build` — 构建
- `pnpm test` — 运行测试
- `pnpm typecheck` — 类型检查
- `pnpm check` — 类型检查 + 测试覆盖率 + 构建（发布前完整检查）

## 加密方式
密码派生：取 `MD5(uuid + "-" + password)` 的前 16 个十六进制字符作为 passphrase。有 `Salted__` 前缀时使用 AES-256-CBC + EVP_BytesToKey 派生 key/IV；无盐前缀时回退到 AES-128-CBC（passphrase 直接作为 key，IV 全零）。
