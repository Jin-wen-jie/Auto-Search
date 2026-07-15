import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface VercelConfig {
  $schema: string;
  framework: string;
  installCommand: string;
  buildCommand: string;
}

const vercelConfig = JSON.parse(
  readFileSync("apps/web/vercel.json", "utf8"),
) as VercelConfig;
const readme = readFileSync("README.md", "utf8");
const deploymentDesign = readFileSync(
  "docs/superpowers/specs/2026-07-13-vercel-github-actions-deployment-design.md",
  "utf8",
);

function sectionBetween(
  markdown: string,
  startHeading: string,
  endHeading: string,
): string {
  const start = markdown.indexOf(startHeading);
  const end = markdown.indexOf(endHeading, start + startHeading.length);

  expect(start, `missing heading: ${startHeading}`).toBeGreaterThanOrEqual(0);
  expect(end, `missing heading: ${endHeading}`).toBeGreaterThan(start);

  return markdown.slice(start, end);
}

function environmentNames(markdown: string): string[] {
  return Array.from(
    markdown.matchAll(/^- `([A-Z][A-Z0-9_]+)`\s*$/gm),
    ([, name]) => name,
  );
}

const credentialLeakPatterns = [
  /postgres(?:ql)?:\/\//i,
  /https?:\/\/[^/\s:@]+:[^@\s/]+@/i,
  /\$\{\{\s*secrets\./i,
  /\b[0-9a-f]{32,}\b/i,
  /`?(?:DATABASE_URL|SESSION_SECRET|ADMIN_INITIAL_USERNAME|ADMIN_INITIAL_PASSWORD|VALIDATOR_SHARED_TOKEN)`?\s*(?:=|:|：)\s*\S+/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /\bsb_secret_[A-Za-z0-9_-]{8,}\b/i,
  /(?:^|[^A-Za-z0-9+/])[A-Za-z0-9+/]{48,}={0,2}(?=$|[^A-Za-z0-9+/=])/m,
  /(?:https?:\/\/)?(?:[a-z0-9-]+\.)+vercel\.app(?:[/?#\s]|$)/i,
];

function containsCredentialLeak(value: string): boolean {
  return credentialLeakPatterns.some((pattern) => pattern.test(value));
}

describe("Vercel monorepo configuration", () => {
  it("builds the Next.js app from the repository root", () => {
    expect(vercelConfig).toEqual({
      $schema: "https://openapi.vercel.sh/vercel.json",
      framework: "nextjs",
      installCommand:
        "cd ../.. && corepack enable && pnpm install --frozen-lockfile",
      buildCommand: "cd ../.. && pnpm --filter @compare/web... build",
    });
  });
});

describe("free public deployment documentation", () => {
  const deployment = sectionBetween(
    readme,
    "## 免费公网部署",
    "## 可选服务器部署",
  );

  it("documents the hosted architecture and exact Vercel import settings", () => {
    expect(deployment).toContain("GitHub `main` -> Vercel Hobby Web");
    expect(deployment).toContain("Supabase PostgreSQL");
    expect(deployment).toContain("GitHub Actions `Public web collection`");
    expect(deployment).toContain("临时 Validator");
    expect(deployment).toContain("one-shot Worker");

    expect(deployment).toContain("`Jin-wen-jie/-`");
    expect(deployment).toContain("Root Directory");
    expect(deployment).toContain("`apps/web`");
    expect(deployment).toContain(
      "Include source files outside of the Root Directory in the Build Step",
    );
    expect(deployment).toContain("Framework");
    expect(deployment).toContain("Next.js");
  });

  it("selects the IPv4 Supabase pooler compatible with prepared statements", () => {
    const supabaseConnection = sectionBetween(
      deployment,
      "### 2. 配置 Supabase Production 连接",
      "### 3. 导入并配置 Vercel",
    );

    expect(supabaseConnection).toContain("Supabase Dashboard");
    expect(supabaseConnection).toContain("Connect");
    expect(supabaseConnection).toContain("Connection string");
    expect(supabaseConnection).toContain("Shared/Session Pooler");
    expect(supabaseConnection).toContain("IPv4");
    expect(supabaseConnection).toContain("`5432`");
    expect(supabaseConnection).toContain("`sslmode=require`");
    expect(supabaseConnection).toContain("postgres-js");
    expect(supabaseConnection).toContain("默认启用 prepared statements");
    expect(supabaseConnection).toContain("不要选择 Transaction Pooler");
    expect(supabaseConnection).toContain("`6543`");
    expect(supabaseConnection).toContain(
      "除非未来代码显式关闭 prepared statements",
    );
    expect(supabaseConnection).toContain("同一个 Production pooler URL");
    expect(supabaseConnection).toContain("GitHub Actions Repository Secret");
    expect(supabaseConnection).toContain("Vercel Production 环境变量");
  });

  it("lists only the required Vercel variables and repository secrets", () => {
    const vercelVariables = sectionBetween(
      deployment,
      "#### Vercel 环境变量",
      "### 4. 配置 GitHub Actions",
    );
    expect(environmentNames(vercelVariables)).toEqual([
      "DATABASE_URL",
      "SESSION_SECRET",
      "ADMIN_INITIAL_USERNAME",
      "ADMIN_INITIAL_PASSWORD",
    ]);
    expect(vercelVariables).toContain("Production");
    expect(vercelVariables).toContain("Preview");
    expect(vercelVariables).toContain("owner");
    expect(vercelVariables).toContain("随机生成");
    expect(vercelVariables).toContain("绝不写入仓库或日志");
    expect(vercelVariables).toContain("当前 Production 实际使用");
    expect(vercelVariables).toContain("`SESSION_SECRET` 是保留配置");
    expect(vercelVariables).toContain("当前版本不直接消费");
    expect(vercelVariables).toContain("Preview 默认不连接生产数据库");
    expect(vercelVariables).toContain("独立 Supabase 项目/数据库");
    expect(vercelVariables).toContain("独立管理员凭据");
    expect(vercelVariables).toContain("Vercel Deployment Protection");
    expect(vercelVariables).toContain("绝不复用 Production Secret");
    expect(vercelVariables).not.toContain(
      "以下名称同时应用于 Production 和 Preview",
    );

    const repositorySecrets = sectionBetween(
      deployment,
      "#### Repository Secrets",
      "#### 采集计划与手动触发",
    );
    expect(environmentNames(repositorySecrets)).toEqual([
      "DATABASE_URL",
      "VALIDATOR_SHARED_TOKEN",
      "BRAVE_SEARCH_API_KEY",
      "GOOGLE_SEARCH_API_KEY",
      "GOOGLE_SEARCH_CX",
      "SERPER_API_KEY",
    ]);
  });

  it("documents collection bounds, manual runs, and first deployment order", () => {
    expect(deployment).toContain("`0 */3 * * *`");
    expect(deployment).toContain("collect job 的最终硬上限为 30 分钟");
    expect(deployment).toContain("`WORKER_DEADLINE_MS=1500000`");
    expect(deployment).toContain("25 分钟软截止");
    expect(deployment).toContain("停止领取或启动新实体");
    expect(deployment).toContain("已启动实体允许有界收尾");
    expect(deployment).not.toContain("Worker 最长运行 25 分钟");
    expect(deployment).toContain("50 个候选项 + 50 个货源链接");
    expect(deployment).toContain("并发数 4");
    expect(deployment).toContain("GitHub 计划任务可能延迟");
    expect(deployment).toContain("不保证整点");
    expect(deployment).toContain(
      "Actions -> Public web collection -> Run workflow",
    );
    expect(deployment).toContain(
      "先配置 GitHub Secrets 并手动运行成功，再导入并部署 Vercel",
    );
    expect(deployment).toContain("首次登录后立即修改初始密码");
  });

  it("documents the soft worker deadline and final Actions hard limit", () => {
    expect(deploymentDesign).toContain(
      "`WORKER_DEADLINE_MS=1500000` 是 25 分钟软截止",
    );
    expect(deploymentDesign).toContain("停止领取或启动新实体");
    expect(deploymentDesign).toContain("已启动实体允许有界收尾");
    expect(deploymentDesign).toContain(
      "单 URL 与数据库操作由代码层的独立有界超时约束",
    );
    expect(deploymentDesign).toContain(
      "collect job 的 30 分钟超时是最终硬上限",
    );
    expect(deploymentDesign).not.toContain("默认硬超时为 `25` 分钟");
  });

  it("states the free-tier limits without recommending obsolete hosts", () => {
    expect(deployment).toContain("Vercel Hobby 不会因空闲休眠");
    expect(deployment).toContain("仅适合个人、非商业用途");
    expect(deployment).toContain("商业用途需重新选择合规计划");
    expect(deployment).toContain("免费额度和公平使用限制");
    expect(deployment).toContain("Supabase 和 GitHub Actions");
    expect(deployment).toContain("超限或平台策略");
    expect(deployment).toContain("公开仓库连续 60 天没有仓库活动");
    expect(deployment).toContain("GitHub 会自动停用 scheduled workflow");
    expect(deployment).toContain("Actions 重新启用");
    expect(deployment).toContain("产生仓库活动");
    expect(deployment).toContain("监控最近一次成功 run");
    expect(deployment).toContain(
      "需在 Actions 重新启用 scheduled workflow；恢复后应继续产生仓库活动",
    );
    expect(deployment).not.toContain(
      "重新启用 scheduled workflow，或产生仓库活动",
    );
    expect(deployment).toContain("采集停止后");
    expect(deployment).toContain("Supabase Free");
    expect(deployment).toContain("可能在 7 天周期后暂停");
    expect(deployment).toContain("Supabase Dashboard 恢复");
    expect(deployment).toContain("无需银行卡");
    expect(deployment).toContain("不能承诺绝对 100% SLA");
    expect(deployment).toMatch(
      /Render\s*和\s*Northflank\s*不再作为推荐的最终方案/,
    );
  });

  it("does not expose credentials or a concrete deployment URL", () => {
    expect(containsCredentialLeak(deployment)).toBe(false);
  });

  it("detects credential-shaped values without rejecting ordinary links", () => {
    const suspicious = [
      "DATABASE_URL: redacted-value",
      "SESSION_SECRET=redacted-value",
      `eyJ${"a".repeat(12)}.${"b".repeat(12)}.${"c".repeat(12)}`,
      `sb_secret_${"x".repeat(16)}`,
      "a".repeat(40),
      "Q".repeat(64),
      ["postgresql", "://", "user:password@db.invalid/database"].join(""),
      ["https", "://", "user:password@example.invalid/path"].join(""),
      ["https", "://", "example-project.vercel.app"].join(""),
    ];
    for (const value of suspicious) {
      expect(containsCredentialLeak(value), value).toBe(true);
    }

    const ordinary = [
      ["https", "://", "supabase.com/docs"].join(""),
      ["https", "://", "vercel.com/docs"].join(""),
      "Include source files outside of the Root Directory in the Build Step",
      "DATABASE_URL 必须启用 TLS，连接参数包含 sslmode=require",
    ];
    for (const value of ordinary) {
      expect(containsCredentialLeak(value), value).toBe(false);
    }
  });
});
