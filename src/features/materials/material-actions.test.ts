import { beforeEach, describe, expect, test, vi } from "vitest";

import type { CurrentActor } from "@/features/identity/current-actor";

const mocks = vi.hoisted(() => ({
  deleteMaterial: vi.fn(),
  updateMaterial: vi.fn(),
  revalidate: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({})),
  headers: vi.fn(async () => ({})),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/features/identity/current-actor", () => ({
  resolveCurrentActor: vi.fn(async () => actor),
}));
vi.mock("./material-service", () => ({
  createMaterial: vi.fn(),
  deleteMaterial: mocks.deleteMaterial,
  updateMaterial: mocks.updateMaterial,
}));

import { deleteMaterialAction, updateMaterialAction } from "./material-actions";

const actor: CurrentActor = {
  kind: "user",
  userId: "10000000-0000-4000-8000-000000000001",
  role: "user",
};

describe("material deletion return context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteMaterial.mockRejectedValue(new Error("MATERIAL_IN_USE"));
    mocks.updateMaterial.mockResolvedValue({});
  });

  test("returns an in-use error to the bounded current filter and search", async () => {
    const form = new FormData();
    form.set("materialId", "30000000-0000-4000-8000-000000000003");
    form.set("filter", "inspiration");
    form.set("q", "  访谈  ");

    await deleteMaterialAction(form);

    expect(mocks.deleteMaterial).toHaveBeenCalledWith(
      actor,
      "30000000-0000-4000-8000-000000000003",
    );
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/materials?filter=inspiration&q=%E8%AE%BF%E8%B0%88&error=material-in-use",
    );
  });

  test("drops untrusted filter values and truncates search instead of creating an open redirect", async () => {
    const form = new FormData();
    form.set("materialId", "30000000-0000-4000-8000-000000000003");
    form.set("filter", "https://attacker.example");
    form.set("q", "长".repeat(81));

    await deleteMaterialAction(form);

    const target = String(mocks.redirect.mock.calls[0]?.[0]);
    expect(target).toMatch(/^\/materials\?/);
    expect(target).not.toContain("attacker.example");
    expect(new URL(target, "https://creator-compass.local").searchParams.get("q")).toHaveLength(80);
  });

  test("returns a successful edit to the same bounded filter and search", async () => {
    const form = new FormData();
    form.set("materialId", "30000000-0000-4000-8000-000000000003");
    form.set("name", "更新后的素材");
    form.set("category", "inspiration");
    form.set("type", "text");
    form.set("source", "用户访谈");
    form.set("summary", "保留上下文");
    form.set("filter", "history_content");
    form.set("q", "访谈");

    await updateMaterialAction(form);

    expect(mocks.redirect).toHaveBeenCalledWith(
      "/materials?filter=history_content&q=%E8%AE%BF%E8%B0%88",
    );
  });
});
