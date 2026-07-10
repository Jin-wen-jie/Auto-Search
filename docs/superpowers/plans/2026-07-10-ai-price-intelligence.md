# AI 商品公开链接比价后台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个公网部署、唯一管理员登录的 AI 商品公开链接调查后台，自动发现并人工审核 X/Telegram 商品链接，再按同规格分别生成价格榜和货源榜。

**Architecture:** 使用 pnpm TypeScript 单仓库。Next.js 提供管理后台与服务端接口，Node worker 通过 pg-boss 执行持久任务，独立 Fastify validator 在无数据库/平台凭据环境中验证公网商品页，PostgreSQL 保存业务、审核和任务事实。

**Tech Stack:** Node.js 24、pnpm、TypeScript 7、Next.js 16、React 19、Drizzle ORM、PostgreSQL 17、pg-boss、Fastify、Playwright、GramJS、Vitest、Playwright Test、Docker Compose。

---

## 文件结构

```text
apps/
  web/
    app/
      (auth)/login/page.tsx
      (admin)/layout.tsx
      (admin)/dashboard/page.tsx
      (admin)/candidates/page.tsx
      (admin)/merchants/page.tsx
      (admin)/specs/page.tsx
      (admin)/jobs/page.tsx
      (admin)/settings/page.tsx
      api/auth/login/route.ts
      api/auth/logout/route.ts
      api/candidates/route.ts
      api/candidates/[id]/review/route.ts
      globals.css
      layout.tsx
    components/
      admin-shell.tsx
      data-table.tsx
      external-link.tsx
      status-badge.tsx
    lib/
      auth.ts
      csrf.ts
      repositories.ts
      view-models.ts
    proxy.ts
  worker/
    src/
      connectors/x.ts
      connectors/telegram.ts
      jobs/discover.ts
      jobs/revalidate.ts
      lifecycle.ts
      queue.ts
      validator-client.ts
      index.ts
  validator/
    src/
      extract-product.ts
      fetch-page.ts
      safe-url.ts
      server.ts
packages/
  db/
    src/schema.ts
    src/client.ts
    src/bootstrap-admin.ts
    drizzle.config.ts
  domain/
    src/types.ts
    src/comparison-key.ts
    src/price-ranking.ts
    src/supply-ranking.ts
    src/index.ts
  config/
    src/env.ts
tests/
  fixtures/x-recent-search.json
  fixtures/telegram-search.json
  fixtures/product-page.html
  e2e/admin-flow.spec.ts
docker-compose.yml
.env.example
package.json
pnpm-workspace.yaml
tsconfig.base.json
vitest.config.ts
```

职责边界：`domain` 只包含纯函数和类型；`db` 只包含持久化结构与启动引导；`validator` 只接受 URL 并返回结构化结果；`worker` 负责连接器和生命周期编排；`web` 只处理认证、人工审核和查询展示。

