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
  return Array.from(markdown.matchAll(/`([A-Z][A-Z0-9_]+)`/g), ([, name]) =>
    name,
  );
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
    expect(deployment).toContain("GitHub Actions `Hourly collection`");
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

  it("lists only the required Vercel variables and repository secrets", () => {
    const vercelVariables = sectionBetween(
      deployment,
      "#### Vercel 环境变量",
      "### 3. 配置 GitHub Actions",
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

    const repositorySecrets = sectionBetween(
      deployment,
      "#### Repository Secrets",
      "#### 采集计划与手动触发",
    );
    expect(environmentNames(repositorySecrets)).toEqual([
      "DATABASE_URL",
      "VALIDATOR_SHARED_TOKEN",
    ]);
  });

  it("documents collection bounds, manual runs, and first deployment order", () => {
    expect(deployment).toContain("`0 * * * *`");
    expect(deployment).toContain("最长 30 分钟");
    expect(deployment).toContain("Worker 最长运行 25 分钟");
    expect(deployment).toContain("50 个候选项 + 50 个货源链接");
    expect(deployment).toContain("并发数 4");
    expect(deployment).toContain("GitHub 计划任务可能延迟");
    expect(deployment).toContain("不保证整点");
    expect(deployment).toContain(
      "Actions -> Hourly collection -> Run workflow",
    );
    expect(deployment).toContain(
      "先配置 GitHub Secrets 并手动运行成功，再导入并部署 Vercel",
    );
    expect(deployment).toContain("首次登录后立即修改初始密码");
  });

  it("states the free-tier limits without recommending obsolete hosts", () => {
    expect(deployment).toContain("Vercel Hobby 不会因空闲休眠");
    expect(deployment).toContain("免费额度和公平使用限制");
    expect(deployment).toContain("Supabase 和 GitHub Actions");
    expect(deployment).toContain("超限或平台策略");
    expect(deployment).toContain("无需银行卡");
    expect(deployment).toContain("不能承诺绝对 100% SLA");
    expect(deployment).toMatch(
      /Render\s*和\s*Northflank\s*不再作为推荐的最终方案/,
    );
  });

  it("does not expose credentials or a concrete deployment URL", () => {
    expect(deployment).not.toMatch(/postgres(?:ql)?:\/\//i);
    expect(deployment).not.toMatch(/\$\{\{\s*secrets\./i);
    expect(deployment).not.toMatch(/\b[0-9a-f]{32,}\b/i);
    expect(deployment).not.toMatch(
      /(?:DATABASE_URL|SESSION_SECRET|ADMIN_INITIAL_USERNAME|ADMIN_INITIAL_PASSWORD|VALIDATOR_SHARED_TOKEN)\s*=/,
    );
    expect(deployment).not.toMatch(/https?:\/\/[^\s)]+\.vercel\.app/i);
  });
});
