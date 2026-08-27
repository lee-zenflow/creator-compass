import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

vi.mock("./platform-account-actions", () => ({
  createPlatformAccountAction: vi.fn(),
  setActivePlatformAccountAction: vi.fn(),
}));

import { PlatformAccountsView } from "./platform-accounts-view";

describe("PlatformAccountsView", () => {
  test("states the unsupported integration boundary without an authorization control", () => {
    render(<PlatformAccountsView accounts={[]} next="" notice={null} />);

    expect(screen.getByText(/不会连接平台、保存授权令牌或自动同步数据/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "立即授权" })).toBeNull();
    expect(screen.getByRole("button", { name: "添加账号标签" })).toBeInTheDocument();
  });

  test("distinguishes the selected manual label from a connected platform", () => {
    render(<PlatformAccountsView accounts={[
      { id: "10000000-0000-4000-8000-000000000001", platform: "douyin", accountLabel: "主账号", dataSource: "manual", isActive: true },
      { id: "10000000-0000-4000-8000-000000000002", platform: "bilibili", accountLabel: "视频号", dataSource: "ocr", isActive: false },
    ]} next="/reviews/new" notice={null} />);

    expect(screen.getByText("当前标签")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "设为当前标签" })).toBeInTheDocument();
    expect(screen.getAllByDisplayValue("/reviews/new")).toHaveLength(2);
    expect(screen.getAllByText(/截图 OCR/)).toHaveLength(2);
  });
});