### Task 1: 初始化单仓库与开发基线

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`
- Create: `.env.example`
- Modify: `.gitignore`

- [ ] **Step 1: 写工作区清单测试**

创建 `tests/workspace.test.ts`：

```ts
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("workspace", () => {
  it("declares every runtime package", () => {
    expect(existsSync("pnpm-workspace.yaml")).toBe(true);
    const workspace = readFileSync("pnpm-workspace.yaml", "utf8");
    expect(workspace).toContain("apps/*");
    expect(workspace).toContain("packages/*");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run tests/workspace.test.ts`

Expected: FAIL，原因是根目录尚无 `package.json` 或 Vitest 依赖。

- [ ] **Step 3: 创建根配置并安装固定版本依赖**

`package.json`：

```json
{
  "name": "ai-price-intelligence",
  "private": true,
  "packageManager": "pnpm@10.28.2",
  "scripts": {
    "build": "pnpm -r build",
    "dev": "pnpm --parallel --filter @compare/web --filter @compare/worker --filter @compare/validator dev",
    "lint": "pnpm -r lint",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "typecheck": "pnpm -r typecheck",
    "db:generate": "pnpm --filter @compare/db db:generate",
    "db:migrate": "pnpm --filter @compare/db db:migrate"
  },
  "devDependencies": {
    "@playwright/test": "1.61.1",
    "tsx": "4.20.6",
    "typescript": "7.0.2",
    "vitest": "4.1.10"
  }
}
```

`pnpm-workspace.yaml`：

```yaml
packages:
  - apps/*
  - packages/*
```

执行 `pnpm install` 生成 `pnpm-lock.yaml`，并在 `.env.example` 中声明数据库、管理员、validator、X、Telegram 和会话密钥变量，所有值使用无效示例值。

- [ ] **Step 4: 运行基线测试**

Run: `pnpm test -- tests/workspace.test.ts`

Expected: 1 test passed。

- [ ] **Step 5: 提交**

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json vitest.config.ts .env.example .gitignore tests/workspace.test.ts
git commit -m "chore: initialize TypeScript workspace"
```

### Task 2: 实现规格键、价格榜与货源榜纯函数

**Files:**
- Create: `packages/domain/package.json`
- Create: `packages/domain/src/types.ts`
- Create: `packages/domain/src/comparison-key.ts`
- Create: `packages/domain/src/price-ranking.ts`
- Create: `packages/domain/src/supply-ranking.ts`
- Create: `packages/domain/src/index.ts`
- Create: `packages/domain/src/domain.test.ts`

- [ ] **Step 1: 写失败测试覆盖不混排、目标数量和货源分层**

```ts
import { describe, expect, it } from "vitest";
import { buildComparisonKey, rankPrices, scoreSupply } from "./index";

describe("domain rankings", () => {
  it("keeps shared and exclusive products in separate groups", () => {
    const base = { provider: "OpenAI", productLine: "ChatGPT", plan: "Plus", delivery: "ACCOUNT", ownership: "TRANSFERRED", region: "NONE", qualification: "NONE", validity: "30d", commitment: "30d", quota: "NOT_APPLICABLE" } as const;
    expect(buildComparisonKey({ ...base, accessMode: "EXCLUSIVE" })).not.toBe(buildComparisonKey({ ...base, accessMode: "SHARED" }));
  });

  it("calculates the real spend for a target quantity", () => {
    const [row] = rankPrices([{ id: "a", packagePriceCny: "17.00", bundleQty: 10, minBundleCount: 1 }], 15);
    expect(row).toMatchObject({ requiredBundles: 2, actualQty: 20, totalCny: "34.00", unitCny: "1.70" });
  });

  it("always ranks explicit inventory above inferred availability", () => {
    const explicit = scoreSupply({ kind: "EXPLICIT", quantity: 1, referenceStock: 10, ageHours: 2, consistentChecks: 1, successfulChecks30d: 1, totalChecks30d: 1, siblingListings: 1 });
    const inferred = scoreSupply({ kind: "TEXT_IN_STOCK", ageHours: 0, consistentChecks: 3, successfulChecks30d: 30, totalChecks30d: 30, siblingListings: 20 });
    expect(explicit.score).toBeGreaterThan(inferred.score);
    expect(inferred.confidence).toBeLessThanOrEqual(69);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run packages/domain/src/domain.test.ts`

Expected: FAIL with module or export not found。

- [ ] **Step 3: 实现确定性领域函数**

`price-ranking.ts` 使用 `decimal.js`，先计算 `requiredBundles = max(minBundleCount, ceil(targetQty / bundleQty))`，再计算实际数量、总价和单位价；始终按单位价 Decimal 升序，完全同价时按验证时间、置信度、稳定率和 ID 排序。

`supply-ranking.ts` 实现规格公式：明确库存为 `80 + 20 * log1p(quantity) / log1p(referenceStock)`；推断库存为证据基数加新鲜度、30 日成功率和商品广度；置信度按证据上限、连续一致系数和 24 小时半衰期计算。所有结果保留两位小数，最后使用稳定 ID 破除并列。

- [ ] **Step 4: 运行领域测试与类型检查**

Run: `pnpm exec vitest run packages/domain/src/domain.test.ts`

Expected: 3 tests passed。

Run: `pnpm --filter @compare/domain typecheck`

Expected: exit 0。

- [ ] **Step 5: 提交**

```bash
git add packages/domain
git commit -m "feat: add deterministic comparison rankings"
```

### Task 3: 建立数据库模型、迁移与唯一管理员不变量

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/drizzle.config.ts`
- Create: `packages/db/src/schema.ts`
- Create: `packages/db/src/client.ts`
- Create: `packages/db/src/bootstrap-admin.ts`
- Create: `packages/db/src/bootstrap-admin.test.ts`
- Create: `packages/db/migrations/0000_initial.sql`
- Create: `docker-compose.yml`

- [ ] **Step 1: 写唯一管理员引导失败测试**

```ts
import { describe, expect, it, vi } from "vitest";
import { bootstrapAdmin } from "./bootstrap-admin";

describe("bootstrapAdmin", () => {
  it("creates id 1 only when the table is empty", async () => {
    const repo = { find: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue(undefined) };
    await bootstrapAdmin(repo, { username: "owner", password: "one-time-password" });
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ id: 1, username: "owner", forcePasswordChange: true }));
  });

  it("never overwrites an existing password", async () => {
    const repo = { find: vi.fn().mockResolvedValue({ id: 1 }), create: vi.fn() };
    await bootstrapAdmin(repo, { username: "owner", password: "replacement" });
    expect(repo.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run packages/db/src/bootstrap-admin.test.ts`

Expected: FAIL with `bootstrap-admin` not found。

- [ ] **Step 3: 定义完整 Drizzle schema**

`schema.ts` 创建 `admin_accounts`、`admin_sessions`、`watch_sources`、`discovery_events`、`discovery_candidates`、`merchants`、`product_specs`、`listings`、`listing_observations`、`link_checks`、`collection_runs`、`audit_events`。`admin_accounts.id` 使用 `smallint primary key check (id = 1)`；候选 `discovery_event_id` 与商家 `homepage_url` 可空；金额使用 `numeric`；重定向链和抽取结果使用 `jsonb`。

候选状态枚举固定为 `DISCOVERED | VALIDATING | RETRY_WAIT | REVIEW_REQUIRED | APPROVED | REJECTED`；Listing 状态固定为 `ACTIVE | OUT_OF_STOCK | INVALID | RECHECK | NEEDS_REVIEW`。

- [ ] **Step 4: 实现引导、生成并执行迁移**

`bootstrapAdmin` 使用 Argon2id 哈希一次性初始密码；已有 `id=1` 时直接返回。运行：

```bash
docker compose up -d postgres
pnpm db:generate
pnpm db:migrate
```

Expected: PostgreSQL healthy，迁移成功且所有表存在。

- [ ] **Step 5: 运行数据库测试**

Run: `pnpm exec vitest run packages/db/src/bootstrap-admin.test.ts`

Expected: 2 tests passed。

- [ ] **Step 6: 提交**

```bash
git add packages/db docker-compose.yml
git commit -m "feat: add persistence and singleton admin schema"
```

### Task 4: 实现隔离 URL validator 与商品字段抽取

**Files:**
- Create: `apps/validator/package.json`
- Create: `apps/validator/src/safe-url.ts`
- Create: `apps/validator/src/fetch-page.ts`
- Create: `apps/validator/src/extract-product.ts`
- Create: `apps/validator/src/server.ts`
- Create: `apps/validator/src/validator.test.ts`
- Create: `tests/fixtures/product-page.html`

- [ ] **Step 1: 写 SSRF、重定向和商品页失败测试**

```ts
import { describe, expect, it } from "vitest";
import { assertPublicUrl } from "./safe-url";
import { extractProduct } from "./extract-product";

describe("validator", () => {
  it("blocks private destinations", async () => {
    await expect(assertPublicUrl("http://example.test/product", async () => ["127.0.0.1"])).rejects.toThrow("PRIVATE_ADDRESS");
  });

  it("extracts a normal public product", () => {
    const html = '<script type="application/ld+json">{"@type":"Product","name":"GPT Plus 30 days","offers":{"@type":"Offer","price":"19.99","priceCurrency":"USD","availability":"https://schema.org/InStock"}}</script>';
    expect(extractProduct(html, "https://shop.example/product")).toMatchObject({ title: "GPT Plus 30 days", price: "19.99", currency: "USD", availability: "IN_STOCK" });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run apps/validator/src/validator.test.ts`

Expected: FAIL with missing modules。

- [ ] **Step 3: 实现安全 URL 解析与受限抓取**

`assertPublicUrl` 只允许 HTTP/HTTPS、无用户名密码、80/443、非 IP 字面量；每次 DNS 和每跳重定向用 `ipaddr.js` 阻断 loopback、private、linkLocal、carrierGradeNat、multicast、reserved 与 IPv4-mapped IPv6。`fetchPage` 手工跟随最多 5 跳，连接 5 秒、总计 15 秒、HTML 解压后最多 2 MB，拒绝非 HTML 与下载响应。

- [ ] **Step 4: 实现 JSON-LD 优先的抽取器和 Fastify 接口**

`extractProduct` 依次解析 JSON-LD `Product/Offer`、OpenGraph、可见 DOM；输出标题、价格、币种、库存数量或文字、购买动作、页面指纹和字段置信度。`POST /validate` 使用 Zod 校验 `{ url }`，返回原始 URL、重定向链、最终 URL、HTTP 状态、判定和抽取结果；接口只接受 `VALIDATOR_SHARED_TOKEN` Bearer 鉴权。

- [ ] **Step 5: 运行安全测试与类型检查**

Run: `pnpm exec vitest run apps/validator/src/validator.test.ts`

Expected: private URL、重定向至私网、软 404、登录墙、验证码、超大响应测试全部通过。

Run: `pnpm --filter @compare/validator typecheck`

Expected: exit 0。

- [ ] **Step 6: 提交**

```bash
git add apps/validator tests/fixtures/product-page.html
git commit -m "feat: add isolated public product validator"
```

### Task 5: 实现唯一管理员认证、会话与 CSRF

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/app/layout.tsx`
- Create: `apps/web/app/globals.css`
- Create: `apps/web/app/(auth)/login/page.tsx`
- Create: `apps/web/app/api/auth/login/route.ts`
- Create: `apps/web/app/api/auth/logout/route.ts`
- Create: `apps/web/lib/auth.ts`
- Create: `apps/web/lib/csrf.ts`
- Create: `apps/web/proxy.ts`
- Create: `apps/web/lib/auth.test.ts`

- [ ] **Step 1: 写登录锁定、会话撤销和 CSRF 失败测试**

```ts
import { describe, expect, it } from "vitest";
import { assertCsrf, loginPolicy } from "./auth";

describe("admin auth", () => {
  it("locks after five failed attempts", () => {
    expect(loginPolicy({ failedAttempts: 5, lockedUntil: null }, new Date("2026-07-10T00:00:00Z"))).toMatchObject({ allowed: false });
  });

  it("rejects mismatched csrf tokens", () => {
    expect(() => assertCsrf("cookie-token", "form-token")).toThrow("CSRF_MISMATCH");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run apps/web/lib/auth.test.ts`

Expected: FAIL with missing exports。

- [ ] **Step 3: 实现认证与会话**

登录使用 Argon2id，连续 5 次错误锁定 15 分钟。会话令牌用 `crypto.randomBytes(32)` 生成，只在数据库保存 SHA-256 哈希；Cookie 名 `__Host-admin_session`，生产环境设置 `HttpOnly; Secure; SameSite=Strict; Path=/`。改密递增 `sessionVersion` 并撤销全部旧会话。

CSRF 使用同步器令牌：会话记录保存哈希，页面表单写入原始令牌，状态变更接口同时检查令牌和同源 `Origin`。所有后台页面和 API 在服务端调用 `requireAdminSession`，`proxy.ts` 只做快速路径重定向，不能作为唯一鉴权层。

- [ ] **Step 4: 实现登录页和路由**

登录页只显示用户名、密码和登录按钮，不提供注册或第二管理员入口。首次登录时跳转 `/settings?forcePasswordChange=1`，完成改密前其他后台页面拒绝访问。

- [ ] **Step 5: 运行认证测试**

Run: `pnpm exec vitest run apps/web/lib/auth.test.ts`

Expected: 登录锁定、Cookie 属性、CSRF 和会话版本测试全部通过。

- [ ] **Step 6: 提交**

```bash
git add apps/web
git commit -m "feat: add singleton admin authentication"
```

### Task 6: 构建后台布局、榜单页面与查询模型

**Files:**
- Create: `apps/web/app/(admin)/layout.tsx`
- Create: `apps/web/app/(admin)/dashboard/page.tsx`
- Create: `apps/web/components/admin-shell.tsx`
- Create: `apps/web/components/data-table.tsx`
- Create: `apps/web/components/external-link.tsx`
- Create: `apps/web/components/status-badge.tsx`
- Create: `apps/web/lib/view-models.ts`
- Create: `apps/web/lib/view-models.test.ts`

- [ ] **Step 1: 写榜单过滤失败测试**

```ts
import { describe, expect, it } from "vitest";
import { eligibleForRanking } from "./view-models";

describe("eligibleForRanking", () => {
  it.each(["RECHECK", "INVALID", "OUT_OF_STOCK", "NEEDS_REVIEW"])("excludes %s listings", (status) => {
    expect(eligibleForRanking({ status, approved: true, lastVerifiedAt: new Date() })).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run apps/web/lib/view-models.test.ts`

Expected: FAIL with missing function。

- [ ] **Step 3: 实现数据库读模型和榜单筛选**

只查询 `APPROVED + ACTIVE + lastVerifiedAt >= now - 24h` 的 Listing。按 `comparisonKey`、`unitBasis`、目标购买数量调用 domain 排名函数。返回每行的商品规格、商家、原价、最低总支出、单位价、货源分、证据类型、置信度、最后验证和三个可空链接。

- [ ] **Step 4: 实现安静、密集的运营后台 UI**

左侧导航包含总览、候选审核、商家档案、商品规格、采集任务、系统设置。主页面使用“价格榜 / 货源榜 / 最近发现”标签页和固定表格；不得使用瀑布流。外链组件固定 `target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"`，并使用 Lucide `ExternalLink` 图标。

- [ ] **Step 5: 运行组件测试和生产构建**

Run: `pnpm exec vitest run apps/web/lib/view-models.test.ts`

Expected: 所有非 ACTIVE 状态和超过 24 小时条目均被排除。

Run: `pnpm --filter @compare/web build`

Expected: Next.js production build succeeds。

- [ ] **Step 6: 提交**

```bash
git add apps/web
git commit -m "feat: add comparison dashboard"
```

### Task 7: 实现手工补链、候选验证与人工审核

**Files:**
- Create: `apps/web/app/(admin)/candidates/page.tsx`
- Create: `apps/web/app/api/candidates/route.ts`
- Create: `apps/web/app/api/candidates/[id]/review/route.ts`
- Create: `apps/web/lib/repositories.ts`
- Create: `apps/web/lib/candidates.test.ts`

- [ ] **Step 1: 写手工来源与审核状态失败测试**

```ts
import { describe, expect, it } from "vitest";
import { createManualCandidate, approveCandidate } from "./repositories";

describe("candidate workflow", () => {
  it("creates manual candidates without a fake discovery event", async () => {
    const row = await createManualCandidate({ productUrl: "https://shop.example/p/1" });
    expect(row).toMatchObject({ sourceType: "manual", discoveryEventId: null, status: "DISCOVERED" });
  });

  it("requires a complete normalized spec before approval", async () => {
    await expect(approveCandidate({ id: "candidate-1", comparisonKey: null })).rejects.toThrow("SPEC_INCOMPLETE");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run apps/web/lib/candidates.test.ts`

Expected: FAIL with missing repository functions。

- [ ] **Step 3: 实现候选 API 与审计事务**

`POST /api/candidates` 只接受 HTTP/HTTPS 商品 URL，创建 `source_type=manual` 且 `discovery_event_id=null`，去重后投递验证任务。审核接口在一个数据库事务中更新候选、商家、规格和 Listing，并写入 `AuditEvent`；不完整规格只能保持 `REVIEW_REQUIRED`。

- [ ] **Step 4: 实现候选页面**

列表显示抽取标题、价格、库存宣称、验证错误、商品页、可空来源帖子和可空店铺主页。操作包含通过、驳回、合并商家、重新抓取和规格映射；远端 HTML 不能渲染，只显示转义文本。

- [ ] **Step 5: 运行测试与构建**

Run: `pnpm exec vitest run apps/web/lib/candidates.test.ts`

Expected: 手工来源、URL 去重、规格门槛和审计事务测试通过。

- [ ] **Step 6: 提交**

```bash
git add apps/web
git commit -m "feat: add reviewed candidate workflow"
```

### Task 8: 实现 worker、pg-boss 调度与链接生命周期

**Files:**
- Create: `apps/worker/package.json`
- Create: `apps/worker/src/queue.ts`
- Create: `apps/worker/src/validator-client.ts`
- Create: `apps/worker/src/lifecycle.ts`
- Create: `apps/worker/src/jobs/revalidate.ts`
- Create: `apps/worker/src/index.ts`
- Create: `apps/worker/src/lifecycle.test.ts`

- [ ] **Step 1: 写生命周期失败测试**

```ts
import { describe, expect, it } from "vitest";
import { transitionListing } from "./lifecycle";

describe("listing lifecycle", () => {
  it("removes 404 pages immediately", () => {
    expect(transitionListing({ status: "ACTIVE", consecutiveFailures: 0 }, { kind: "HTTP_404" })).toMatchObject({ status: "INVALID", ranked: false });
  });

  it("keeps one transient failure until the 24 hour boundary", () => {
    expect(transitionListing({ status: "ACTIVE", consecutiveFailures: 0, lastSuccessAgeHours: 6 }, { kind: "TIMEOUT" })).toMatchObject({ status: "ACTIVE", consecutiveFailures: 1 });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run apps/worker/src/lifecycle.test.ts`

Expected: FAIL with missing lifecycle module。

- [ ] **Step 3: 实现队列和 validator 客户端**

pg-boss 队列名固定为 `discover-source`、`validate-candidate`、`revalidate-listing`、`refresh-fx`。validator 客户端发送 Bearer token，15 秒超时，记录完整错误类别但不记录敏感查询参数。

- [ ] **Step 4: 实现生命周期与默认调度**

来源发现每 30 分钟，ACTIVE Listing 每 6 小时复检，汇率每日刷新。404/410、软 404、登录墙和验证码立即下榜；401/403/robots 进入 RECHECK；超时/DNS/TLS/5xx 连续 3 次或最后成功超过 24 小时才下榜。只有同域名、同商品指纹的瞬时恢复可自动 ACTIVE。

- [ ] **Step 5: 运行 worker 测试**

Run: `pnpm exec vitest run apps/worker/src/lifecycle.test.ts`

Expected: 状态转换、幂等任务键和退避测试全部通过。

- [ ] **Step 6: 提交**

```bash
git add apps/worker
git commit -m "feat: add durable collection worker"
```

### Task 9: 实现 X 官方 Recent Search 连接器

**Files:**
- Create: `apps/worker/src/connectors/x.ts`
- Create: `apps/worker/src/connectors/x.test.ts`
- Create: `apps/worker/src/jobs/discover.ts`
- Create: `tests/fixtures/x-recent-search.json`

- [ ] **Step 1: 写夹具解析、游标和错误分类失败测试**

```ts
import { describe, expect, it } from "vitest";
import { parseXSearch, classifyXError } from "./x";

describe("X connector", () => {
  it("keeps expanded product links and the source post", () => {
    const rows = parseXSearch({ data: [{ id: "42", text: "GPT stock", entities: { urls: [{ expanded_url: "https://shop.example/p/1" }] } }], meta: { newest_id: "42" } });
    expect(rows[0]).toMatchObject({ sourceUrl: "https://x.com/i/web/status/42", productUrl: "https://shop.example/p/1", cursor: "42" });
  });

  it("disables auth failures instead of returning empty results", () => {
    expect(classifyXError(403)).toBe("AUTH_DISABLED");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run apps/worker/src/connectors/x.test.ts`

Expected: FAIL with missing connector。

- [ ] **Step 3: 实现官方 API 连接器**

调用 `/2/tweets/search/recent`，查询以 `has:links -is:retweet` 追加管理员关键词，使用 `since_id` 增量，优先读取 expanded URL。401/403 将 WatchSource 标为 `AUTH_DISABLED`，429 按 `Retry-After` 或速率响应头延后，5xx 指数退避；所有失败写 CollectionRun，不返回伪造空列表。

- [ ] **Step 4: 运行测试**

Run: `pnpm exec vitest run apps/worker/src/connectors/x.test.ts`

Expected: 夹具解析、去重、游标保存、401/403 和 429 测试通过。

- [ ] **Step 5: 提交**

```bash
git add apps/worker/src/connectors/x.ts apps/worker/src/connectors/x.test.ts apps/worker/src/jobs/discover.ts tests/fixtures/x-recent-search.json
git commit -m "feat: add official X discovery connector"
```

### Task 10: 实现 Telegram 公共内容连接器

**Files:**
- Create: `apps/worker/src/connectors/telegram.ts`
- Create: `apps/worker/src/connectors/telegram.test.ts`
- Create: `tests/fixtures/telegram-search.json`

- [ ] **Step 1: 写公共消息、种子频道和 FLOOD_WAIT 失败测试**

```ts
import { describe, expect, it } from "vitest";
import { parseTelegramMessage, classifyTelegramError } from "./telegram";

describe("Telegram connector", () => {
  it("builds public source and product URLs", () => {
    expect(parseTelegramMessage({ channel: "public_shop", id: 12, text: "GPT https://shop.example/p/1" })).toMatchObject({ sourceUrl: "https://t.me/public_shop/12", productUrl: "https://shop.example/p/1" });
  });

  it("honors the exact flood wait", () => {
    expect(classifyTelegramError({ errorMessage: "FLOOD_WAIT_37" })).toMatchObject({ kind: "RATE_LIMIT", retryAfterSeconds: 37 });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run apps/worker/src/connectors/telegram.test.ts`

Expected: FAIL with missing connector。

- [ ] **Step 3: 实现 MTProto 搜索和种子频道增量**

使用 GramJS `StringSession`、专用 `api_id/api_hash` 和 `Api.messages.SearchGlobal` 搜索公共内容；已知公共频道按最新 message ID 增量读取。只保存公共频道名、公共消息 ID、来源 URL、必要摘要和商品 URL。session 不写日志或数据库。

当 session 缺失时状态为 `NOT_CONFIGURED`；认证失败为 `AUTH_DISABLED`；`FLOOD_WAIT_X` 精确等待 X 秒。任何状态都必须在 Jobs 页面展示，不能表现为零结果。

- [ ] **Step 4: 运行测试**

Run: `pnpm exec vitest run apps/worker/src/connectors/telegram.test.ts`

Expected: 公共链接解析、游标、缺失 session、认证失败和 FLOOD_WAIT 测试通过。

- [ ] **Step 5: 提交**

```bash
git add apps/worker/src/connectors/telegram.ts apps/worker/src/connectors/telegram.test.ts tests/fixtures/telegram-search.json
git commit -m "feat: add Telegram public discovery connector"
```

### Task 11: 完成商家、规格、任务和设置页面

**Files:**
- Create: `apps/web/app/(admin)/merchants/page.tsx`
- Create: `apps/web/app/(admin)/specs/page.tsx`
- Create: `apps/web/app/(admin)/jobs/page.tsx`
- Create: `apps/web/app/(admin)/settings/page.tsx`
- Create: `apps/web/lib/settings.test.ts`
- Modify: `apps/web/components/admin-shell.tsx`

- [ ] **Step 1: 写连接器状态和改密失败测试**

```ts
import { describe, expect, it } from "vitest";
import { connectorLabel, canAccessAdminPage } from "./view-models";

describe("settings views", () => {
  it("does not present auth failure as no data", () => {
    expect(connectorLabel("AUTH_DISABLED")).toBe("鉴权失败，连接器已停用");
  });

  it("forces password change before other pages", () => {
    expect(canAccessAdminPage({ forcePasswordChange: true }, "/dashboard")).toBe(false);
    expect(canAccessAdminPage({ forcePasswordChange: true }, "/settings")).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run apps/web/lib/settings.test.ts`

Expected: FAIL with missing view functions。

- [ ] **Step 3: 实现四个管理页面**

商家页显示可空主页、来源平台、有效商品数和最近验证；规格页维护三态字段并处理待归一化候选；任务页显示来源权限、游标、额度、最近运行和错误分类并允许手工补链；设置页只允许改密、调度频率、超时和汇率来源，不在页面读取或回显平台密钥。

- [ ] **Step 4: 实现真实连接冒烟状态**

Jobs 页面为 X 和 Telegram 提供“运行连接测试”操作。成功记录权限、可见范围和时间；失败保持连接器禁用并显示分类错误。连接测试不抓取或展示私人内容。

- [ ] **Step 5: 运行测试与构建**

Run: `pnpm exec vitest run apps/web/lib/settings.test.ts`

Expected: 状态文案、强制改密和敏感字段不回显测试通过。

Run: `pnpm --filter @compare/web build`

Expected: build succeeds。

- [ ] **Step 6: 提交**

```bash
git add apps/web
git commit -m "feat: complete investigation admin workflows"
```

### Task 12: 端到端验证、视觉 QA 与部署文档

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/admin-flow.spec.ts`
- Create: `apps/web/public/robots.txt`
- Create: `Dockerfile.web`
- Create: `Dockerfile.worker`
- Create: `Dockerfile.validator`
- Create: `Caddyfile`
- Create: `README.md`
- Modify: `docker-compose.yml`

- [ ] **Step 1: 写端到端主流程**

```ts
import { expect, test } from "@playwright/test";

test("admin reviews a public listing and sees both rankings", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("用户名").fill("owner");
  await page.getByLabel("密码").fill("local-test-password");
  await page.getByRole("button", { name: "登录" }).click();
  await page.goto("/candidates");
  await expect(page.getByRole("link", { name: "商品页" }).first()).toHaveAttribute("rel", /noopener/);
  await page.getByRole("button", { name: "通过" }).first().click();
  await page.goto("/dashboard");
  await expect(page.getByRole("tab", { name: "价格榜" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "货源榜" })).toBeVisible();
});
```

- [ ] **Step 2: 启动测试栈并确认测试先失败**

Run: `docker compose up -d postgres validator`

Run: `pnpm test:e2e`

Expected: FAIL until seed fixture and complete pages are wired。

- [ ] **Step 3: 添加固定种子与完成部署配置**

测试种子创建唯一管理员、两个同规格商品、一个手工候选、一个失效链接和一个缺货链接。Docker Compose 连接 web、worker、validator、postgres、Caddy；validator 不获得数据库、X 或 Telegram 环境变量，且只允许公网 80/443 出站。README 写明本地启动、一次性管理员、X/TG 凭据、真实连接测试、备份恢复和不绕过限制。

- [ ] **Step 4: 运行完整自动化验证**

Run: `pnpm lint`

Expected: exit 0。

Run: `pnpm typecheck`

Expected: exit 0。

Run: `pnpm test`

Expected: all unit and integration tests passed。

Run: `pnpm test:e2e`

Expected: login、强制改密、候选审核、三类链接、价格榜、货源榜、失效下榜和移动端导航测试全部通过。

- [ ] **Step 5: 完成桌面与移动视觉 QA**

使用 Playwright 分别在 `1440x900` 和 `390x844` 截图登录页、榜单、候选页和任务页。检查文本不溢出、按钮不重叠、表格可横向滚动、商品链接可见、侧栏在移动端变为抽屉；检查浏览器控制台无错误。

- [ ] **Step 6: 演练迁移、备份和 worker 恢复**

执行数据库迁移；创建 PostgreSQL 备份并恢复到空库；在 pg-boss 任务处理中重启 worker，确认租约到期后任务只执行一次。记录命令与结果到 README 的“部署验证”小节。

- [ ] **Step 7: 最终提交**

```bash
git add playwright.config.ts tests/e2e Dockerfile.web Dockerfile.worker Dockerfile.validator Caddyfile docker-compose.yml README.md apps/web/public/robots.txt
git commit -m "test: verify production investigation workflow"
```

## 规格覆盖自检

- 唯一管理员、无注册、首次改密：Task 3、5、11、12。
- X/Telegram 公共内容发现、权限与降级：Task 9、10、11。
- 手工补链与可空来源：Task 3、7。
- 安全商品页验证、SSRF 与外链属性：Task 4、6、12。
- 人工审核、商家、规格、审计：Task 3、7、11。
- 同规格价格榜、目标数量、汇率边界：Task 2、6、12。
- 明确/推断货源榜与置信度：Task 2、6、12。
- 链接生命周期、复检和任务幂等：Task 8、12。
- 公网部署、HTTPS、备份恢复和视觉 QA：Task 12。
