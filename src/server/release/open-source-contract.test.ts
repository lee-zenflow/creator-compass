import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

function read(path: string) {
  return readFileSync(path, "utf8");
}

function git(args: string[]) {
  return execFileSync("git", args, { encoding: "utf8" }).replaceAll("\\", "/");
}

function gitGrep(args: string[]) {
  try {
    return git(["grep", ...args]);
  } catch (error) {
    if (typeof error === "object" && error && "status" in error && error.status === 1) return "";
    throw error;
  }
}

describe("public repository contract", () => {
  test("does not track or expose local secrets and generated caches", () => {
    const tracked = git(["ls-files"]);
    const untracked = git(["ls-files", "--others", "--exclude-standard"]);
    const forbidden = /(^|\n)(?:\.env(?!\.example)(?:\..+)?|\.next(?:-e2e)?\/|artifacts\/|dist\/|coverage\/|node_modules\/|tsconfig\.tsbuildinfo$)/m;

    expect(tracked).not.toMatch(forbidden);
    expect(untracked).not.toMatch(forbidden);
    expect(git(["check-ignore", ".env.local", ".next", "artifacts", "dist", "tsconfig.tsbuildinfo"]))
      .toContain(".env.local");

    const trackedContents = gitGrep([
      "-n",
      "-I",
      "-E",
      "sk-[A-Za-z0-9]{16,}|DEEPSEEK_API_KEY=(sk-|[A-Za-z0-9+/]{24,})|SMTP_PASSWORD=[A-Za-z0-9+/]{16,}|AUTH_SECRET=[A-Za-z0-9+/]{24,}",
      "--",
      ":!.env.example",
      ":!.github/workflows/ci.yml",
    ]);
    expect(trackedContents).toBe("");
  });

  test("publishes CI, security, license, environment and deployment contracts", () => {
    for (const path of [
      ".github/workflows/ci.yml",
      "SECURITY.md",
      "LICENSE",
      ".env.example",
      "README.md",
      "docs/deployment.md",
    ]) {
      expect(existsSync(path), path).toBe(true);
    }

    const ci = read(".github/workflows/ci.yml");
    for (const required of [
      "postgres:16-alpine",
      "version: 11.16.0",
      "node-version: 22",
      "pnpm install --frozen-lockfile",
      "pnpm db:migrate",
      "pnpm db:seed",
      "pnpm lint",
      "pnpm typecheck",
      "pnpm test",
      "pnpm build",
      "pnpm build:worker",
      "Rebuild clean E2E database",
      "pnpm e2e",
      "E2E_SERVER_MODE: production",
      "E2E_BASE_URL: http://localhost:3101",
    ]) {
      expect(ci, required).toContain(required);
    }
    expect(ci).not.toMatch(/minio|mailpit|S3_/i);
    expect(ci).toContain("creator_compass_ci_test");
    expect(ci).not.toMatch(/sk-[A-Za-z0-9]{16,}/);

    const security = read("SECURITY.md");
    expect(security).toContain("GitHub Private Vulnerability Reporting");
    expect(security).not.toMatch(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
    expect(read("LICENSE")).toContain("MIT License");
    expect(read("LICENSE")).toContain("Permission is hereby granted");
  });

  test("documents honest product, AI, legal and deployment boundaries", () => {
    const readme = read("README.md");
    expect(readme).toContain("AI_ADAPTER=test");
    expect(readme).toContain("单机 Owner");
    expect(readme).toContain("deepseek-v4-flash");
    expect(readme).toContain("AES-256-GCM");
    expect(readme).toContain("不支持平台 OAuth 授权");
    expect(readme).toContain("不支持在线支付");
    expect(readme).toContain("发布前待运营主体确认的说明草案");
    expect(readme).toContain("[安全政策](SECURITY.md)");
    expect(readme).toContain("[本机运行与发布说明](docs/deployment.md)");

    const deployment = read("docs/deployment.md");
    expect(deployment).toContain("AI_ADAPTER=deepseek");
    expect(deployment).toContain("唯一 Owner");
    expect(deployment).toContain("主密钥文件");
    expect(deployment).toContain("专用的 Playwright 服务");
    expect(deployment).not.toContain("AI_ADAPTER=test 用于生产");
  });
});
