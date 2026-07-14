import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

function commandOutput(result: SpawnSyncReturns<string>): string {
  return [
    `exit status: ${result.status ?? "none"}`,
    result.error?.stack,
    result.stdout,
    result.stderr,
  ]
    .filter(Boolean)
    .join("\n");
}

describe("worker production ESM", () => {
  it("resolves workspace packages from source in tsx source scripts", () => {
    const workerManifest = JSON.parse(
      readFileSync(new URL("../apps/worker/package.json", import.meta.url), "utf8"),
    ) as { scripts?: { dev?: string } };
    const dbManifest = JSON.parse(
      readFileSync(new URL("../packages/db/package.json", import.meta.url), "utf8"),
    ) as { scripts?: { "db:seed"?: string } };
    const expectedWorkerDev =
      "tsx watch --conditions=source src/index.ts";
    const expectedDbSeed =
      "tsx --conditions=source src/seed-run.ts";
    const scriptsEnableSource =
      workerManifest.scripts?.dev === expectedWorkerDev &&
      dbManifest.scripts?.["db:seed"] === expectedDbSeed;

    const resolution = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        ...(scriptsEnableSource ? ["--conditions=source"] : []),
        "--input-type=module",
        "--eval",
        "console.log(JSON.stringify({ db: import.meta.resolve('@compare/db'), domain: import.meta.resolve('@compare/domain') }))",
      ],
      {
        cwd: fileURLToPath(new URL("../apps/worker/", import.meta.url)),
        encoding: "utf8",
        timeout: 30_000,
      },
    );

    const output = commandOutput(resolution);
    expect(resolution.error, output).toBeUndefined();
    expect(resolution.status, output).toBe(0);
    const resolved = JSON.parse(resolution.stdout.trim()) as {
      db: string;
      domain: string;
    };

    expect(fileURLToPath(resolved.db), output).toBe(
      fileURLToPath(new URL("../packages/db/src/client.ts", import.meta.url)),
    );
    expect(fileURLToPath(resolved.domain), output).toBe(
      fileURLToPath(new URL("../packages/domain/src/index.ts", import.meta.url)),
    );
    expect(workerManifest.scripts?.dev).toBe(expectedWorkerDev);
    expect(dbManifest.scripts?.["db:seed"]).toBe(expectedDbSeed);
  });

  it("routes package fallback conditions to built JavaScript", () => {
    const packageExports = [
      ["packages/domain/package.json", "./dist/index.js"],
      ["packages/db/package.json", "./dist/client.js"],
    ] as const;

    for (const [packagePath, expectedDefault] of packageExports) {
      const manifest = JSON.parse(
        readFileSync(new URL(`../${packagePath}`, import.meta.url), "utf8"),
      ) as { exports?: { "."?: { default?: string } } };

      expect(manifest.exports?.["."]?.default).toBe(expectedDefault);
    }
  });

  it(
    "builds workspace dependencies and imports without starting the worker",
    () => {
      const productionEnv = { ...process.env, NODE_ENV: "production" };
      const build =
        process.platform === "win32"
          ? spawnSync(
              process.env.ComSpec ?? "cmd.exe",
              [
                "/d",
                "/s",
                "/c",
                "pnpm --filter @compare/worker... build",
              ],
              {
                cwd: repoRoot,
                encoding: "utf8",
                env: productionEnv,
                timeout: 120_000,
              },
            )
          : spawnSync(
              "pnpm",
              ["--filter", "@compare/worker...", "build"],
              {
                cwd: repoRoot,
                encoding: "utf8",
                env: productionEnv,
                timeout: 120_000,
              },
            );

      expect(build.error, commandOutput(build)).toBeUndefined();
      expect(build.status, commandOutput(build)).toBe(0);

      const runtimeEnv = { ...productionEnv };
      delete runtimeEnv.DATABASE_URL;
      const runtimeImport = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          "if (process.env.NODE_ENV !== 'production') throw new Error('NODE_ENV must be production'); await import('./apps/worker/dist/index.js')",
        ],
        {
          cwd: repoRoot,
          encoding: "utf8",
          env: runtimeEnv,
          timeout: 30_000,
        },
      );

      expect(runtimeImport.error, commandOutput(runtimeImport)).toBeUndefined();
      expect(runtimeImport.status, commandOutput(runtimeImport)).toBe(0);
    },
    120_000,
  );
});
