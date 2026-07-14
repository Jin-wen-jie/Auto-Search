import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("workspace", () => {
  it("declares every runtime package", () => {
    expect(existsSync("pnpm-workspace.yaml")).toBe(true);
    const workspace = readFileSync("pnpm-workspace.yaml", "utf8");
    expect(workspace).toContain("apps/*");
    expect(workspace).toContain("packages/*");
  });

  it("excludes local secrets and generated files from Docker builds", () => {
    const dockerignore = existsSync(".dockerignore")
      ? readFileSync(".dockerignore", "utf8")
      : "";
    const ignoredPaths = dockerignore
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    expect(ignoredPaths).toEqual(
      expect.arrayContaining([
        ".git",
        ".worktrees",
        ".env",
        ".env.*",
        "node_modules",
        ".next",
        "dist",
        "coverage",
        "playwright-report",
        "test-results",
        "*.log",
      ]),
    );

    const environmentPatternIndex = ignoredPaths.indexOf(".env.*");
    const exampleAllowIndex = ignoredPaths.indexOf("!.env.example");

    expect(ignoredPaths).toContain("!.env.example");
    expect(exampleAllowIndex).toBeGreaterThan(environmentPatternIndex);
  });

  it("keeps service development scripts scoped to their own environment", () => {
    const expectedDevScripts = new Map([
      ["apps/worker/package.json", "tsx watch --conditions=source src/index.ts"],
      ["apps/validator/package.json", "tsx watch src/server.ts"],
    ]);

    for (const [packagePath, expectedDevScript] of expectedDevScripts) {
      const manifest = JSON.parse(readFileSync(packagePath, "utf8")) as {
        scripts?: { dev?: string };
      };

      expect(manifest.scripts?.dev).toBe(expectedDevScript);
      expect(manifest.scripts?.dev).not.toContain("--env-file=../../.env");
    }
  });

  it("builds shared packages before starting Next.js development", () => {
    const manifest = JSON.parse(
      readFileSync("apps/web/package.json", "utf8"),
    ) as { scripts?: { predev?: string } };

    expect(manifest.scripts?.predev).toBe(
      "pnpm --filter @compare/domain build && pnpm --filter @compare/db build",
    );
  });

  it("limits standalone Next.js output to Docker builds", () => {
    const nextConfig = readFileSync("apps/web/next.config.mjs", "utf8");
    const dockerfile = readFileSync("Dockerfile.web", "utf8");

    expect(nextConfig).toContain('process.env.NEXT_OUTPUT === "standalone"');
    expect(dockerfile).toContain(
      "RUN NEXT_OUTPUT=standalone pnpm --filter @compare/web... build",
    );
  });
});
