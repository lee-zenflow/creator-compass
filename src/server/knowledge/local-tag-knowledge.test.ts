import { describe, expect, test } from "vitest";

import { tagChunksLocally } from "./local-tag-knowledge";

describe("tagChunksLocally", () => {
  test("keeps user-supplied platform, content type and tags without calling an external model", async () => {
    const [result] = await tagChunksLocally([{
      index: 0,
      text: "个人 IP 定位需要明确目标人群和差异化价值。目标人群需要通过内容反馈持续验证。",
      charStart: 0,
      charEnd: 48,
    }], {
      platform: "xiaohongshu",
      contentType: "note",
      tags: ["定位", "定位", "用户画像"],
    });

    expect(result?.tags).toMatchObject({
      platform: "xiaohongshu",
      contentType: "note",
      tags: ["定位", "用户画像"],
    });
    expect(result?.tags.summary).toContain("个人 IP 定位");
    expect(result?.tags.normalizedKeywords.length).toBeGreaterThan(0);
  });
});
