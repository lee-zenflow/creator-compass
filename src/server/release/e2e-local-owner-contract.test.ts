import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

describe("local Owner E2E contract", () => {
  test("does not exercise the removed guest and registration flow", () => {
    const files = readdirSync("tests/e2e")
      .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
      .map((file) => join("tests/e2e", file));
    const suite = files.map((file) => readFileSync(file, "utf8")).join("\n");

    expect(suite).not.toMatch(/startFreshGuest|registerCurrentGuest|游客完成|游客身份|邮箱验证/);
    expect(suite).toContain("startLocalOwnerSession");
    expect(suite).toContain('getByRole("button", { name: "创建本地 Owner" })');
    expect(suite).toContain('getByRole("button", { name: "登录" })');
  });

  test("isolates per-test rate limits behind the trusted loopback proxy", () => {
    const helpers = readFileSync("tests/e2e/helpers.ts", "utf8");
    const config = readFileSync("playwright.config.ts", "utf8");

    expect(helpers).toContain("setExtraHTTPHeaders");
    expect(helpers).toContain('"x-forwarded-for"');
    expect(config).toContain('RATE_LIMIT_TRUST_PROXY: "1"');
    expect(config).toContain('AUTH_TRUSTED_PROXIES: "127.0.0.1/32,::1/128"');
    expect(config).toContain('E2E_RATE_LIMIT_BYPASS: "1"');
  });
});
