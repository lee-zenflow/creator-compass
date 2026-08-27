import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  AuthFrame,
  LocalRecoveryForm,
  LocalSetupForm,
  LoginForm,
} from "./auth-ui";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("compact local authentication screens", () => {
  test("keeps the Figma-like form compact without a large card wrapper", () => {
    const { container } = render(
      <AuthFrame title="登录" description="继续你的创作闭环">
        <LoginForm ownerName="本地创作者" />
      </AuthFrame>,
    );

    expect(screen.getByRole("heading", { name: "登录" })).toBeInTheDocument();
    expect(screen.getByLabelText("用户名")).toHaveValue("本地创作者");
    expect(screen.getByLabelText("密码")).toBeInTheDocument();
    expect(container.querySelector(".compact-card")).toBeNull();
    expect(container.querySelector(".auth-panel")).toBeInTheDocument();
    expect(container.querySelector(".compass-mark")).toHaveAttribute("aria-hidden", "true");
  });

  test("initializes the Owner and shows recovery codes only after success", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          recoveryCodes: ["CC-AAAA-BBBB-1111", "CC-CCCC-DDDD-2222"],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    render(<LocalSetupForm />);

    fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "本地创作者" } });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "correct-horse-battery" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建本地 Owner" }));

    await waitFor(() => expect(screen.getByText("CC-AAAA-BBBB-1111")).toBeInTheDocument());
    expect(screen.getByText("CC-CCCC-DDDD-2222")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "我已保存，去登录" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/identity/setup",
      expect.objectContaining({ method: "POST" }),
    );
  });

  test("logs in with a visible username instead of exposing the synthetic email", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: false }), { status: 401 }));
    render(<LoginForm ownerName="本地创作者" />);

    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "wrong-password" } });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() =>
      expect(screen.getByText("用户名或密码不正确。")).toBeInTheDocument(),
    );
    const [, options] = fetchMock.mock.calls[0]!;
    expect(String(options.body)).toContain('"username":"本地创作者"');
    expect(String(options.body)).not.toContain("owner@creator-compass.local");
  });

  test("resets the password with one local recovery code", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    render(<LocalRecoveryForm />);

    fireEvent.change(screen.getByLabelText("恢复码"), {
      target: { value: "CC-AAAA-BBBB-1111" },
    });
    fireEvent.change(screen.getByLabelText("新密码"), {
      target: { value: "replacement-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "重置密码" }));

    await waitFor(() =>
      expect(screen.getByText("密码已更新，这枚恢复码已失效。")).toBeInTheDocument(),
    );
  });
});
