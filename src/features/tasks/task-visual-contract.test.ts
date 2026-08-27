import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
const styles = readFileSync("src/app/globals.css", "utf8");
const page = readFileSync("src/app/(product)/tasks/page.tsx", "utf8");
const detailPage = readFileSync("src/app/(product)/tasks/[id]/page.tsx", "utf8");
const card = readFileSync("src/features/tasks/task-card.tsx", "utf8");

describe("task mobile density", () => {
  test("prevents page-level horizontal overflow on phone viewports", () => {
    expect(styles).toMatch(/body\s*\{[^}]*overflow-x:\s*hidden/);
  });

  test("keeps task previews and task-center rows at 84px", () => {
    expect(styles).toMatch(/\.task-preview__item\s*\{[^}]*height:\s*84px[^}]*overflow:\s*hidden/);
    expect(styles).toMatch(/\.task-card\s*\{[^}]*height:\s*84px[^}]*overflow:\s*hidden/);
  });
  test("keeps filters and task controls touch-safe", () => {
    expect(styles).toMatch(/\.compact-segmented__item\s*\{[^}]*min-height:\s*42px/);
    expect(styles).toMatch(/\.task-icon-action\s*\{[^}]*width:\s*42px[^}]*height:\s*42px/);
    expect(styles).toMatch(/\.task-card__detail-link\s*\{[^}]*min-height:\s*42px/);
    expect(styles).toMatch(/\.task-card__source-link\s*\{[^}]*width:\s*42px[^}]*height:\s*42px/);
    expect(styles).toMatch(/\.task-card__select\s*\{[^}]*width:\s*42px[^}]*height:\s*42px/);
    expect(styles).toMatch(/\.task-list__mode\s*\{[^}]*min-height:\s*42px/);
    expect(styles).toMatch(/\.task-batch-bar__action\s*\{[^}]*min-height:\s*42px/);
    expect(card).toContain("useFormStatus"); expect(card).toContain("disabled={pending}");
  });
  test("fits the phone frame without widening cards", () => {
    expect(styles).toMatch(/\.flow-content\s*\{[^}]*max-width:\s*348px/);
    expect(styles).toMatch(/\.task-card\s*\{[^}]*width:\s*100%/);
    expect(styles).not.toMatch(/\.task-card[^}]*transition:\s*all/);
  });
  test("keeps date and status filters URL-restorable", () => {
    expect(page).toContain("range?: string"); expect(page).toContain("status?: string"); expect(page).toContain("notice?: string"); expect(page).toContain("URLSearchParams");
    expect(page).toContain('key={`${range}:${status}`}');
  });
  test("uses explicit status actions on the detail page", () => {
    expect(detailPage).not.toContain("toggleTaskStatusAction");
    expect(detailPage).toContain("restoreTaskAction"); expect(detailPage).toContain("completeTaskAction");
    expect(detailPage).toContain('task.status !== "dismissed"');
  });
});
