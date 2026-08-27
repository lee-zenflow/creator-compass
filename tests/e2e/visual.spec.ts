import { expect, test } from "@playwright/test";

import {
  assertNoHorizontalOverflow,
  completePositioning,
  requireE2eInfrastructure,
  startLocalOwnerSession,
} from "./helpers";

test.use({ viewport: { width: 390, height: 844 } });

test("390×844 关键页面保持 Figma 紧凑密度且无横向溢出", async ({ page }, testInfo) => {
  requireE2eInfrastructure();
  await startLocalOwnerSession(page);
  for (const [name, path] of [
    ["workspace", "/workspace"],
    ["creation-request", "/creation/new"],
    ["ocr-confirmation", "/me/platforms?next=/reviews/new"],
  ] as const) {
    await page.goto(path);
    await assertNoHorizontalOverflow(page);
    await testInfo.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  }

  await completePositioning(page);
  await assertNoHorizontalOverflow(page);
  const candidateCards = page.locator(".candidate-card");
  await expect(candidateCards).toHaveCount(3);
  for (const card of await candidateCards.all()) {
    expect((await card.boundingBox())?.height ?? 9999).toBeLessThanOrEqual(190);
  }
  await testInfo.attach("positioning-candidates", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});
