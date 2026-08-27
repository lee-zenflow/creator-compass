import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/ocr/ocr-worker", () => ({
  recognizeScreenshot: vi.fn(async () => ({ text: "播放量 100 点赞 5", confidence: 92 })),
}));

import { OcrConfirmation } from "./ocr-confirmation";

describe("private OCR confirmation", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  test("does not persist manually entered metrics before explicit confirmation", async () => {
    const save = vi.fn();
    render(<OcrConfirmation onConfirm={save} />);

    expect(save).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText("内容标题"), "真实复盘内容");
    await userEvent.type(screen.getByLabelText("发布时间"), "2026-08-13T12:00:00+08:00");
    await userEvent.type(screen.getByLabelText("播放/阅读量"), "100");
    await userEvent.type(screen.getByLabelText("点赞"), "5");
    expect(save).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "确认并生成复盘" }));
    expect(save).toHaveBeenCalledTimes(1);
  });

  test("recognizes a screenshot without sending it through fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<OcrConfirmation />);
    const file = new File([new Uint8Array([1, 2, 3])], "sanitized.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText("选择后台数据截图"), file);
    await waitFor(() => expect(screen.getByDisplayValue("100")).toBeInTheDocument());
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("uploads the original only after explicit opt-in and forwards the private key", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ objectKey: "private/user/u1/review.png" }), { status: 201, headers: { "content-type": "application/json" } }));
    const confirmAction = vi.fn(async (formData: FormData) => { void formData; });
    render(<OcrConfirmation confirmAction={confirmAction} />);
    const file = new File([new Uint8Array([1, 2, 3])], "sanitized.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText("选择后台数据截图"), file);
    await waitFor(() => expect(screen.getByDisplayValue("100")).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText("内容标题"), "测试内容");
    await userEvent.type(screen.getByLabelText("发布时间"), "2026-08-09T12:00:00+08:00");
    await userEvent.click(screen.getByRole("checkbox", { name: "保存原始截图到私有空间" }));
    await userEvent.click(screen.getByRole("button", { name: "确认并生成复盘" }));
    await waitFor(() => expect(confirmAction).toHaveBeenCalled());
    expect(fetchSpy).toHaveBeenCalledWith("/api/storage/private", expect.objectContaining({ method: "POST" }));
    const submitted = confirmAction.mock.calls[0]![0] as FormData;
    expect(submitted.get("privateObjectKey")).toBe("private/user/u1/review.png");
    expect(submitted.get("screenshotConsentAt")).toBeTruthy();
  });
});
