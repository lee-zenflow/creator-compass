import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const privacyPath = "src/app/privacy/page.tsx";
const termsPath = "src/app/terms/page.tsx";

describe("public legal draft routes", () => {
  test.each([privacyPath, termsPath])("publishes %s as a real route", (path) => {
    expect(existsSync(path)).toBe(true);
  });

  test("privacy draft labels its release status and only states confirmed processing facts", () => {
    expect(existsSync(privacyPath)).toBe(true);
    if (!existsSync(privacyPath)) return;
    const source = readFileSync(privacyPath, "utf8");
    expect(source).toContain("发布前待运营主体确认的说明草案");
    expect(source).toContain("本机创建唯一 Owner");
    expect(source).toContain("密码加密备份");
    expect(source).toContain("不接入外部遥测");
    expect(source).toContain("OCR 默认在浏览器本地运行");
    expect(source).not.toContain("已通过合规审查");
  });

  test("terms draft does not invent an operator or promise unavailable integrations", () => {
    expect(existsSync(termsPath)).toBe(true);
    if (!existsSync(termsPath)) return;
    const source = readFileSync(termsPath, "utf8");
    expect(source).toContain("发布前待运营主体确认的说明草案");
    expect(source).toContain("不提供平台授权、自动抓取、支付或短信能力");
    expect(source).not.toMatch(/有限公司|统一社会信用代码/);
  });
});
